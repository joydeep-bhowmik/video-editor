export interface WaveformPeaks {
  min: number[];
  max: number[];
}

export type MediaKind = "video" | "audio" | "image";

export interface SourceVideo {
  id: string;
  kind: MediaKind;
  url: string;
  name: string;
  duration: number;
  thumbnail: string;
  filmstrip: string[];
  waveform: WaveformPeaks;
  width: number;
  height: number;
  file: File;
}

export interface Transform {
  /** Position of the anchor point on the canvas, as a fraction of canvas size from centre. */
  x: number;
  y: number;
  /** Uniform scale of the "contain"-fitted box. */
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number;
  /** Pivot for rotation/scale/skew, and the point that `x`/`y` positions. 0..1 within the clip box; 0.5 = centre. */
  anchorX: number;
  anchorY: number;
  /** Edge insets as a fraction of the source, cropped away before fitting. */
  cropTop: number;
  cropRight: number;
  cropBottom: number;
  cropLeft: number;
  flipH: boolean;
  flipV: boolean;
  /** Shear in degrees. */
  skewX: number;
  skewY: number;
  /** Pseudo-3D tilt about the vertical axis, -1..1 (0 = flat). */
  perspective: number;
}

export interface Track {
  id: string;
  name: string;
  kind: "video" | "audio";
  muted: boolean;
}

export type EffectKind =
  | "blur"
  | "green-screen"
  | "glow"
  | "shadow"
  | "black-white"
  | "vignette"
  | "pixelate"
  | "sharpen"
  | "film-grain"
  | "rgb-split";

export interface Effect {
  id: string;
  kind: EffectKind;
  /** 0..1, meaning is per-effect (blur radius, key tolerance, grain amount, …). */
  intensity: number;
  /** Width of the soft alpha ramp at the key edge. Chroma key only. */
  softness?: number;
  /** How hard to pull green tint out of the pixels that survive. Chroma key only. */
  spill?: number;
}

/** One animation keyframe: a value for a single transform property at a clip-local time. */
export interface Keyframe {
  id: string;
  /** Which numeric transform field this animates (see AnimatableProp). */
  prop: string;
  /** Seconds from the clip's start on the timeline. */
  time: number;
  value: number;
}

export interface Clip {
  id: string;
  trackId: string;
  sourceId: string;
  start: number;
  inPoint: number;
  outPoint: number;
  /** Static transform; used directly when the clip has no keyframes for a given property. */
  transform: Transform;
  audioMuted: boolean;
  effects: Effect[];
  keyframes: Keyframe[];
}

export type TransitionKind =
  | "fade-cross"
  | "fade-black"
  | "fade-white"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "push-left"
  | "push-right"
  | "push-up"
  | "push-down"
  | "wipe-left"
  | "wipe-right"
  | "wipe-clock"
  | "wipe-circle"
  | "zoom-in"
  | "zoom-out"
  | "blur"
  | "blur-motion"
  | "iris-circle"
  | "iris-square";

export interface Transition {
  id: string;
  trackId: string;
  leftClipId: string;
  rightClipId: string;
  kind: TransitionKind;
  duration: number;
}
