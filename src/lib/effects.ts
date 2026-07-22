import type { Effect, EffectKind } from "../types";

export interface EffectDef {
  kind: EffectKind;
  label: string;
  icon: string;
  hint: string;
  /** Label for the intensity slider, so it reads meaningfully per effect. */
  amountLabel: string;
  defaultIntensity: number;
}

export const EFFECT_CATALOG: EffectDef[] = [
  { kind: "blur", label: "Blur", icon: "ri-blur-off-line", hint: "Soften the whole picture", amountLabel: "Amount", defaultIntensity: 0.3 },
  { kind: "green-screen", label: "Green Screen", icon: "ri-contrast-drop-line", hint: "Cut out a green background", amountLabel: "Tolerance", defaultIntensity: 0.4 },
  { kind: "glow", label: "Glow", icon: "ri-sun-line", hint: "Dreamy bloom around bright areas", amountLabel: "Strength", defaultIntensity: 0.45 },
  { kind: "shadow", label: "Shadow", icon: "ri-shadow-line", hint: "Drop shadow behind the clip", amountLabel: "Size", defaultIntensity: 0.4 },
  { kind: "black-white", label: "Black & White", icon: "ri-contrast-2-line", hint: "Drain the colour out", amountLabel: "Strength", defaultIntensity: 1 },
  { kind: "vignette", label: "Vignette", icon: "ri-circle-line", hint: "Darken the edges of the frame", amountLabel: "Strength", defaultIntensity: 0.5 },
  { kind: "pixelate", label: "Pixelate", icon: "ri-grid-line", hint: "Chunky retro pixel blocks", amountLabel: "Block size", defaultIntensity: 0.35 },
  { kind: "sharpen", label: "Sharpen", icon: "ri-focus-3-line", hint: "Crisp up the detail", amountLabel: "Amount", defaultIntensity: 0.4 },
  { kind: "film-grain", label: "Film Grain", icon: "ri-film-line", hint: "Analogue film noise", amountLabel: "Amount", defaultIntensity: 0.35 },
  { kind: "rgb-split", label: "RGB Split", icon: "ri-drag-move-line", hint: "Glitchy colour-channel offset", amountLabel: "Offset", defaultIntensity: 0.3 },
];

export const EFFECT_BY_KIND = new Map(EFFECT_CATALOG.map((e) => [e.kind, e]));

export function makeEffect(kind: EffectKind): Effect {
  return { id: crypto.randomUUID(), kind, intensity: EFFECT_BY_KIND.get(kind)?.defaultIntensity ?? 0.5 };
}

// --- rendering ---------------------------------------------------------------

/** Cap the working canvas so pixel-level passes stay affordable on big sources. */
const MAX_WORK_WIDTH = 1280;

interface Scratch {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function makeScratch(): Scratch {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2d context unavailable");
  return { canvas, ctx };
}

// Reused across frames — allocating canvases per frame would thrash the GC.
//
// The *output* canvas is keyed per clip: a transition renders two clips in one frame, and a
// single shared output would leave the second overwriting the first. The intermediate scratches
// are safe to share because each is consumed before the call that used it returns.
const outputs = new Map<string, Scratch>();
let secondary: Scratch | null = null;
let grainTile: HTMLCanvasElement | null = null;

function getOutput(key: string) {
  let s = outputs.get(key);
  if (!s) {
    s = makeScratch();
    outputs.set(key, s);
  }
  return s;
}
function getSecondary() {
  return (secondary ??= makeScratch());
}

/** Drop cached effect canvases for clips that no longer exist. */
export function pruneEffectCanvases(liveClipIds: Set<string>) {
  for (const key of outputs.keys()) {
    if (!liveClipIds.has(key)) outputs.delete(key);
  }
}

function sizeTo(s: Scratch, w: number, h: number) {
  if (s.canvas.width !== w || s.canvas.height !== h) {
    s.canvas.width = w;
    s.canvas.height = h;
  }
  s.ctx.setTransform(1, 0, 0, 1, 0, 0);
  s.ctx.filter = "none";
  s.ctx.globalAlpha = 1;
  s.ctx.globalCompositeOperation = "source-over";
  s.ctx.clearRect(0, 0, w, h);
}

/** A tiled noise bitmap, generated once and reused for the grain overlay. */
function getGrainTile(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const size = 128;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

/** Chroma-key: knock out pixels close to pure green. */
function applyGreenScreen(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // Wider tolerance as intensity rises.
  const tolerance = 40 + intensity * 140;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    // Green is "dominant" when it clearly outweighs both other channels.
    if (g - Math.max(r, b) > 255 - tolerance) {
      d[i + 3] = 0;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Unsharp mask: original + (original − blurred) * amount. */
function applySharpen(src: Scratch, w: number, h: number, intensity: number) {
  const tmp = getSecondary();
  sizeTo(tmp, w, h);
  // Blurred copy.
  tmp.ctx.filter = `blur(${(1 + intensity * 2).toFixed(2)}px)`;
  tmp.ctx.drawImage(src.canvas, 0, 0);
  tmp.ctx.filter = "none";

  // Subtract the blur to isolate edges, then add them back on top of the original.
  tmp.ctx.globalCompositeOperation = "difference";
  tmp.ctx.drawImage(src.canvas, 0, 0);
  tmp.ctx.globalCompositeOperation = "source-over";

  src.ctx.globalAlpha = Math.min(1, intensity * 1.6);
  src.ctx.globalCompositeOperation = "lighter";
  src.ctx.drawImage(tmp.canvas, 0, 0);
  src.ctx.globalAlpha = 1;
  src.ctx.globalCompositeOperation = "source-over";
}

/** Bloom: screen a blurred, brightened copy back over the original. */
function applyGlow(src: Scratch, w: number, h: number, intensity: number) {
  const tmp = getSecondary();
  sizeTo(tmp, w, h);
  tmp.ctx.filter = `blur(${(4 + intensity * 18).toFixed(2)}px) brightness(1.5)`;
  tmp.ctx.drawImage(src.canvas, 0, 0);
  tmp.ctx.filter = "none";

  src.ctx.globalCompositeOperation = "lighter";
  src.ctx.globalAlpha = Math.min(1, 0.25 + intensity * 0.6);
  src.ctx.drawImage(tmp.canvas, 0, 0);
  src.ctx.globalAlpha = 1;
  src.ctx.globalCompositeOperation = "source-over";
}

/** Chromatic aberration: re-composite the R and B channels at opposing offsets. */
function applyRgbSplit(src: Scratch, w: number, h: number, intensity: number) {
  const tmp = getSecondary();
  sizeTo(tmp, w, h);
  tmp.ctx.drawImage(src.canvas, 0, 0);

  const offset = Math.max(1, Math.round(intensity * 0.02 * w));
  sizeTo(src, w, h);

  // Isolate a channel by multiplying with a pure primary, then add the three back together.
  const pass = (color: string, dx: number) => {
    const ch = getPrimaryChannel(tmp.canvas, w, h, color);
    src.ctx.globalCompositeOperation = "lighter";
    src.ctx.drawImage(ch, dx, 0);
  };
  src.ctx.globalCompositeOperation = "source-over";
  pass("#f00", -offset);
  pass("#0f0", 0);
  pass("#00f", offset);
  src.ctx.globalCompositeOperation = "source-over";
}

// Third scratch used only by the RGB split channel extraction.
let channelScratch: Scratch | null = null;
function getPrimaryChannel(source: CanvasImageSource, w: number, h: number, color: string) {
  channelScratch ??= makeScratch();
  sizeTo(channelScratch, w, h);
  const c = channelScratch.ctx;
  c.drawImage(source, 0, 0);
  c.globalCompositeOperation = "multiply";
  c.fillStyle = color;
  c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = "source-over";
  return channelScratch.canvas;
}

function applyVignette(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${Math.min(1, intensity).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function applyGrain(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  const tile = getGrainTile();
  ctx.save();
  ctx.globalAlpha = Math.min(0.6, intensity * 0.6);
  ctx.globalCompositeOperation = "overlay";
  // Jitter the tile origin each frame so the grain animates instead of sitting static.
  const ox = -Math.floor(Math.random() * tile.width);
  const oy = -Math.floor(Math.random() * tile.height);
  const pattern = ctx.createPattern(tile, "repeat");
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.translate(ox, oy);
    ctx.fillRect(-ox, -oy, w, h);
  }
  ctx.restore();
}

/**
 * Run a clip's effect stack and return a canvas to draw in place of the raw video.
 * Returns null when there's nothing to do, so the compositor can draw the video directly.
 */
export function renderEffects(
  video: HTMLVideoElement,
  effects: Effect[],
  cacheKey: string
): HTMLCanvasElement | null {
  if (effects.length === 0) return null;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const scale = Math.min(1, MAX_WORK_WIDTH / vw);
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));

  const src = getOutput(cacheKey);
  sizeTo(src, w, h);

  const has = (k: EffectKind) => effects.find((e) => e.kind === k);
  const blur = has("blur");
  const bw = has("black-white");
  const pixelate = has("pixelate");

  // CSS-filter-style passes compose into one string, so they cost a single draw.
  const filters: string[] = [];
  if (blur) filters.push(`blur(${(blur.intensity * 14).toFixed(2)}px)`);
  if (bw) filters.push(`grayscale(${Math.min(1, bw.intensity).toFixed(3)})`);
  src.ctx.filter = filters.length ? filters.join(" ") : "none";

  if (pixelate) {
    // Downscale then draw back up with smoothing off to get hard blocks.
    // Higher intensity => fewer, larger blocks.
    const blocks = Math.max(4, Math.round((1 - pixelate.intensity) * 150) + 6);
    const pw = blocks;
    const ph = Math.max(1, Math.round((blocks * h) / w));
    const tmp = getSecondary();
    sizeTo(tmp, pw, ph);
    tmp.ctx.drawImage(video, 0, 0, pw, ph);
    src.ctx.imageSmoothingEnabled = false;
    src.ctx.drawImage(tmp.canvas, 0, 0, w, h);
    src.ctx.imageSmoothingEnabled = true;
  } else {
    src.ctx.drawImage(video, 0, 0, w, h);
  }
  src.ctx.filter = "none";

  // Order matters: key out the background before anything paints over it.
  const green = has("green-screen");
  if (green) applyGreenScreen(src.ctx, w, h, green.intensity);

  const sharpen = has("sharpen");
  if (sharpen) applySharpen(src, w, h, sharpen.intensity);

  const rgb = has("rgb-split");
  if (rgb) applyRgbSplit(src, w, h, rgb.intensity);

  const glow = has("glow");
  if (glow) applyGlow(src, w, h, glow.intensity);

  const vignette = has("vignette");
  if (vignette) applyVignette(src.ctx, w, h, vignette.intensity);

  const grain = has("film-grain");
  if (grain) applyGrain(src.ctx, w, h, grain.intensity);

  return src.canvas;
}

/** Shadow is drawn by the compositor itself, since it paints *outside* the frame. */
export function shadowFor(effects: Effect[]): { blur: number; color: string } | null {
  const shadow = effects.find((e) => e.kind === "shadow");
  if (!shadow) return null;
  return { blur: 6 + shadow.intensity * 46, color: `rgba(0,0,0,${(0.35 + shadow.intensity * 0.5).toFixed(3)})` };
}
