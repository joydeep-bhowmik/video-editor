import type { Clip, SourceVideo, Track, Transition } from "../types";
import { exportFfmpeg, exportFfmpegAudio, muxVideoAudio } from "./ffmpeg";
import { exportWebCodecs } from "./webcodecs";
import { resolveEngine, webCodecsSupported, type ExportProgress, type ExportSettings } from "./types";

export type { ExportEngine, ExportProgress, ExportQuality, ExportSettings } from "./types";
export { webCodecsSupported, ExportCancelledError } from "./types";

export interface ExportRequest {
  settings: ExportSettings;
  sources: SourceVideo[];
  tracks: Track[];
  clips: Clip[];
  transitions: Transition[];
  projectWidth: number;
  projectHeight: number;
  onProgress: (p: ExportProgress) => void;
  signal?: AbortSignal;
}

/** True when any clip is keyframe-animated, so its transform changes over time. */
export function projectHasAnimation(clips: Clip[]): boolean {
  return clips.some((c) => c.keyframes.length > 0);
}

export async function runExport(request: ExportRequest): Promise<Blob> {
  const resolved = resolveEngine(request.settings.engine);
  if (resolved === "webcodecs") return exportWebCodecs(request);

  // ffmpeg's per-clip filter graph is static, so it can't render keyframe motion. When the
  // project is animated, render the video through the canvas compositor (via WebCodecs, which
  // animates exactly like the preview) and mux ffmpeg's audio mix back in — keeping both the
  // animation and the sound. Falls back to the static ffmpeg path if WebCodecs isn't available.
  if (projectHasAnimation(request.clips) && webCodecsSupported()) {
    const video = await exportWebCodecs({
      ...request,
      onProgress: (p) => request.onProgress({ ratio: p.ratio * 0.8, stage: p.stage }),
    });
    const audio = await exportFfmpegAudio({
      ...request,
      onProgress: (p) => request.onProgress({ ratio: 0.8 + p.ratio * 0.15, stage: p.stage }),
    });
    if (!audio) return video;
    request.onProgress({ ratio: 0.96, stage: "combining video and audio" });
    return muxVideoAudio(video, audio);
  }

  return exportFfmpeg(request);
}
