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

export interface InsertPlan {
  /** Where the new clip should start. */
  start: number;
  /** Clips on this track starting at or after this point get shifted right. */
  rippleFrom: number;
  /** How far to shift them (0 = everything already fits, nothing moves). */
  rippleBy: number;
}

/**
 * Decide where a newly dropped clip of `duration` goes, from the raw `dropTime` under the cursor.
 *
 * Unlike clampClipStart (which only ever finds existing free space and is right for *moving* a
 * clip), this implements insert semantics: dropping onto the left half of a clip puts the new
 * clip before it, the right half puts it after, and either way the clips at/after that point are
 * pushed right to open up room. That's the only way to honour "I cut here, now insert between the
 * halves" — after a cut the two halves are contiguous, so there is no gap to find.
 *
 * Dropping into a gap that's already big enough places the clip there with nothing displaced.
 * Only the target track ripples; other tracks are left alone.
 */
export function planInsert(
  clips: Clip[],
  trackId: string,
  dropTime: number,
  duration: number
): InsertPlan {
  const trackClips = clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
  const t = Math.max(0, dropTime);

  // 1. Snap the raw drop point to an insertion boundary: dropping on a clip means "before" or
  //    "after" that clip depending on which half you hit. A drop in open space stays put.
  const covering = trackClips.find((c) => t >= c.start && t < c.start + clipDuration(c));
  let insertAt = t;
  if (covering) {
    const mid = covering.start + clipDuration(covering) / 2;
    insertAt = t < mid ? covering.start : covering.start + clipDuration(covering);
  }

  // 2. Measure the free gap around that boundary.
  let gapStart = 0;
  let gapEnd = Infinity;
  for (const c of trackClips) {
    const end = c.start + clipDuration(c);
    if (end <= insertAt) gapStart = Math.max(gapStart, end);
    if (c.start >= insertAt) gapEnd = Math.min(gapEnd, c.start);
  }

  // 3. Fits as-is? Drop it in, nudging only enough to stay inside the gap.
  if (gapEnd - gapStart >= duration) {
    const start = Math.min(Math.max(insertAt, gapStart), gapEnd - duration);
    return { start, rippleFrom: 0, rippleBy: 0 };
  }

  // 4. Doesn't fit: keep the user's intended position and push the rest of the track right by
  //    exactly the overflow.
  return { start: insertAt, rippleFrom: insertAt, rippleBy: insertAt + duration - gapEnd };
}

/**
 * Find the closest non-overlapping start position to `desiredStart` for a clip of `duration`
 * on this track. Works by carving the track into free gaps between siblings (plus one
 * open-ended gap after the last clip) and picking the closest valid position within whichever
 * gap is big enough to hold the clip — this guarantees the result never overlaps a sibling,
 * unlike naively bumping against one sibling at a time (a too-small gap on one side used to
 * get clamped to 0 and silently overlap anyway).
 */
export function clampClipStart(
  clips: Clip[],
  trackId: string,
  clipId: string,
  desiredStart: number,
  duration: number
): number {
  const siblings = clips
    .filter((c) => c.trackId === trackId && c.id !== clipId)
    .sort((a, b) => a.start - b.start);

  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const sib of siblings) {
    if (sib.start > cursor) gaps.push({ start: cursor, end: sib.start });
    cursor = Math.max(cursor, sib.start + clipDuration(sib));
  }
  gaps.push({ start: cursor, end: Infinity });

  const desired = Math.max(0, desiredStart);
  let best = 0;
  let bestDist = Infinity;
  for (const gap of gaps) {
    if (gap.end - gap.start < duration) continue; // clip doesn't fit in this gap at all
    const candidate = Math.min(Math.max(desired, gap.start), gap.end - duration);
    const dist = Math.abs(candidate - desired);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}
