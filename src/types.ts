export interface WaveformPeaks {
  min: number[];
  max: number[];
}

export interface SourceVideo {
  id: string;
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
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
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
}

export interface Clip {
  id: string;
  trackId: string;
  sourceId: string;
  start: number;
  inPoint: number;
  outPoint: number;
  transform: Transform;
  audioMuted: boolean;
  effects: Effect[];
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
