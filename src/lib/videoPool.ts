import type { SourceVideo } from "../types";

export type ClipMedia = HTMLVideoElement | HTMLImageElement;

/**
 * One media element per CLIP, not per source.
 *
 * Keying by source id looks like a harmless dedupe, but two clips that share a source
 * (the same video on two tracks, or a clip that was split) would then share one element —
 * and each playback tick would fight over its `muted` flag and `currentTime`, killing audio,
 * lurching the playhead, and drawing the same frame on every layer.
 *
 * Image clips get an <img>; video/audio clips get a <video>.
 */
const pool = new Map<string, ClipMedia>();

/** Create (or fetch) the element for a clip, choosing <img> vs <video> from the source kind. */
export function getClipMedia(clipId: string, source: SourceVideo): ClipMedia {
  const existing = pool.get(clipId);
  if (existing) return existing;

  if (source.kind === "image") {
    const img = new Image();
    img.src = source.url;
    pool.set(clipId, img);
    return img;
  }

  const video = document.createElement("video");
  video.src = source.url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  pool.set(clipId, video);
  return video;
}

/** Legacy accessor kept for the few call sites that only ever deal with real videos. */
export function getClipVideo(clipId: string, url: string): HTMLVideoElement {
  const existing = pool.get(clipId);
  if (existing instanceof HTMLVideoElement) return existing;
  if (existing) pool.delete(clipId); // a stale image element — replace it

  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  pool.set(clipId, video);
  return video;
}

/** True when the element has a frame ready to draw. */
export function isMediaReady(media: ClipMedia): boolean {
  return media instanceof HTMLVideoElement ? media.readyState >= 2 : media.complete && media.naturalWidth > 0;
}

/** Look up a clip's element without creating one. */
export function peekClipVideo(clipId: string): HTMLVideoElement | undefined {
  const media = pool.get(clipId);
  return media instanceof HTMLVideoElement ? media : undefined;
}

/** Release elements (and their decoders) for clips that no longer exist. */
export function pruneClipVideos(liveClipIds: Set<string>) {
  for (const [clipId, media] of pool) {
    if (liveClipIds.has(clipId)) continue;
    if (media instanceof HTMLVideoElement) {
      media.pause();
      media.removeAttribute("src");
      media.load();
    }
    pool.delete(clipId);
  }
}
