import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { EXPORT_FPS } from "../lib/constants";
import { computeContainSize } from "../lib/compositor";
import { clipDuration, totalDuration } from "../lib/timeline";
import type { Clip, SourceVideo, Track, Transition, TransitionKind } from "../types";
import type { ExportProgress } from "./types";

let ffmpegSingleton: FFmpeg | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;
  const ffmpeg = new FFmpeg();
  const coreURL = await toBlobURL("/ffmpeg/ffmpeg-core.js", "text/javascript");
  const wasmURL = await toBlobURL("/ffmpeg/ffmpeg-core.wasm", "application/wasm");
  await ffmpeg.load({ coreURL, wasmURL });
  ffmpegSingleton = ffmpeg;
  return ffmpeg;
}

function extensionFor(filename: string): string {
  const match = /\.[a-zA-Z0-9]+$/.exec(filename);
  return match ? match[0] : ".mp4";
}

// xfade has no native primitive for Push (only "new slides over old"), Iris (only single-phase
// reveals, no close-through-black-then-open), or a directional Motion Blur (only symmetric blur) —
// those three fall back to their nearest built-in here. Preview and WebCodecs export render all
// three correctly since they share the canvas compositor instead of xfade.
const XFADE_KIND: Record<TransitionKind, string> = {
  "fade-cross": "fade",
  "fade-black": "fadeblack",
  "fade-white": "fadewhite",
  "slide-left": "slideleft",
  "slide-right": "slideright",
  "slide-up": "slideup",
  "slide-down": "slidedown",
  "push-left": "slideleft", // approximation, see note above
  "push-right": "slideright",
  "push-up": "slideup",
  "push-down": "slidedown",
  "wipe-left": "wipeleft",
  "wipe-right": "wiperight",
  "wipe-clock": "radial",
  "wipe-circle": "circleopen",
  "zoom-in": "zoomin",
  "zoom-out": "dissolve", // approximation, xfade has no zoom-out primitive
  blur: "hblur",
  "blur-motion": "hblur", // approximation, see note above
  "iris-circle": "circleopen", // approximation, see note above
  "iris-square": "rectcrop", // approximation, see note above
};

interface OverlayLayer {
  label: string;
  cxPx: number;
  cyPx: number;
  start: number;
  end: number;
}

export async function exportFfmpeg(
  sources: SourceVideo[],
  tracks: Track[],
  clips: Clip[],
  transitions: Transition[],
  projectWidth: number,
  projectHeight: number,
  onProgress: (p: ExportProgress) => void
): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const duration = totalDuration(clips);

  onProgress({ ratio: 0, stage: "loading ffmpeg" });

  const sourceFileNames = new Map<string, string>();
  for (const source of sources) {
    const fileName = `src_${source.id}${extensionFor(source.file.name)}`;
    sourceFileNames.set(source.id, fileName);
    await ffmpeg.writeFile(fileName, await fetchFile(source.file));
  }

  // Flatten in z-order (bottom track first) and, within each track, chronologically — the
  // latter matters here because transitions/xfade chaining assumes left-to-right clip order.
  const orderedClips = tracks.flatMap((track) =>
    clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start)
  );
  const indexById = new Map(orderedClips.map((c, i) => [c.id, i]));

  // Pass 1: trim + reencode each clip to its own file (input index i == partNames[i]).
  const partNames: string[] = [];
  for (let i = 0; i < orderedClips.length; i++) {
    const clip = orderedClips[i];
    const srcName = sourceFileNames.get(clip.sourceId);
    if (!srcName) continue;
    const partName = `part_${i}.mp4`;
    partNames.push(partName);

    await ffmpeg.exec([
      "-ss", String(clip.inPoint),
      "-to", String(clip.outPoint),
      "-i", srcName,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-c:a", "aac",
      "-avoid_negative_ts", "make_zero",
      partName,
    ]);

    onProgress({ ratio: 0.1 + 0.5 * ((i + 1) / orderedClips.length), stage: `trimmed clip ${i + 1}/${orderedClips.length}` });
  }

  // Pass 2: composite the trimmed parts onto a black base canvas via a generated filter graph.
  const filterLines: string[] = [`color=c=black:s=${projectWidth}x${projectHeight}:d=${duration}:r=${EXPORT_FPS}[base]`];
  const overlays: OverlayLayer[] = [];
  const audioLabels: string[] = [];
  let labelSeq = 0;
  const nextLabel = (prefix: string) => `${prefix}${labelSeq++}`;

  // timeShift (seconds) rewrites this stream's PTS to start at that point on the global
  // timeline — required before the outer overlay's `enable=between(t,...)` gate can work.
  // Left undefined for clips feeding an xfade chain, which need to start at pts=0 instead;
  // the chain's merged output gets the shift applied once, after xfade, in the caller.
  function transformedClipFilter(
    clip: Clip,
    partIndex: number,
    timeShift?: number
  ): { label: string; cxPx: number; cyPx: number } {
    const source = sourceMap.get(clip.sourceId);
    const { transform } = clip;
    const boxW = projectWidth * transform.scale;
    const boxH = projectHeight * transform.scale;
    const { width: drawW, height: drawH } = source
      ? computeContainSize(source.width, source.height, boxW, boxH)
      : { width: boxW, height: boxH };
    const rotRad = (transform.rotation * Math.PI) / 180;
    const label = nextLabel("v");
    const shiftPrefix = timeShift !== undefined ? `setpts=PTS+${timeShift}/TB,` : "";
    filterLines.push(
      `[${partIndex}:v]${shiftPrefix}scale=${Math.max(2, Math.round(drawW))}:${Math.max(2, Math.round(drawH))},format=rgba,` +
        `rotate=${rotRad}:c=none:ow=rotw(${rotRad}):oh=roth(${rotRad}),colorchannelmixer=aa=${transform.opacity}[${label}]`
    );
    return {
      label,
      cxPx: Math.round(transform.x * projectWidth),
      cyPx: Math.round(transform.y * projectHeight),
    };
  }

  // Group each track's clips into transition-linked runs (a lone clip is its own 1-clip run).
  function buildRuns(trackClips: Clip[]): Clip[][] {
    const byLeft = new Map(transitions.filter((t) => t.trackId === trackClips[0]?.trackId).map((t) => [t.leftClipId, t]));
    const runs: Clip[][] = [];
    let current: Clip[] = [];
    for (const clip of trackClips) {
      current.push(clip);
      const linksToNext = byLeft.has(clip.id);
      if (!linksToNext) {
        runs.push(current);
        current = [];
      }
    }
    if (current.length > 0) runs.push(current);
    return runs;
  }

  for (const track of tracks) {
    const trackClips = orderedClips.filter((c) => c.trackId === track.id);
    if (trackClips.length === 0) continue;

    for (const run of buildRuns(trackClips)) {
      if (run.length === 1) {
        const clip = run[0];
        const partIndex = indexById.get(clip.id);
        if (partIndex === undefined) continue;

        if (track.kind !== "audio") {
          const { label, cxPx, cyPx } = transformedClipFilter(clip, partIndex, clip.start);
          overlays.push({ label, cxPx, cyPx, start: clip.start, end: clip.start + clipDuration(clip) });
        }
      } else if (track.kind !== "audio") {
        // Multi-clip run: bake each clip's own transform onto a full-canvas frame first (so xfade,
        // which just blends two equally-sized streams, doesn't need to know about per-clip transforms),
        // then chain xfade across those full-canvas frames.
        const fullLabels: string[] = [];
        for (const clip of run) {
          const partIndex = indexById.get(clip.id);
          if (partIndex === undefined) continue;
          const { label: transformedLabel, cxPx, cyPx } = transformedClipFilter(clip, partIndex);
          const bgLabel = nextLabel("bg");
          const fullLabel = nextLabel("full");
          filterLines.push(
            `color=c=black:s=${projectWidth}x${projectHeight}:d=${clipDuration(clip)}:r=${EXPORT_FPS}[${bgLabel}]`
          );
          filterLines.push(
            `[${bgLabel}][${transformedLabel}]overlay=x=(main_w-overlay_w)/2+${cxPx}:y=(main_h-overlay_h)/2+${cyPx},` +
              `fps=${EXPORT_FPS}[${fullLabel}]`
          );
          fullLabels.push(fullLabel);
        }

        let mergedLabel = fullLabels[0];
        let mergedDuration = clipDuration(run[0]);
        for (let i = 1; i < run.length; i++) {
          const transition = transitions.find((t) => t.leftClipId === run[i - 1].id && t.rightClipId === run[i].id);
          const transitionDuration = transition?.duration ?? 0;
          const xfadeKind = transition ? XFADE_KIND[transition.kind] : "fade";
          const offset = Math.max(0, mergedDuration - transitionDuration);
          const outLabel = nextLabel("m");
          filterLines.push(
            `[${mergedLabel}][${fullLabels[i]}]xfade=transition=${xfadeKind}:duration=${transitionDuration}:offset=${offset.toFixed(3)}[${outLabel}]`
          );
          mergedLabel = outLabel;
          mergedDuration = offset + clipDuration(run[i]);
        }

        const shiftedLabel = nextLabel("shifted");
        filterLines.push(`[${mergedLabel}]setpts=PTS+${run[0].start}/TB[${shiftedLabel}]`);
        overlays.push({ label: shiftedLabel, cxPx: 0, cyPx: 0, start: run[0].start, end: run[0].start + mergedDuration });
      }

      // Audio is handled per original clip regardless of visual transitions — the existing
      // delay+amix mix naturally overlaps during a transition window without extra work.
      for (const clip of run) {
        const partIndex = indexById.get(clip.id);
        if (partIndex === undefined) continue;
        if (track.muted || clip.audioMuted) continue;
        const delayMs = Math.round(clip.start * 1000);
        const aLabel = nextLabel("a");
        filterLines.push(`[${partIndex}:a]adelay=${delayMs}|${delayMs}[${aLabel}]`);
        audioLabels.push(aLabel);
      }
    }
  }

  let lastLabel = "base";
  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i];
    const outLabel = i === overlays.length - 1 ? "vout" : `tmp${i}`;
    filterLines.push(
      `[${lastLabel}][${o.label}]overlay=x=(main_w-overlay_w)/2+${o.cxPx}:y=(main_h-overlay_h)/2+${o.cyPx}:` +
        `enable='between(t,${o.start},${o.end})'[${outLabel}]`
    );
    lastLabel = outLabel;
  }
  if (overlays.length === 0) filterLines.push("[base]null[vout]");

  if (audioLabels.length > 0) {
    filterLines.push(
      `${audioLabels.map((l) => `[${l}]`).join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0[aout]`
    );
  }

  onProgress({ ratio: 0.7, stage: "compositing" });

  const inputArgs: string[] = [];
  for (const partName of partNames) inputArgs.push("-i", partName);

  await ffmpeg.exec([
    ...inputArgs,
    "-filter_complex", filterLines.join(";"),
    "-map", "[vout]",
    ...(audioLabels.length > 0 ? ["-map", "[aout]"] : ["-an"]),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    ...(audioLabels.length > 0 ? ["-c:a", "aac"] : []),
    "-t", String(duration),
    "output.mp4",
  ]);
  onProgress({ ratio: 1, stage: "done" });

  const data = await ffmpeg.readFile("output.mp4");
  const bytes = data as Uint8Array;
  return new Blob([bytes.slice()], { type: "video/mp4" });
}
