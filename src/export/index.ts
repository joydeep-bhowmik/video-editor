import type { Clip, SourceVideo, Track, Transition } from "../types";
import { exportFfmpeg } from "./ffmpeg";
import { exportWebCodecs } from "./webcodecs";
import { resolveEngine, type ExportProgress, type ExportSettings } from "./types";

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

export async function runExport(request: ExportRequest): Promise<Blob> {
  const resolved = resolveEngine(request.settings.engine);
  return resolved === "webcodecs" ? exportWebCodecs(request) : exportFfmpeg(request);
}
