import { throwIfAborted } from "./cancel";

export interface VideoMeta {
  duration: number;
  thumbnail: string;
  filmstrip: string[];
  width: number;
  height: number;
}

const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 90;
const TILE_WIDTH = 60;
const TILE_HEIGHT = 34;
const FILMSTRIP_COUNT = 8;
const STEP_TIMEOUT_MS = 15_000;
// duration + thumbnail + one step per filmstrip tile
const TOTAL_STEPS = 2 + FILMSTRIP_COUNT;

/** Load a still image and build the same metadata shape a video produces. */
export async function loadImageMeta(
  url: string,
  duration: number,
  signal?: AbortSignal
): Promise<VideoMeta> {
  throwIfAborted(signal);
  const img = new Image();
  img.src = url;
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("failed to load image"));
    }),
    "timed out loading image"
  );
  throwIfAborted(signal);

  const width = img.naturalWidth;
  const height = img.naturalHeight;

  // A downscaled thumbnail; the filmstrip is that same still repeated across the tiles.
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const ctx = canvas.getContext("2d");
  let thumbnail = "";
  if (ctx) {
    ctx.drawImage(img, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    thumbnail = canvas.toDataURL("image/jpeg", 0.6);
  }

  return { duration, thumbnail, filmstrip: thumbnail ? [thumbnail] : [], width, height };
}

function captureFrame(video: HTMLVideoElement, width: number, height: number): string {
  if (video.videoWidth === 0 || video.videoHeight === 0) {
    // Audio-only file loaded into a <video> element — no visual frame to grab.
    throw new Error("source has no video track");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.6);
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), STEP_TIMEOUT_MS);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return withTimeout(
    new Promise((resolve) => {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      video.addEventListener("seeked", onSeeked);
      video.currentTime = time;
    }),
    "timed out waiting for video to seek"
  );
}

export async function loadVideoMeta(
  url: string,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal
): Promise<VideoMeta> {
  throwIfAborted(signal);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.src = url;

  await withTimeout(
    new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error(`failed to load video: ${video.error?.message ?? "unknown error"}`));
    }),
    "timed out loading video metadata"
  );
  throwIfAborted(signal);
  onProgress?.(1 / TOTAL_STEPS);

  const duration = video.duration;
  const width = video.videoWidth;
  const height = video.videoHeight;

  let thumbnail = "";
  try {
    await seekTo(video, duration ? Math.min(duration / 2, Math.max(duration - 0.05, 0)) : 0);
    thumbnail = captureFrame(video, THUMB_WIDTH, THUMB_HEIGHT);
  } catch (e) {
    console.error("thumbnail capture failed", e);
  }
  onProgress?.(2 / TOTAL_STEPS);

  const filmstrip: string[] = [];
  for (let i = 0; i < FILMSTRIP_COUNT; i++) {
    throwIfAborted(signal);
    const t = duration ? (duration * i) / (FILMSTRIP_COUNT - 1) : 0;
    try {
      await seekTo(video, Math.min(t, Math.max(0, duration - 0.05)));
      filmstrip.push(captureFrame(video, TILE_WIDTH, TILE_HEIGHT));
    } catch (e) {
      console.error("filmstrip frame capture failed", e);
    }
    onProgress?.((3 + i) / TOTAL_STEPS);
  }

  if (!thumbnail) thumbnail = filmstrip[0] ?? "";

  return { duration, thumbnail, filmstrip, width, height };
}
