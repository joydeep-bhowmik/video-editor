export type ExportEngine = "auto" | "ffmpeg" | "webcodecs";
export type ExportQuality = "high" | "balanced" | "small";

export interface ExportProgress {
  ratio: number;
  stage: string;
}

export interface ExportSettings {
  engine: ExportEngine;
  quality: ExportQuality;
}

/** Thrown when the user cancels — callers treat this as a normal outcome, not a failure. */
export class ExportCancelledError extends Error {
  constructor() {
    super("Export cancelled");
    this.name = "ExportCancelledError";
  }
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new ExportCancelledError();
}

/** CRF for ffmpeg (lower = better) and target bitrate for the WebCodecs encoder. */
export const QUALITY_PRESETS: Record<ExportQuality, { crf: number; bitrate: number }> = {
  high: { crf: 18, bitrate: 12_000_000 },
  balanced: { crf: 22, bitrate: 6_000_000 },
  small: { crf: 28, bitrate: 2_500_000 },
};

export function webCodecsSupported(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;
}

export function resolveEngine(engine: ExportEngine): "ffmpeg" | "webcodecs" {
  // WebCodecs export has no audio path — Auto defaults to ffmpeg (correct output) rather than
  // the faster engine that silently drops every clip's sound. WebCodecs stays available as an
  // explicit choice for when speed matters more than audio.
  if (engine === "auto") return "ffmpeg";
  return engine;
}
