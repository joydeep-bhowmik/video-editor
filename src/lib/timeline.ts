import { MIN_SPLIT_MARGIN } from "./constants";
import type { Clip } from "../types";

export function clipDuration(c: Clip): number {
  return c.outPoint - c.inPoint;
}

export function totalDuration(clips: Clip[]): number {
  return clips.reduce((max, c) => Math.max(max, c.start + clipDuration(c)), 0);
}

export function findActiveClip(clips: Clip[], trackId: string, time: number): Clip | undefined {
  return clips.find(
    (c) => c.trackId === trackId && time >= c.start && time < c.start + clipDuration(c)
  );
}

export function isClipActiveAt(clip: Clip, time: number): boolean {
  return time >= clip.start && time < clip.start + clipDuration(clip);
}

/**
 * How long a clip anchored at `start` may run before it would overlap the next clip on its
 * track. Both trim edges grow the clip rightward from a fixed `start`, so this is the only
 * bound trimming needs — without it a clip can be trimmed straight over its neighbour, and
 * findActiveClip then has two candidates for the same instant.
 */
export function maxClipDurationAt(
  clips: Clip[],
  trackId: string,
  clipId: string,
  start: number
): number {
  let limit = Infinity;
  for (const c of clips) {
    if (c.trackId !== trackId || c.id === clipId) continue;
    if (c.start >= start) limit = Math.min(limit, c.start - start);
  }
  return limit;
}

/**
 * Split a clip at `time` into two clips (same content, contiguous). Returns null if the clip
 * isn't the one active at `time`, or `time` is too close to either edge to leave both halves
 * a sane minimum length.
 */
export function splitClipAt(
  clips: Clip[],
  clipId: string,
  time: number
): { first: Clip; second: Clip } | null {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip || !isClipActiveAt(clip, time)) return null;

  const offset = time - clip.start;
  const dur = clipDuration(clip);
  if (offset < MIN_SPLIT_MARGIN || offset > dur - MIN_SPLIT_MARGIN) return null;

  const splitAt = clip.inPoint + offset;
  const first: Clip = { ...clip, outPoint: splitAt };
  const second: Clip = { ...clip, id: crypto.randomUUID(), start: time, inPoint: splitAt };
  return { first, second };
}

/** Clamp a desired start position against sibling clips on the same track (bump-stop at nearest free edge). */
export function clampClipStart(
  clips: Clip[],
  trackId: string,
  clipId: string,
  desiredStart: number,
  duration: number
): number {
  let start = Math.max(0, desiredStart);
  const siblings = clips
    .filter((c) => c.trackId === trackId && c.id !== clipId)
    .sort((a, b) => a.start - b.start);

  for (const sib of siblings) {
    const sibEnd = sib.start + clipDuration(sib);
    const overlaps = start < sibEnd && start + duration > sib.start;
    if (!overlaps) continue;

    const before = Math.max(0, sib.start - duration);
    const after = sibEnd;
    // Pick whichever free edge is closer to where the user was dragging toward.
    start = Math.abs(desiredStart - before) <= Math.abs(desiredStart - after) ? before : after;
  }

  return Math.max(0, start);
}
