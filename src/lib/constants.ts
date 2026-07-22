import type { Transform } from "../types";

export const PX_PER_SEC = 90;
export const TRACK_HEIGHT = 64;
export const MIN_CLIP_DURATION = 0.1;
export const MIN_SPLIT_MARGIN = 0.15;

export const DEFAULT_TRANSFORM_BASE: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
};

export const DEFAULT_TRANSFORM_OVERLAY: Transform = {
  x: 0.28,
  y: -0.28,
  scale: 0.4,
  rotation: 0,
  opacity: 1,
};

export const DEFAULT_PROJECT_WIDTH = 1280;
export const DEFAULT_PROJECT_HEIGHT = 720;

export const EXPORT_FPS = 30;
