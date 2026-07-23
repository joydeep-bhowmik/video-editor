import type { Clip, Keyframe, Transform } from "../types";

/** Numeric transform fields that can be animated. Booleans (flips) can't be interpolated. */
export type AnimatableProp =
  | "x"
  | "y"
  | "scale"
  | "rotation"
  | "opacity"
  | "anchorX"
  | "anchorY"
  | "cropTop"
  | "cropRight"
  | "cropBottom"
  | "cropLeft"
  | "skewX"
  | "skewY"
  | "perspective";

export const ANIMATABLE_PROPS: AnimatableProp[] = [
  "x",
  "y",
  "scale",
  "rotation",
  "opacity",
  "anchorX",
  "anchorY",
  "cropTop",
  "cropRight",
  "cropBottom",
  "cropLeft",
  "skewX",
  "skewY",
  "perspective",
];

/** Two keyframes at the same prop within this many seconds are treated as the same one. */
export const KEYFRAME_EPSILON = 0.015;

function forProp(clip: Clip, prop: AnimatableProp): Keyframe[] {
  return clip.keyframes.filter((k) => k.prop === prop).sort((a, b) => a.time - b.time);
}

/** Linear-interpolated value of a prop at a clip-local time, from its keyframes (clamped at ends). */
function sample(kfs: Keyframe[], time: number): number {
  if (kfs.length === 1 || time <= kfs[0].time) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (time >= last.time) return last.value;
  for (let i = 1; i < kfs.length; i++) {
    const b = kfs[i];
    if (time <= b.time) {
      const a = kfs[i - 1];
      const span = b.time - a.time;
      const t = span > 0 ? (time - a.time) / span : 0;
      return a.value + (b.value - a.value) * t;
    }
  }
  return last.value;
}

export function clipHasKeyframes(clip: Clip): boolean {
  return clip.keyframes.length > 0;
}

export function propHasKeyframes(clip: Clip, prop: AnimatableProp): boolean {
  return clip.keyframes.some((k) => k.prop === prop);
}

/** The keyframe on this prop at (approximately) `time`, if any. */
export function keyframeAt(clip: Clip, prop: AnimatableProp, time: number): Keyframe | undefined {
  return clip.keyframes.find((k) => k.prop === prop && Math.abs(k.time - time) <= KEYFRAME_EPSILON);
}

/** Value of a prop at a clip-local time: interpolated if animated, else the static base. */
export function valueAt(clip: Clip, prop: AnimatableProp, time: number): number {
  const kfs = forProp(clip, prop);
  if (kfs.length === 0) return clip.transform[prop];
  return sample(kfs, time);
}

/**
 * The transform to actually render at a clip-local time. Falls back to the static transform
 * untouched when the clip has no keyframes, so the common (un-animated) case allocates nothing.
 */
export function resolveTransform(clip: Clip, localTime: number): Transform {
  if (clip.keyframes.length === 0) return clip.transform;
  const t = { ...clip.transform };
  for (const prop of ANIMATABLE_PROPS) {
    const kfs = forProp(clip, prop);
    if (kfs.length > 0) t[prop] = sample(kfs, localTime);
  }
  return t;
}

/** Sorted, de-duplicated clip-local times that have at least one keyframe on any prop. */
export function keyframeTimes(clip: Clip): number[] {
  const times = new Set<number>();
  for (const k of clip.keyframes) times.add(Math.round(k.time / KEYFRAME_EPSILON) * KEYFRAME_EPSILON);
  return [...times].sort((a, b) => a - b);
}

// --- pure mutations (return a new keyframes array) --------------------------

export function upsertKeyframe(
  keyframes: Keyframe[],
  prop: AnimatableProp,
  time: number,
  value: number
): Keyframe[] {
  const existing = keyframes.find((k) => k.prop === prop && Math.abs(k.time - time) <= KEYFRAME_EPSILON);
  if (existing) return keyframes.map((k) => (k === existing ? { ...k, value } : k));
  return [...keyframes, { id: crypto.randomUUID(), prop, time, value }];
}

export function removeKeyframeAt(keyframes: Keyframe[], prop: AnimatableProp, time: number): Keyframe[] {
  return keyframes.filter((k) => !(k.prop === prop && Math.abs(k.time - time) <= KEYFRAME_EPSILON));
}
