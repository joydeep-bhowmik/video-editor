import type { Clip, SourceVideo, Track, Transition } from "../types";
import { exportFfmpeg } from "./ffmpeg";
import { exportWebCodecs } from "./webcodecs";
import { resolveEngine, type ExportEngine, type ExportProgress } from "./types";

export type { ExportEngine, ExportProgress } from "./types";
export { webCodecsSupported } from "./types";

export async function runExport(
  engine: ExportEngine,
  sources: SourceVideo[],
  tracks: Track[],
  clips: Clip[],
  transitions: Transition[],
  projectWidth: number,
  projectHeight: number,
  onProgress: (p: ExportProgress) => void
): Promise<Blob> {
  const resolved = resolveEngine(engine);
  if (resolved === "webcodecs") {
    return exportWebCodecs(sources, tracks, clips, transitions, projectWidth, projectHeight, onProgress);
  }
  return exportFfmpeg(sources, tracks, clips, transitions, projectWidth, projectHeight, onProgress);
}
