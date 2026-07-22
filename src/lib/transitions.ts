import { drawClip } from "./compositor";
import { clipDuration } from "./timeline";
import type { Clip, Transform, Transition, TransitionKind } from "../types";

export const TRANSITION_CATALOG: { category: string; items: { kind: TransitionKind; label: string }[] }[] = [
  {
    category: "Fade",
    items: [
      { kind: "fade-cross", label: "Cross Dissolve" },
      { kind: "fade-black", label: "Fade to Black" },
      { kind: "fade-white", label: "Fade to White" },
    ],
  },
  {
    category: "Slide",
    items: [
      { kind: "slide-left", label: "Left" },
      { kind: "slide-right", label: "Right" },
      { kind: "slide-up", label: "Up" },
      { kind: "slide-down", label: "Down" },
    ],
  },
  {
    category: "Push",
    items: [
      { kind: "push-left", label: "Left" },
      { kind: "push-right", label: "Right" },
      { kind: "push-up", label: "Up" },
      { kind: "push-down", label: "Down" },
    ],
  },
  {
    category: "Wipe",
    items: [
      { kind: "wipe-left", label: "Left" },
      { kind: "wipe-right", label: "Right" },
      { kind: "wipe-clock", label: "Clock" },
      { kind: "wipe-circle", label: "Circle" },
    ],
  },
  {
    category: "Zoom",
    items: [
      { kind: "zoom-in", label: "Zoom In" },
      { kind: "zoom-out", label: "Zoom Out" },
    ],
  },
  {
    category: "Blur",
    items: [
      { kind: "blur", label: "Blur" },
      { kind: "blur-motion", label: "Motion Blur" },
    ],
  },
  {
    category: "Iris",
    items: [
      { kind: "iris-circle", label: "Circle" },
      { kind: "iris-square", label: "Square" },
    ],
  },
];

export const DEFAULT_TRANSITION_DURATION = 0.5;

// --- timing / window math -------------------------------------------------

function computeOverlapStart(clips: Clip[], leftClipId: string, duration: number): number {
  const leftClip = clips.find((c) => c.id === leftClipId);
  if (!leftClip) return 0;
  return Math.max(0, leftClip.start + clipDuration(leftClip) - duration);
}

export function applyTransition(
  clips: Clip[],
  trackId: string,
  leftClipId: string,
  rightClipId: string,
  kind: TransitionKind,
  duration: number
): { clips: Clip[]; transition: Transition } {
  const newStart = computeOverlapStart(clips, leftClipId, duration);
  const updatedClips = clips.map((c) => (c.id === rightClipId ? { ...c, start: newStart } : c));
  return {
    clips: updatedClips,
    transition: { id: crypto.randomUUID(), trackId, leftClipId, rightClipId, kind, duration },
  };
}

export function retimeTransition(clips: Clip[], transition: Transition, duration: number): Clip[] {
  const newStart = computeOverlapStart(clips, transition.leftClipId, duration);
  return clips.map((c) => (c.id === transition.rightClipId ? { ...c, start: newStart } : c));
}

export function findTransitionAt(
  transitions: Transition[],
  clips: Clip[],
  trackId: string,
  time: number
): { transition: Transition; progress: number } | undefined {
  for (const t of transitions) {
    if (t.trackId !== trackId) continue;
    const rightClip = clips.find((c) => c.id === t.rightClipId);
    if (!rightClip) continue;
    const windowStart = rightClip.start;
    const windowEnd = rightClip.start + t.duration;
    if (time >= windowStart && time < windowEnd) {
      return { transition: t, progress: t.duration > 0 ? (time - windowStart) / t.duration : 1 };
    }
  }
  return undefined;
}

export function transitionMidpoint(clips: Clip[], transition: Transition): number {
  const rightClip = clips.find((c) => c.id === transition.rightClipId);
  if (!rightClip) return 0;
  return rightClip.start + transition.duration / 2;
}

// --- rendering --------------------------------------------------------------

interface RenderArgs {
  ctx: CanvasRenderingContext2D;
  imageA: CanvasImageSource;
  transformA: Transform;
  imageB: CanvasImageSource;
  transformB: Transform;
  progress: number;
  canvasW: number;
  canvasH: number;
}

function withOpacity(t: Transform, factor: number): Transform {
  return { ...t, opacity: t.opacity * factor };
}

function drawFade({ ctx, imageA, transformA, imageB, transformB, progress, canvasW, canvasH }: RenderArgs) {
  drawClip(ctx, imageA, transformA, canvasW, canvasH);
  drawClip(ctx, imageB, withOpacity(transformB, progress), canvasW, canvasH);
}

function drawFadeThroughSolid(args: RenderArgs, color: string) {
  const { ctx, imageA, transformA, imageB, transformB, progress, canvasW, canvasH } = args;
  if (progress < 0.5) {
    const t = progress / 0.5;
    drawClip(ctx, imageA, withOpacity(transformA, 1 - t), canvasW, canvasH);
  } else {
    const t = (progress - 0.5) / 0.5;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvasW, canvasH);
    drawClip(ctx, imageB, withOpacity(transformB, t), canvasW, canvasH);
  }
}

type Direction = "left" | "right" | "up" | "down";

function directionOffset(dir: Direction, canvasW: number, canvasH: number, amount: number) {
  switch (dir) {
    case "left":
      return { x: -amount * canvasW, y: 0 };
    case "right":
      return { x: amount * canvasW, y: 0 };
    case "up":
      return { x: 0, y: -amount * canvasH };
    case "down":
      return { x: 0, y: amount * canvasH };
  }
}

function withOffset(t: Transform, canvasW: number, canvasH: number, dx: number, dy: number): Transform {
  return { ...t, x: t.x + dx / canvasW, y: t.y + dy / canvasH };
}

function drawSlide(args: RenderArgs, dir: Direction) {
  const { ctx, imageA, transformA, imageB, transformB, progress, canvasW, canvasH } = args;
  // B slides in over a static A.
  drawClip(ctx, imageA, transformA, canvasW, canvasH);
  const enter = directionOffset(dir, canvasW, canvasH, 1 - progress);
  // Slides *in*, so it enters from the opposite side of its exit direction.
  const from = { x: -enter.x, y: -enter.y };
  drawClip(ctx, imageB, withOffset(transformB, canvasW, canvasH, from.x, from.y), canvasW, canvasH);
}

function drawPush(args: RenderArgs, dir: Direction) {
  const { ctx, imageA, transformA, imageB, transformB, progress, canvasW, canvasH } = args;
  // Both clips translate together, like a physical panel push.
  const exit = directionOffset(dir, canvasW, canvasH, progress);
  const enterFrom = directionOffset(dir, canvasW, canvasH, 1 - progress);
  drawClip(ctx, imageA, withOffset(transformA, canvasW, canvasH, exit.x, exit.y), canvasW, canvasH);
  drawClip(ctx, imageB, withOffset(transformB, canvasW, canvasH, -enterFrom.x, -enterFrom.y), canvasW, canvasH);
}

function drawWipeRect(args: RenderArgs, dir: "left" | "right") {
  const { ctx, imageA, transformA, imageB, transformB, progress, canvasW, canvasH } = args;
  drawClip(ctx, imageA, transformA, canvasW, canvasH);
  ctx.save();
  ctx.beginPath();
  if (dir === "left") {
    ctx.rect(0, 0, canvasW * progress, canvasH);
  } else {
    ctx.rect(canvasW * (1 - progress), 0, canvasW * progress, canvasH);
  }
  ctx.clip();
  drawClip(ctx, imageB, transformB, canvasW, canvasH);
  ctx.restore();
}

function drawWipeClock(args: RenderArgs) {
  const { ctx, imageA, transformA, imageB, transformB, progress, canvasW, canvasH } = args;
  drawClip(ctx, imageA, transformA, canvasW, canvasH);
  const cx = canvasW / 2;
  const cy = canvasH / 2;
  const radius = Math.hypot(canvasW, canvasH);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  drawClip(ctx, imageB, transformB, canvasW, canvasH);
  ctx.restore();
}

function drawWipeCircle(args: RenderArgs) {
  const { ctx, imageA, transformA, imageB, transformB, progress, canvasW, canvasH } = args;
  drawClip(ctx, imageA, transformA, canvasW, canvasH);
  const cx = canvasW / 2;
  const cy = canvasH / 2;
  const maxRadius = Math.hypot(canvasW, canvasH) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, maxRadius * progress, 0, Math.PI * 2);
  ctx.clip();
  drawClip(ctx, imageB, transformB, canvasW, canvasH);
  ctx.restore();
}

function drawZoomIn(args: RenderArgs) {
  const { ctx, imageA, transformA, imageB, transformB, progress, canvasW, canvasH } = args;
  drawClip(ctx, imageA, transformA, canvasW, canvasH);
  const scale = 0.05 + 0.95 * progress;
  drawClip(
    ctx,
    imageB,
    { ...transformB, scale: transformB.scale * scale, opacity: transformB.opacity * progress },
    canvasW,
    canvasH
  );
}

function drawZoomOut(args: RenderArgs) {
  const { ctx, imageA, transformA, imageB, transformB, progress, canvasW, canvasH } = args;
  drawClip(ctx, imageB, transformB, canvasW, canvasH);
  const scale = 1 + 0.8 * progress;
  drawClip(
    ctx,
    imageA,
    { ...transformA, scale: transformA.scale * scale, opacity: transformA.opacity * (1 - progress) },
    canvasW,
    canvasH
  );
}

const BLUR_PEAK_PX = 18;

function drawBlur(args: RenderArgs) {
  const { ctx, imageA, transformA, imageB, transformB, progress, canvasW, canvasH } = args;
  const blurPx = Math.sin(progress * Math.PI) * BLUR_PEAK_PX;
  ctx.save();
  ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
  drawClip(ctx, imageA, withOpacity(transformA, 1 - progress), canvasW, canvasH);
  drawClip(ctx, imageB, withOpacity(transformB, progress), canvasW, canvasH);
  ctx.restore();
}

function drawMotionBlur(args: RenderArgs) {
  const { ctx, imageA, transformA, imageB, transformB, progress, canvasW, canvasH } = args;
  const blurPx = Math.sin(progress * Math.PI) * BLUR_PEAK_PX;
  const ghostSteps = 3;
  const spread = 0.04 * canvasW;

  ctx.save();
  ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
  for (let i = 0; i < ghostSteps; i++) {
    const k = (i + 1) / ghostSteps;
    const dx = -spread * k * progress;
    drawClip(
      ctx,
      imageA,
      withOffset(withOpacity(transformA, (1 - progress) * (1 - k * 0.6)), canvasW, canvasH, dx, 0),
      canvasW,
      canvasH
    );
  }
  for (let i = 0; i < ghostSteps; i++) {
    const k = (i + 1) / ghostSteps;
    const dx = spread * k * (1 - progress);
    drawClip(
      ctx,
      imageB,
      withOffset(withOpacity(transformB, progress * (1 - k * 0.6)), canvasW, canvasH, dx, 0),
      canvasW,
      canvasH
    );
  }
  ctx.restore();
}

function drawIris(args: RenderArgs, shape: "circle" | "square") {
  const { ctx, imageA, transformA, imageB, transformB, progress, canvasW, canvasH } = args;
  const cx = canvasW / 2;
  const cy = canvasH / 2;
  const maxRadius = Math.hypot(canvasW, canvasH) / 2;

  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvasW, canvasH);

  const closing = progress < 0.5;
  const t = closing ? progress / 0.5 : (progress - 0.5) / 0.5;
  const radius = maxRadius * (closing ? 1 - t : t);

  ctx.save();
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  } else {
    ctx.rect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
  ctx.clip();
  drawClip(ctx, closing ? imageA : imageB, closing ? transformA : transformB, canvasW, canvasH);
  ctx.restore();
}

export function drawTransitionFrame(kind: TransitionKind, args: RenderArgs) {
  switch (kind) {
    case "fade-cross":
      return drawFade(args);
    case "fade-black":
      return drawFadeThroughSolid(args, "black");
    case "fade-white":
      return drawFadeThroughSolid(args, "white");
    case "slide-left":
      return drawSlide(args, "left");
    case "slide-right":
      return drawSlide(args, "right");
    case "slide-up":
      return drawSlide(args, "up");
    case "slide-down":
      return drawSlide(args, "down");
    case "push-left":
      return drawPush(args, "left");
    case "push-right":
      return drawPush(args, "right");
    case "push-up":
      return drawPush(args, "up");
    case "push-down":
      return drawPush(args, "down");
    case "wipe-left":
      return drawWipeRect(args, "left");
    case "wipe-right":
      return drawWipeRect(args, "right");
    case "wipe-clock":
      return drawWipeClock(args);
    case "wipe-circle":
      return drawWipeCircle(args);
    case "zoom-in":
      return drawZoomIn(args);
    case "zoom-out":
      return drawZoomOut(args);
    case "blur":
      return drawBlur(args);
    case "blur-motion":
      return drawMotionBlur(args);
    case "iris-circle":
      return drawIris(args, "circle");
    case "iris-square":
      return drawIris(args, "square");
  }
}
