import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { EXPORT_FPS } from "../lib/constants";
import { drawFrame } from "../lib/compositor";
import { findActiveClip, totalDuration } from "../lib/timeline";
import { findTransitionAt } from "../lib/transitions";
import { getClipVideo } from "../lib/videoPool";
import type { Clip, SourceVideo, Track, Transition } from "../types";
import type { ExportProgress } from "./types";

function seekIfNeeded(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.008) return Promise.resolve();
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
}

function waitFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export async function exportWebCodecs(
  sources: SourceVideo[],
  tracks: Track[],
  clips: Clip[],
  transitions: Transition[],
  projectWidth: number,
  projectHeight: number,
  onProgress: (p: ExportProgress) => void
): Promise<Blob> {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const duration = totalDuration(clips);

  const canvas = document.createElement("canvas");
  canvas.width = projectWidth;
  canvas.height = projectHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: projectWidth, height: projectHeight },
    fastStart: "in-memory",
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error("VideoEncoder error", e),
  });
  encoder.configure({
    codec: "avc1.42001f",
    width: projectWidth,
    height: projectHeight,
    bitrate: 6_000_000,
    framerate: EXPORT_FPS,
  });

  const frameStep = 1 / EXPORT_FPS;
  let frameIndex = 0;

  for (let t = 0; t < duration; t += frameStep) {
    const seeks: Promise<void>[] = [];
    for (const track of tracks) {
      if (track.kind === "audio") continue; // this export path is video-only; no need to seek audio-only tracks
      const active = findTransitionAt(transitions, clips, track.id, t);
      const trackClips = active
        ? [
            clips.find((c) => c.id === active.transition.leftClipId),
            clips.find((c) => c.id === active.transition.rightClipId),
          ].filter((c): c is Clip => !!c)
        : [findActiveClip(clips, track.id, t)].filter((c): c is Clip => !!c);

      for (const clip of trackClips) {
        const source = sourceMap.get(clip.sourceId);
        if (!source) continue;
        const video = getClipVideo(clip.id, source.url);
        const sourceTime = clip.inPoint + (t - clip.start);
        seeks.push(seekIfNeeded(video, sourceTime));
      }
    }
    await Promise.all(seeks);
    await waitFrame();

    drawFrame(ctx, tracks, clips, transitions, sourceMap, t, projectWidth, projectHeight);

    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(t * 1_000_000),
      duration: Math.round(frameStep * 1_000_000),
    });
    encoder.encode(frame, { keyFrame: frameIndex === 0 });
    frame.close();
    frameIndex++;

    onProgress({ ratio: Math.min(1, t / duration), stage: `compositing frame ${frameIndex}` });
  }

  await encoder.flush();
  muxer.finalize();
  const { buffer } = muxer.target as InstanceType<typeof ArrayBufferTarget>;
  return new Blob([buffer], { type: "video/mp4" });
}
