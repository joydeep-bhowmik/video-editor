import { findActiveClip } from "./timeline";
import { findTransitionAt, drawTransitionFrame } from "./transitions";
import { getClipVideo } from "./videoPool";
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

export function drawClip(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  transform: Transform,
  canvasW: number,
  canvasH: number
) {
  const boxW = canvasW * transform.scale;
  const boxH = canvasH * transform.scale;
  const { width: drawW, height: drawH } = computeContainSize(
    video.videoWidth,
    video.videoHeight,
    boxW,
    boxH
  );

  const cx = canvasW / 2 + transform.x * canvasW;
  const cy = canvasH / 2 + transform.y * canvasH;

  ctx.save();
  ctx.globalAlpha = transform.opacity;
  ctx.translate(cx, cy);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.drawImage(video, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
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
        const videoA = getClipVideo(clipA.id, sourceA.url);
        const videoB = getClipVideo(clipB.id, sourceB.url);
        if (videoA.readyState >= 2 && videoB.readyState >= 2) {
          drawTransitionFrame(active.transition.kind, {
            ctx,
            videoA,
            transformA: clipA.transform,
            videoB,
            transformB: clipB.transform,
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
    const video = getClipVideo(clip.id, source.url);
    if (video.readyState < 2) continue;
    drawClip(ctx, video, clip.transform, canvasW, canvasH);
  }
}
