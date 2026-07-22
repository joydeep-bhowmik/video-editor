export type ExportEngine = "auto" | "ffmpeg" | "webcodecs";

export interface ExportProgress {
  ratio: number;
  stage: string;
}

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
