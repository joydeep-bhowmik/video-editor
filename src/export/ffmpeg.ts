import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { EXPORT_FPS } from "../lib/constants";
import { computeContainSize } from "../lib/compositor";
import { clipDuration, totalDuration } from "../lib/timeline";
import { resolveTransform } from "../lib/keyframes";
import type { Clip, Effect, TransitionKind } from "../types";
import type { ExportRequest } from "./index";
import { ExportCancelledError, QUALITY_PRESETS, throwIfAborted } from "./types";

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

/**
 * Map a clip's effect stack onto native ffmpeg filters.
 *
 * Most have direct equivalents. Two do not and are skipped rather than faked:
 *  - Glow needs a split/blur/screen sub-graph, which can't be expressed inline in this
 *    single-chain position without restructuring the whole graph.
 *  - Shadow is a compositing operation that paints *outside* the frame, so there's nothing
 *    for a per-clip pixel filter to do — the canvas renderer draws it during overlay instead.
 * Both still render correctly in the preview and the WebCodecs export.
 */
function effectFilters(effects: Effect[]): string[] {
  const out: string[] = [];
  for (const e of effects) {
    const i = e.intensity;
    switch (e.kind) {
      case "blur":
        out.push(`gblur=sigma=${(i * 14).toFixed(2)}`);
        break;
      case "black-white":
        out.push(`hue=s=${(1 - Math.min(1, i)).toFixed(3)}`);
        break;
      case "green-screen": {
        // Mirrors the canvas keyer: soft matte via chromakey's blend parameter, then a despill
        // pass — without despill the surviving edge pixels keep a green fringe.
        const similarity = (0.05 + i * 0.45).toFixed(3);
        const blend = Math.max(0.001, (e.softness ?? 0.35) * 0.35).toFixed(3);
        out.push(`chromakey=0x00FF00:${similarity}:${blend}`);
        const spill = e.spill ?? 0.85;
        if (spill > 0) out.push(`despill=type=green:mix=${spill.toFixed(2)}:expand=0`);
        break;
      }
      case "vignette":
        out.push(`vignette=angle=${(Math.PI / 5 + i * (Math.PI / 5)).toFixed(4)}`);
        break;
      case "pixelate": {
        // Native block-averaging filter — a scale-down/scale-up round trip can't be expressed
        // safely inline here, since `iw` would already refer to the reduced width.
        const block = Math.max(2, Math.round(2 + i * 30));
        out.push(`pixelize=w=${block}:h=${block}`);
        break;
      }
      case "sharpen":
        out.push(`unsharp=5:5:${(i * 2).toFixed(2)}:5:5:0`);
        break;
      case "film-grain":
        out.push(`noise=alls=${Math.round(i * 40)}:allf=t`);
        break;
      case "rgb-split": {
        const px = Math.max(1, Math.round(i * 12));
        out.push(`rgbashift=rh=${-px}:bh=${px}`);
        break;
      }
      case "glow":
      case "shadow":
        // No inline equivalent — see the note above.
        break;
    }
  }
  return out;
}

interface OverlayLayer {
  label: string;
  cxPx: number;
  cyPx: number;
  start: number;
  end: number;
}

export async function exportFfmpeg({
  settings,
  sources,
  tracks,
  clips,
  transitions,
  projectWidth,
  projectHeight,
  onProgress,
  signal,
}: ExportRequest): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  const crf = String(QUALITY_PRESETS[settings.quality].crf);

  // ffmpeg.wasm runs inside a worker and exec() can't be interrupted, so cancelling means
  // killing the worker outright. The singleton is dropped too, otherwise the next export
  // would reuse a terminated instance.
  const onAbort = () => {
    try {
      ffmpeg.terminate();
    } finally {
      ffmpegSingleton = null;
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
  throwIfAborted(signal);
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
    throwIfAborted(signal);
    const partName = `part_${i}.mp4`;
    partNames.push(partName);

    await ffmpeg.exec([
      "-ss", String(clip.inPoint),
      "-to", String(clip.outPoint),
      "-i", srcName,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", crf,
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
    // ffmpeg's per-clip filter graph is static, so an animated clip is flattened to a single
    // snapshot at its midpoint (the canvas engines animate properly — see the export dialog note).
    const transform = resolveTransform(clip, clipDuration(clip) / 2);

    // Crop trims the source before fitting, so the fitted box uses the *kept* aspect ratio.
    const keepW = Math.max(0.01, 1 - transform.cropLeft - transform.cropRight);
    const keepH = Math.max(0.01, 1 - transform.cropTop - transform.cropBottom);
    const cropW = source ? source.width * keepW : projectWidth;
    const cropH = source ? source.height * keepH : projectHeight;

    const boxW = projectWidth * transform.scale;
    const boxH = projectHeight * transform.scale;
    const { width: drawW, height: drawH } = computeContainSize(cropW, cropH, boxW, boxH);
    const rotRad = (transform.rotation * Math.PI) / 180;
    const label = nextLabel("v");
    const shiftPrefix = timeShift !== undefined ? `setpts=PTS+${timeShift}/TB,` : "";

    // Effects run before scale/rotate so they operate on the clip's own pixels, matching the
    // preview (where the effect pass happens on the raw frame, then the transform is applied).
    const fx = effectFilters(clip.effects);
    const fxPrefix = fx.length ? `${fx.join(",")},` : "";

    const cropped =
      keepW < 0.999 || keepH < 0.999
        ? `crop=iw*${keepW.toFixed(4)}:ih*${keepH.toFixed(4)}:iw*${transform.cropLeft.toFixed(4)}:ih*${transform.cropTop.toFixed(4)},`
        : "";
    const flip = `${transform.flipH ? "hflip," : ""}${transform.flipV ? "vflip," : ""}`;

    // Skew and perspective are non-affine warps that the canvas engines (preview + WebCodecs)
    // render, but there's no clean, verifiable ffmpeg equivalent that stays aligned with the
    // rest of this graph — so they're intentionally omitted here, like glow/shadow.
    filterLines.push(
      `[${partIndex}:v]${shiftPrefix}${fxPrefix}${cropped}${flip}scale=${Math.max(2, Math.round(drawW))}:${Math.max(2, Math.round(drawH))},format=rgba,` +
        `rotate=${rotRad}:c=none:ow=rotw(${rotRad}):oh=roth(${rotRad}),colorchannelmixer=aa=${transform.opacity}[${label}]`
    );

    // The overlay centres the layer; shift so the anchor point (not the centre) lands at the
    // target position. The anchor offset is measured in the un-rotated layer, then rotated to
    // match the rotate filter's expansion about the layer centre.
    const axPx = (transform.anchorX - 0.5) * drawW;
    const ayPx = (transform.anchorY - 0.5) * drawH;
    const cos = Math.cos(rotRad);
    const sin = Math.sin(rotRad);
    const rx = cos * axPx - sin * ayPx;
    const ry = sin * axPx + cos * ayPx;

    return {
      label,
      cxPx: Math.round(transform.x * projectWidth - rx),
      cyPx: Math.round(transform.y * projectHeight - ry),
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

  if (audioLabels.length === 1) {
    // amix is meant for combining 2+ streams; skip it for the (very common) single-clip case
    // rather than rely on inputs=1 being a clean passthrough.
    filterLines.push(`[${audioLabels[0]}]anull[aout]`);
  } else if (audioLabels.length > 1) {
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
    "-crf", crf,
    ...(audioLabels.length > 0 ? ["-c:a", "aac"] : []),
    "-t", String(duration),
    "output.mp4",
  ]);
  onProgress({ ratio: 1, stage: "done" });

  throwIfAborted(signal);
  const data = await ffmpeg.readFile("output.mp4");
  const bytes = data as Uint8Array;
  return new Blob([bytes.slice()], { type: "video/mp4" });
  } catch (err) {
    // terminate() makes whatever exec() was in flight reject with a generic "ffmpeg is not
    // loaded" error. That's a cancellation, not a failure — report it as one so the caller
    // doesn't show the user an error for something they asked for.
    if (signal?.aborted) throw new ExportCancelledError();
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Mix just the timeline's audio into one AAC file (returns null when nothing is audible). Used
 * to give the WebCodecs video path — which can't produce audio — a soundtrack to mux back in.
 */
export async function exportFfmpegAudio({
  sources,
  tracks,
  clips,
  onProgress,
  signal,
}: ExportRequest): Promise<Uint8Array | null> {
  const audible = clips.filter((c) => {
    const track = tracks.find((t) => t.id === c.trackId);
    return track && !track.muted && !c.audioMuted;
  });
  if (audible.length === 0) return null;

  const ffmpeg = await getFFmpeg();
  throwIfAborted(signal);
  onProgress({ ratio: 0, stage: "mixing audio" });

  const written = new Map<string, string>();
  for (const source of sources) {
    const name = `aud_${source.id}${extensionFor(source.file.name)}`;
    written.set(source.id, name);
    await ffmpeg.writeFile(name, await fetchFile(source.file));
  }

  // Trim each audible clip's audio to its own file, then delay+mix onto the timeline.
  const parts: string[] = [];
  for (let i = 0; i < audible.length; i++) {
    const clip = audible[i];
    const src = written.get(clip.sourceId);
    if (!src) continue;
    throwIfAborted(signal);
    const part = `apart_${i}.m4a`;
    await ffmpeg.exec(["-ss", String(clip.inPoint), "-to", String(clip.outPoint), "-i", src, "-vn", "-c:a", "aac", part]);
    parts.push(part);
  }
  if (parts.length === 0) return null;

  const filter = audible
    .map((clip, i) => {
      const delayMs = Math.round(clip.start * 1000);
      return `[${i}:a]adelay=${delayMs}|${delayMs}[d${i}]`;
    })
    .join(";");
  const mix =
    parts.length === 1
      ? `${filter};[d0]anull[aout]`
      : `${filter};${audible.map((_, i) => `[d${i}]`).join("")}amix=inputs=${parts.length}:duration=longest:normalize=0[aout]`;

  await ffmpeg.exec([
    ...parts.flatMap((p) => ["-i", p]),
    "-filter_complex", mix,
    "-map", "[aout]",
    "-c:a", "aac",
    "audio_only.m4a",
  ]);
  throwIfAborted(signal);
  const data = (await ffmpeg.readFile("audio_only.m4a")) as Uint8Array;
  return data.slice();
}

/** Combine a (silent) video blob with an AAC audio track without re-encoding the video. */
export async function muxVideoAudio(video: Blob, audio: Uint8Array): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  await ffmpeg.writeFile("mux_v.mp4", new Uint8Array(await video.arrayBuffer()));
  await ffmpeg.writeFile("mux_a.m4a", audio);
  await ffmpeg.exec([
    "-i", "mux_v.mp4",
    "-i", "mux_a.m4a",
    "-c:v", "copy",
    "-c:a", "aac",
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-shortest",
    "mux_out.mp4",
  ]);
  const data = (await ffmpeg.readFile("mux_out.mp4")) as Uint8Array;
  return new Blob([data.slice()], { type: "video/mp4" });
}
