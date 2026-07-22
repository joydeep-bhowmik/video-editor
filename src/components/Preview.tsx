import { useEffect, useMemo, useRef } from "react";
import { drawFrame } from "../lib/compositor";
import { findActiveClip, isClipActiveAt, totalDuration } from "../lib/timeline";
import { findTransitionAt } from "../lib/transitions";
import { getClipVideo, peekClipVideo, pruneClipVideos } from "../lib/videoPool";
import { TransformGizmo } from "./TransformGizmo";
import type { Clip, SourceVideo, Track, Transform, Transition } from "../types";

interface PreviewProps {
  sources: SourceVideo[];
  tracks: Track[];
  clips: Clip[];
  transitions: Transition[];
  playhead: number;
  isPlaying: boolean;
  projectWidth: number;
  projectHeight: number;
  selectedClipId: string | null;
  onPlayheadChange: (t: number) => void;
  onEnded: () => void;
  onTransformClip: (clipId: string, transform: Transform) => void;
  onSelectClip: (id: string | null) => void;
  onBeginEdit: () => void;
  onEndEdit: () => void;
}

export function Preview({
  sources,
  tracks,
  clips,
  transitions,
  playhead,
  isPlaying,
  projectWidth,
  projectHeight,
  selectedClipId,
  onPlayheadChange,
  onEnded,
  onTransformClip,
  onSelectClip,
  onBeginEdit,
  onEndEdit,
}: PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceMap = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);

  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const transitionsRef = useRef(transitions);
  transitionsRef.current = transitions;
  const sourceMapRef = useRef(sourceMap);
  sourceMapRef.current = sourceMap;

  const rafRef = useRef<number | null>(null);
  const localTimeRef = useRef(playhead);

  function draw(time: number) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    drawFrame(
      ctx,
      tracksRef.current,
      clipsRef.current,
      transitionsRef.current,
      sourceMapRef.current,
      time,
      projectWidth,
      projectHeight
    );
  }

  // release decoders for clips that were deleted
  useEffect(() => {
    pruneClipVideos(new Set(clips.map((c) => c.id)));
  }, [clips]);

  // paused / scrubbing: seek each active clip's video to the right frame, redraw
  useEffect(() => {
    if (isPlaying) return;
    for (const track of tracks) {
      const active = findTransitionAt(transitions, clips, track.id, playhead);
      const activeClips = active
        ? [
            clips.find((c) => c.id === active.transition.leftClipId),
            clips.find((c) => c.id === active.transition.rightClipId),
          ].filter((c): c is Clip => !!c)
        : [findActiveClip(clips, track.id, playhead)].filter((c): c is Clip => !!c);

      for (const clip of activeClips) {
        const source = sourceMap.get(clip.sourceId);
        if (!source) continue;
        const video = getClipVideo(clip.id, source.url);
        video.pause();
        const sourceTime = clip.inPoint + (playhead - clip.start);
        if (Math.abs(video.currentTime - sourceTime) > 0.03) {
          const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);
            draw(playhead);
          };
          video.addEventListener("seeked", onSeeked);
          video.currentTime = sourceTime;
        }
      }
    }
    draw(playhead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, isPlaying, tracks, clips, transitions, sourceMap, projectWidth, projectHeight]);

  // playback loop
  useEffect(() => {
    if (!isPlaying) {
      for (const clip of clipsRef.current) {
        peekClipVideo(clip.id)?.pause();
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    localTimeRef.current = playhead;
    let activeIds = new Set<string>();
    // Wall-clock fallback, only used while no base-track clip is active to drive the real clock.
    let fallbackAnchorWall: number | null = null;
    let fallbackAnchorTime = playhead;

    const tick = (now: number) => {
      const tracksNow = tracksRef.current;
      const clipsNow = clipsRef.current;
      const transitionsNow = transitionsRef.current;
      const sourcesNow = sourceMapRef.current;
      const dur = totalDuration(clipsNow);

      const baseTrack = tracksNow[0];
      // During a transition on the base track we don't try to pick one clip as "the" master
      // clock — both are audible/visible and neither should own the clock — so fall through
      // to the wall-clock branch below for the (typically short) duration of the blend.
      const baseTransitionActive = baseTrack && findTransitionAt(transitionsNow, clipsNow, baseTrack.id, localTimeRef.current);
      const baseClip =
        baseTrack && !baseTransitionActive ? findActiveClip(clipsNow, baseTrack.id, localTimeRef.current) : undefined;
      const baseSource = baseClip ? sourcesNow.get(baseClip.sourceId) : undefined;
      const baseVideo = baseSource ? getClipVideo(baseClip!.id, baseSource.url) : null;

      let time: number;
      if (baseClip && baseVideo && !baseVideo.paused && !baseVideo.seeking) {
        // Master clock: the base track's own video, so its audio is never fought with reseeks.
        // The video itself doesn't know about our trim out-point, so it'll happily keep playing
        // past it — clamp the derived clock (and stop the video) once it reaches the trim end.
        if (baseVideo.currentTime >= baseClip.outPoint - 0.02) {
          baseVideo.pause();
          time = baseClip.start + (baseClip.outPoint - baseClip.inPoint);
        } else {
          time = baseClip.start + (baseVideo.currentTime - baseClip.inPoint);
        }
        fallbackAnchorWall = null;
      } else if (baseClip) {
        // Base clip just became active and hasn't started producing frames yet — hold steady.
        time = localTimeRef.current;
      } else {
        // No base-track clip covers this moment (empty base track / gap) — fall back to wall clock.
        if (fallbackAnchorWall === null) {
          fallbackAnchorWall = now;
          fallbackAnchorTime = localTimeRef.current;
        }
        time = fallbackAnchorTime + (now - fallbackAnchorWall) / 1000;
      }

      if (time >= dur) {
        localTimeRef.current = dur;
        onPlayheadChange(dur);
        for (const id of activeIds) peekClipVideo(id)?.pause();
        onEnded();
        return;
      }
      localTimeRef.current = time;
      onPlayheadChange(time);

      const baseTrackId = baseTrack?.id;
      const stillActive = new Set<string>();
      for (const track of tracksNow) {
        const active = findTransitionAt(transitionsNow, clipsNow, track.id, time);
        const trackClips = active
          ? [
              clipsNow.find((c) => c.id === active.transition.leftClipId),
              clipsNow.find((c) => c.id === active.transition.rightClipId),
            ].filter((c): c is Clip => !!c)
          : [findActiveClip(clipsNow, track.id, time)].filter((c): c is Clip => !!c);

        for (const clip of trackClips) {
          const source = sourcesNow.get(clip.sourceId);
          if (!source) continue;
          const video = getClipVideo(clip.id, source.url);
          stillActive.add(clip.id);
          const isBase = track.id === baseTrackId;
          video.muted = track.muted || clip.audioMuted;
          const sourceTime = clip.inPoint + (time - clip.start);

          if (video.paused) {
            // (Re)starting this clip's video: position it once, then let it run.
            video.currentTime = sourceTime;
            video.play().catch(() => {});
          } else if (!isBase && !video.seeking && Math.abs(video.currentTime - sourceTime) > 1) {
            // Non-master tracks get a coarse correction only past 1s of drift — frequent enough
            // to stay in sync, rare enough not to click/pop audibly on every tick. The base track
            // (our master clock) is never force-seeked while playing — see the branch above.
            video.currentTime = sourceTime;
          }
        }
      }
      for (const id of activeIds) {
        if (!stillActive.has(id)) peekClipVideo(id)?.pause();
      }
      activeIds = stillActive;

      draw(time);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  const selectedClip =
    selectedClipId != null
      ? clips.find((c) => c.id === selectedClipId && isClipActiveAt(c, playhead))
      : undefined;

  return (
    <div className="preview" onPointerDown={() => onSelectClip(null)}>
      <div className="preview-canvas-wrap" style={{ aspectRatio: `${projectWidth} / ${projectHeight}` }}>
        <canvas ref={canvasRef} width={projectWidth} height={projectHeight} />
        {selectedClip && (
          <TransformGizmo
            transform={selectedClip.transform}
            onChange={(t) => onTransformClip(selectedClip.id, t)}
            onDragStart={onBeginEdit}
            onDragEnd={onEndEdit}
          />
        )}
      </div>
      {clips.length === 0 && <div className="preview-empty">Import a video to start</div>}
    </div>
  );
}
