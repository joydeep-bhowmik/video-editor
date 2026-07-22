/**
 * One <video> element per CLIP, not per source.
 *
 * Keying by source id looks like a harmless dedupe, but two clips that share a source
 * (the same video on two tracks, or a clip that was split) would then share one element —
 * and each playback tick would fight over its `muted` flag and `currentTime`, killing audio,
 * lurching the playhead, and drawing the same frame on every layer.
 */
const pool = new Map<string, HTMLVideoElement>();

export function getClipVideo(clipId: string, url: string): HTMLVideoElement {
  const existing = pool.get(clipId);
  if (existing) return existing;

  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  pool.set(clipId, video);
  return video;
}

/** Look up a clip's element without creating one. */
export function peekClipVideo(clipId: string): HTMLVideoElement | undefined {
  return pool.get(clipId);
}

/** Release elements (and their decoders) for clips that no longer exist. */
export function pruneClipVideos(liveClipIds: Set<string>) {
  for (const [clipId, video] of pool) {
    if (liveClipIds.has(clipId)) continue;
    video.pause();
    video.removeAttribute("src");
    video.load();
    pool.delete(clipId);
  }
}
