export type ExportEngine = "auto" | "ffmpeg" | "webcodecs";

export interface ExportProgress {
  ratio: number;
  stage: string;
}

export function webCodecsSupported(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;
}

export function resolveEngine(engine: ExportEngine): "ffmpeg" | "webcodecs" {
  if (engine === "auto") return webCodecsSupported() ? "webcodecs" : "ffmpeg";
  return engine;
}
