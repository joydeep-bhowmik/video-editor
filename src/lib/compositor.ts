import { renderEffects, shadowFor } from "./effects";
import { resolveTransform } from "./keyframes";
import { findActiveClip } from "./timeline";
import { findTransitionAt, drawTransitionFrame } from "./transitions";
import { getClipMedia, isMediaReady, type ClipMedia } from "./videoPool";
import type { Clip, SourceVideo, Track, Transform, Transition } from "../types";

/** "contain" fit: largest box of srcW:srcH aspect that fits inside boxW x boxH. */
export function computeContainSize(srcW: number, srcH: number, boxW: number, boxH: number) {
  const srcAspect = srcW / srcH || 1;
  const boxAspect = boxW / boxH || 1;
  if (srcAspect > boxAspect) {
    return { width: boxW, height: boxW / srcAspect };
  }
  return { width: boxH * srcAspect, height: boxH };
}

/** Intrinsic size of whatever we're drawing — videos and canvases report it differently. */
function sourceSize(image: CanvasImageSource): { w: number; h: number } {
  if (image instanceof HTMLVideoElement) return { w: image.videoWidth, h: image.videoHeight };
  if (image instanceof HTMLCanvasElement) return { w: image.width, h: image.height };
  const anyImage = image as { width?: number; height?: number };
  return { w: anyImage.width ?? 0, h: anyImage.height ?? 0 };
}

export interface ShadowSpec {
  blur: number;
  color: string;
}

const DEG = Math.PI / 180;
const SKEW_CLAMP = 80; // tan blows up toward 90°, so cap the shear angle
const PERSP_STRIPS = 48;
const PERSP_MAX_TILT = 1.7; // far edge shrinks to 1/(1+this) at |perspective| = 1

// A single reusable scratch canvas for the perspective warp. It's baked and immediately drawn
// onto the target within drawClip, so one shared instance is safe even when a transition renders
// two clips in the same frame.
let perspScratch: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
function getPerspScratch(w: number, h: number) {
  if (!perspScratch) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    perspScratch = { canvas, ctx };
  }
  const { canvas, ctx } = perspScratch;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return perspScratch;
}

/**
 * Warp a cropped source region into a drawW×drawH canvas with a pseudo-3D tilt about the
 * vertical axis. Canvas 2D can't do a true projective transform, so this slices the image into
 * vertical strips and gives each a perspective-correct (hyperbolic) vertical scale plus
 * compressed horizontal spacing toward the receding edge — real foreshortening, not a linear
 * keystone. `perspective` > 0 pushes the right edge away, < 0 the left.
 */
function warpPerspective(
  image: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  drawW: number,
  drawH: number,
  perspective: number
): HTMLCanvasElement {
  const w = Math.max(1, Math.round(drawW));
  const h = Math.max(1, Math.round(drawH));
  const { canvas, ctx } = getPerspScratch(w, h);

  const k = Math.abs(perspective) * PERSP_MAX_TILT;
  // Near edge stays full size; far edge shrinks. Which edge is "far" flips with the sign.
  const nearS = 1;
  const farS = 1 / (1 + k);
  const s0 = perspective >= 0 ? nearS : farS; // scale at left edge
  const s1 = perspective >= 0 ? farS : nearS; // scale at right edge
  const inv0 = 1 / s0;
  const inv1 = 1 / s1;
  const scaleAt = (t: number) => 1 / (inv0 + (inv1 - inv0) * t); // perspective-correct interp

  // Strip destination edges: width proportional to each strip's scale, so the far side compresses.
  const edges = new Array(PERSP_STRIPS + 1);
  edges[0] = 0;
  let acc = 0;
  const weights = new Array(PERSP_STRIPS);
  for (let i = 0; i < PERSP_STRIPS; i++) {
    weights[i] = scaleAt((i + 0.5) / PERSP_STRIPS);
    acc += weights[i];
  }
  for (let i = 0; i < PERSP_STRIPS; i++) {
    edges[i + 1] = edges[i] + (weights[i] / acc) * w;
  }

  ctx.imageSmoothingEnabled = true;
  for (let i = 0; i < PERSP_STRIPS; i++) {
    const t = (i + 0.5) / PERSP_STRIPS;
    const stripH = h * scaleAt(t);
    const dx = edges[i];
    const dw = edges[i + 1] - edges[i];
    const ssx = sx + (i / PERSP_STRIPS) * sw;
    const ssw = sw / PERSP_STRIPS;
    // +1 dest width closes the seams between neighbouring strips.
    ctx.drawImage(image, ssx, sy, ssw, sh, dx, (h - stripH) / 2, dw + 1, stripH);
  }
  return canvas;
}

export function drawClip(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  transform: Transform,
  canvasW: number,
  canvasH: number,
  shadow?: ShadowSpec | null
) {
  const { w: srcW, h: srcH } = sourceSize(image);
  if (!srcW || !srcH) return;

  // Crop first: everything downstream sees only the kept region and its aspect ratio.
  const keepW = 1 - transform.cropLeft - transform.cropRight;
  const keepH = 1 - transform.cropTop - transform.cropBottom;
  if (keepW <= 0 || keepH <= 0) return;
  const sx = transform.cropLeft * srcW;
  const sy = transform.cropTop * srcH;
  const sw = keepW * srcW;
  const sh = keepH * srcH;

  const boxW = canvasW * transform.scale;
  const boxH = canvasH * transform.scale;
  const { width: drawW, height: drawH } = computeContainSize(sw, sh, boxW, boxH);
  if (drawW < 1 || drawH < 1) return;

  const cx = canvasW / 2 + transform.x * canvasW;
  const cy = canvasH / 2 + transform.y * canvasH;

  ctx.save();
  ctx.globalAlpha = transform.opacity;
  if (shadow) {
    ctx.shadowBlur = shadow.blur;
    ctx.shadowColor = shadow.color;
  }

  // Position the anchor point, then rotate/skew/flip around it.
  ctx.translate(cx, cy);
  ctx.rotate(transform.rotation * DEG);
  if (transform.skewX || transform.skewY) {
    const kx = Math.tan(Math.max(-SKEW_CLAMP, Math.min(SKEW_CLAMP, transform.skewX)) * DEG);
    const ky = Math.tan(Math.max(-SKEW_CLAMP, Math.min(SKEW_CLAMP, transform.skewY)) * DEG);
    ctx.transform(1, ky, kx, 1, 0, 0);
  }
  if (transform.flipH || transform.flipV) {
    ctx.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1);
  }

  const ox = -transform.anchorX * drawW;
  const oy = -transform.anchorY * drawH;
  if (transform.perspective) {
    const warped = warpPerspective(image, sx, sy, sw, sh, drawW, drawH, transform.perspective);
    ctx.drawImage(warped, 0, 0, warped.width, warped.height, ox, oy, drawW, drawH);
  } else {
    ctx.drawImage(image, sx, sy, sw, sh, ox, oy, drawW, drawH);
  }
  ctx.restore();
}

/** Run a clip's effect stack, falling back to the raw media when it has none. */
function imageForClip(clip: Clip, media: ClipMedia): CanvasImageSource {
  return renderEffects(media, clip.effects, clip.id) ?? media;
}

/**
 * Draws whatever is currently decoded in each active clip's video element — it does not seek.
 * Callers own seeking: live playback lets videos run and only drift-corrects, export seeks
 * frame-by-frame before calling this.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  tracks: Track[],
  clips: Clip[],
  transitions: Transition[],
  sources: Map<string, SourceVideo>,
  time: number,
  canvasW: number,
  canvasH: number
) {
  ctx.clearRect(0, 0, canvasW, canvasH);
  for (const track of tracks) {
    if (track.kind === "audio") continue;

    const active = findTransitionAt(transitions, clips, track.id, time);
    if (active) {
      const clipA = clips.find((c) => c.id === active.transition.leftClipId);
      const clipB = clips.find((c) => c.id === active.transition.rightClipId);
      const sourceA = clipA && sources.get(clipA.sourceId);
      const sourceB = clipB && sources.get(clipB.sourceId);
      if (clipA && clipB && sourceA && sourceB) {
        const mediaA = getClipMedia(clipA.id, sourceA);
        const mediaB = getClipMedia(clipB.id, sourceB);
        if (isMediaReady(mediaA) && isMediaReady(mediaB)) {
          // Effects have to be baked before the blend, otherwise the outgoing and incoming
          // clips would share one effect pass and cross-contaminate.
          drawTransitionFrame(active.transition.kind, {
            ctx,
            imageA: imageForClip(clipA, mediaA),
            transformA: resolveTransform(clipA, time - clipA.start),
            imageB: imageForClip(clipB, mediaB),
            transformB: resolveTransform(clipB, time - clipB.start),
            progress: active.progress,
            canvasW,
            canvasH,
          });
          continue;
        }
      }
    }

    const clip = findActiveClip(clips, track.id, time);
    if (!clip) continue;
    const source = sources.get(clip.sourceId);
    if (!source) continue;
    const media = getClipMedia(clip.id, source);
    if (!isMediaReady(media)) continue;
    const transform = resolveTransform(clip, time - clip.start);
    drawClip(ctx, imageForClip(clip, media), transform, canvasW, canvasH, shadowFor(clip.effects));
  }
}
