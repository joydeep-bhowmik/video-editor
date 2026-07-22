import { useEffect, useRef, useState } from "react";
import { MIN_CLIP_DURATION, PX_PER_SEC, TRACK_HEIGHT } from "../lib/constants";
import { clipDuration, planInsert, totalDuration, type InsertPlan } from "../lib/timeline";
import { sliceWaveform } from "../lib/waveform";
import { TransitionBadge } from "./TransitionBadge";
import type { TransitionSlot } from "./TransitionPanel";
import { Waveform } from "./Waveform";
import type { Clip, SourceVideo, Track, Transition } from "../types";

const ADJACENCY_EPSILON = 0.02;
const MIN_PX_PER_SEC = 4;
const MAX_PX_PER_SEC = 800;
const ZOOM_FACTOR = 1.4;

// Ruler labels stay readable at any zoom by widening the interval instead of packing in more
// ticks — pick the smallest step that still leaves room between labels.
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
function chooseTickStep(pxPerSec: number): number {
  const MIN_LABEL_GAP_PX = 64;
  return TICK_STEPS.find((s) => s * pxPerSec >= MIN_LABEL_GAP_PX) ?? TICK_STEPS[TICK_STEPS.length - 1];
}

interface TimelineProps {
  sources: SourceVideo[];
  tracks: Track[];
  clips: Clip[];
  transitions: Transition[];
  playhead: number;
  selectedClipId: string | null;
  activeTransitionSlot: TransitionSlot | null;
  draggingSourceId: string | null;
  onSeek: (t: number) => void;
  onSelectClip: (id: string | null) => void;
  onTrimClip: (id: string, inPoint: number, outPoint: number) => void;
  onReorderClip: (id: string, trackId: string, dropTime: number) => void;
  onAddClip: (sourceId: string, trackId: string, start: number) => void;
  onAddTrack: (refTrackId?: string, position?: "above" | "below") => void;
  onDeleteTrack: (trackId: string) => void;
  onToggleTrackMute: (trackId: string) => void;
  onSelectTransitionSlot: (slot: TransitionSlot) => void;
  onBeginEdit: () => void;
  onEndEdit: () => void;
}

type Drag =
  | { kind: "trim"; clipId: string; edge: "in" | "out"; startX: number; originalIn: number; originalOut: number }
  | {
      kind: "move";
      clipId: string;
      startX: number;
      originalStart: number;
      originalTrackId: string;
      // Live drag state. The move is only committed on release (see onUp) so a reorder that
      // ripples other clips lands as one undo step and clips never overlap mid-drag.
      deltaX: number;
      targetTrackId: string;
      dropTime: number;
      plan: InsertPlan;
    }
  | { kind: "scrub" };

function formatTick(t: number, step: number) {
  const m = Math.floor(t / 60);
  const s = t % 60;
  // Sub-second steps need a decimal, otherwise consecutive labels would read identically.
  if (step < 1) return `${m}:${s.toFixed(1).padStart(4, "0")}`;
  return `${m}:${Math.floor(s).toString().padStart(2, "0")}`;
}

export function Timeline({
  sources,
  tracks,
  clips,
  transitions,
  playhead,
  selectedClipId,
  activeTransitionSlot,
  draggingSourceId,
  onSeek,
  onSelectClip,
  onTrimClip,
  onReorderClip,
  onAddClip,
  onAddTrack,
  onDeleteTrack,
  onToggleTrackMute,
  onSelectTransitionSlot,
  onBeginEdit,
  onEndEdit,
}: TimelineProps) {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const laneRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragRef = useRef<Drag | null>(null);
  const [, forceRender] = useState(0);
  const [dropPreview, setDropPreview] = useState<{ trackId: string; start: number; duration: number } | null>(null);
  const [pxPerSec, setPxPerSec] = useState(PX_PER_SEC);

  const duration = totalDuration(clips);
  const trackWidth = Math.max(duration * pxPerSec, 400);
  const tickStep = chooseTickStep(pxPerSec);
  const tickCount = Math.floor(trackWidth / (tickStep * pxPerSec)) + 1;
  const displayTracks = [...tracks].reverse();
  const moveDrag = dragRef.current?.kind === "move" ? dragRef.current : null;

  const clampZoom = (v: number) => Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, v));
  const zoomIn = () => setPxPerSec((p) => clampZoom(p * ZOOM_FACTOR));
  const zoomOut = () => setPxPerSec((p) => clampZoom(p / ZOOM_FACTOR));
  // Fixed 30% preset rather than a computed fit-to-content, so the result is predictable
  // regardless of how long the timeline currently is.
  const zoomToFit = () => setPxPerSec(clampZoom(PX_PER_SEC * 0.3));

  // The zoom range spans 4..800 px/sec, so a linear slider would cram everything useful into a
  // sliver at one end — map it logarithmically so each slider step is a constant *ratio*.
  const zoomToSlider = (px: number) =>
    (Math.log(px / MIN_PX_PER_SEC) / Math.log(MAX_PX_PER_SEC / MIN_PX_PER_SEC)) * 100;
  const sliderToZoom = (v: number) =>
    MIN_PX_PER_SEC * Math.pow(MAX_PX_PER_SEC / MIN_PX_PER_SEC, v / 100);
  const zoomPercent = Math.round((pxPerSec / PX_PER_SEC) * 100);

  function xToTime(clientX: number) {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, (clientX - rect.left) / pxPerSec);
  }

  function getTransitionSlots(trackId: string) {
    const trackClips = clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
    const slots: { left: Clip; right: Clip; transition: Transition | undefined }[] = [];
    for (let i = 0; i < trackClips.length - 1; i++) {
      const left = trackClips[i];
      const right = trackClips[i + 1];
      const existing = transitions.find(
        (t) => t.trackId === trackId && t.leftClipId === left.id && t.rightClipId === right.id
      );
      const touching = Math.abs(right.start - (left.start + clipDuration(left))) < ADJACENCY_EPSILON;
      if (existing || touching) slots.push({ left, right, transition: existing });
    }
    return slots;
  }

  function trackIdAtY(clientY: number, fallback: string) {
    for (const [trackId, el] of laneRefs.current) {
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return trackId;
    }
    return fallback;
  }

  function startScrub(e: React.PointerEvent) {
    dragRef.current = { kind: "scrub" };
    onSeek(xToTime(e.clientX));
  }

  // Clicking empty timeline space (ruler, or a lane background not on a clip) deselects —
  // otherwise the gizmo/selection border in Preview has no way to go away once set. Dragging
  // the playhead handle itself is a plain scrub and intentionally doesn't touch selection.
  function startScrubAndDeselect(e: React.PointerEvent) {
    onSelectClip(null);
    startScrub(e);
  }

  function handleLanePointerDown(e: React.PointerEvent) {
    if (e.target !== e.currentTarget) return;
    startScrubAndDeselect(e);
  }

  function handleTrimPointerDown(e: React.PointerEvent, clip: Clip, edge: "in" | "out") {
    e.stopPropagation();
    onBeginEdit();
    dragRef.current = {
      kind: "trim",
      clipId: clip.id,
      edge,
      startX: e.clientX,
      originalIn: clip.inPoint,
      originalOut: clip.outPoint,
    };
    forceRender((n) => n + 1);
  }

  function handleClipPointerDown(e: React.PointerEvent, clip: Clip) {
    e.stopPropagation();
    onSelectClip(clip.id);
    dragRef.current = {
      kind: "move",
      clipId: clip.id,
      startX: e.clientX,
      originalStart: clip.start,
      originalTrackId: clip.trackId,
      deltaX: 0,
      targetTrackId: clip.trackId,
      dropTime: clip.start,
      plan: { start: clip.start, rippleFrom: 0, rippleBy: 0 },
    };
  }

  function handleDrop(e: React.DragEvent, trackId: string) {
    e.preventDefault();
    setDropPreview(null);
    const sourceId = e.dataTransfer.getData("text/plain");
    if (!sourceId) return;
    onAddClip(sourceId, trackId, xToTime(e.clientX));
  }

  // Show where the clip would land (and how far it'd sit from its neighbours) before release,
  // so "before this clip / after this clip / into that gap" is visible rather than a surprise.
  function handleDragOver(e: React.DragEvent, trackId: string) {
    e.preventDefault();
    const source = draggingSourceId ? sourceMap.get(draggingSourceId) : undefined;
    if (!source) return;
    const plan = planInsert(clips, trackId, xToTime(e.clientX), source.duration);
    setDropPreview({ trackId, start: plan.start, duration: source.duration });
  }

  // Registered natively (not via onWheel) because React's wheel listener is passive, and
  // preventDefault is required to stop the browser's own ctrl+wheel page zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setPxPerSec((p) => clampZoom(p * (e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;

      if (drag.kind === "scrub") {
        onSeek(xToTime(e.clientX));
        return;
      }

      const clip = clips.find((c) => c.id === drag.clipId);
      if (!clip) return;

      if (drag.kind === "move") {
        const deltaX = e.clientX - drag.startX;
        const targetTrackId = trackIdAtY(e.clientY, clip.trackId);
        const dropTime = Math.max(0, drag.originalStart + deltaX / pxPerSec);
        // Plan against the track as it would be *without* this clip, so it doesn't collide
        // with the hole it's about to vacate.
        const others = clips.filter((c) => c.id !== clip.id);
        drag.deltaX = deltaX;
        drag.targetTrackId = targetTrackId;
        drag.dropTime = dropTime;
        drag.plan = planInsert(others, targetTrackId, dropTime, clipDuration(clip));
        forceRender((n) => n + 1);
        return;
      }

      const source = sourceMap.get(clip.sourceId);
      const deltaSec = (e.clientX - drag.startX) / pxPerSec;
      if (drag.edge === "in") {
        const newIn = Math.min(
          Math.max(drag.originalIn + deltaSec, 0),
          drag.originalOut - MIN_CLIP_DURATION
        );
        onTrimClip(clip.id, newIn, clip.outPoint);
      } else {
        const maxOut = source?.duration ?? drag.originalOut;
        const newOut = Math.max(
          Math.min(drag.originalOut + deltaSec, maxOut),
          drag.originalIn + MIN_CLIP_DURATION
        );
        onTrimClip(clip.id, clip.inPoint, newOut);
      }
    }
    function onUp() {
      const drag = dragRef.current;
      if (drag?.kind === "trim") onEndEdit();
      if (drag?.kind === "move" && drag.deltaX !== 0) {
        onReorderClip(drag.clipId, drag.targetTrackId, drag.dropTime);
      }
      dragRef.current = null;
      forceRender((n) => n + 1);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips]);

  return (
    <div className="timeline-wrap">
      <div className="timeline-zoombar">
        <button
          className="zoom-button"
          onClick={zoomOut}
          data-tip="Zoom out — see more of your timeline"
          aria-label="Zoom out"
        >
          <i className="ri-zoom-out-line" aria-hidden="true" />
        </button>
        <input
          className="zoom-slider"
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={zoomToSlider(pxPerSec)}
          onChange={(e) => setPxPerSec(clampZoom(sliderToZoom(parseFloat(e.target.value))))}
          title="Timeline zoom"
        />
        <button
          className="zoom-button"
          onClick={zoomIn}
          data-tip="Zoom in — work on fine detail"
          aria-label="Zoom in"
        >
          <i className="ri-zoom-in-line" aria-hidden="true" />
        </button>
        <span className="zoom-percent">{zoomPercent}%</span>
        <button
          className="zoom-button zoom-fit"
          onClick={zoomToFit}
          data-tip="Jump to 30% zoom"
          aria-label="Zoom to 30 percent"
        >
          30%
        </button>
      </div>

      <div className="timeline">
        <div className="timeline-headers">
        <div className="timeline-headers-spacer" />
        {displayTracks.map((track) => {
          const hasClips = clips.some((c) => c.trackId === track.id);
          return (
            <div
              key={track.id}
              className={"track-header" + (track.kind === "audio" ? " track-header-audio" : "")}
              style={{ height: TRACK_HEIGHT }}
            >
              <span className="track-name">
                {track.kind === "audio" ? "♪ " : ""}
                {track.name}
              </span>
              <div className="track-header-buttons">
                <button
                  className="track-insert"
                  data-tip={track.muted ? "Turn this track's sound on" : "Silence this whole track"}
                  aria-label={track.muted ? "Unmute track" : "Mute track"}
                  onClick={() => onToggleTrackMute(track.id)}
                >
                  <i className={track.muted ? "ri-volume-mute-line" : "ri-volume-up-line"} aria-hidden="true" />
                </button>
                <button
                  className="track-insert"
                  data-tip="Add a new track above this one"
                  aria-label="Insert track above"
                  onClick={() => onAddTrack(track.id, "above")}
                >
                  <i className="ri-insert-row-top" aria-hidden="true" />
                </button>
                <button
                  className="track-insert"
                  data-tip="Add a new track below this one"
                  aria-label="Insert track below"
                  onClick={() => onAddTrack(track.id, "below")}
                >
                  <i className="ri-insert-row-bottom" aria-hidden="true" />
                </button>
                <button
                  className="track-delete"
                  disabled={hasClips || tracks.length <= 1}
                  data-tip={hasClips ? "Remove this track's clips first" : "Delete this track"}
                  aria-label="Delete track"
                  onClick={() => onDeleteTrack(track.id)}
                >
                  <i className="ri-close-line" aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
        <button
          className="add-track-button"
          onClick={() => onAddTrack()}
          data-tip="Add another track for overlays or music"
        >
          <i className="ri-add-line" aria-hidden="true" /> Track
        </button>
      </div>

        <div className="timeline-scroll" ref={scrollRef}>
          <div className="timeline-content" ref={contentRef} style={{ width: trackWidth }}>
            <div className="timeline-ruler" onPointerDown={startScrubAndDeselect}>
              {Array.from({ length: tickCount }, (_, i) => {
                const t = i * tickStep;
                return (
                  <div key={i} className="tick" style={{ left: t * pxPerSec }}>
                    <span className="tick-label">{formatTick(t, tickStep)}</span>
                  </div>
                );
              })}
            </div>
  
            {displayTracks.map((track) => (
              <div
                key={track.id}
                className="track-lane"
                style={{ width: trackWidth, height: TRACK_HEIGHT }}
                ref={(el) => {
                  if (el) laneRefs.current.set(track.id, el);
                  else laneRefs.current.delete(track.id);
                }}
                onPointerDown={handleLanePointerDown}
                onDragOver={(e) => handleDragOver(e, track.id)}
                onDragLeave={() => setDropPreview(null)}
                onDrop={(e) => handleDrop(e, track.id)}
              >
                {dropPreview?.trackId === track.id && (
                  <div
                    className="drop-preview"
                    style={{
                      left: dropPreview.start * pxPerSec,
                      width: dropPreview.duration * pxPerSec,
                    }}
                  />
                )}
                {moveDrag?.targetTrackId === track.id &&
                  moveDrag.deltaX !== 0 &&
                  (() => {
                    const dragged = clips.find((c) => c.id === moveDrag.clipId);
                    if (!dragged) return null;
                    return (
                      <div
                        className="drop-preview"
                        style={{
                          left: moveDrag.plan.start * pxPerSec,
                          width: clipDuration(dragged) * pxPerSec,
                        }}
                      />
                    );
                  })()}
                {clips
                  .filter((c) => c.trackId === track.id)
                  .map((clip) => {
                    const source = sourceMap.get(clip.sourceId);
                    return (
                      <div
                        key={clip.id}
                        className={
                          "clip" +
                          (clip.id === selectedClipId ? " selected" : "") +
                          (moveDrag?.clipId === clip.id && moveDrag.deltaX !== 0 ? " clip-dragging" : "")
                        }
                        style={{
                          left: clip.start * pxPerSec,
                          width: clipDuration(clip) * pxPerSec,
                          transform:
                            moveDrag?.clipId === clip.id ? `translateX(${moveDrag.deltaX}px)` : undefined,
                        }}
                        onPointerDown={(e) => handleClipPointerDown(e, clip)}
                      >
                        {source && track.kind !== "audio" && source.filmstrip.length > 0 && (
                          <div className="clip-filmstrip">
                            {source.filmstrip.map((tile, i) => (
                              <img key={i} src={tile} draggable={false} alt="" />
                            ))}
                          </div>
                        )}
                        {source && !clip.audioMuted && !track.muted && (
                          <Waveform
                            className={track.kind === "audio" ? "clip-waveform-full" : "clip-waveform-strip"}
                            peaks={sliceWaveform(source.waveform, source.duration, clip.inPoint, clip.outPoint)}
                          />
                        )}
                        <div
                          className="trim-handle trim-handle-left"
                          onPointerDown={(e) => handleTrimPointerDown(e, clip, "in")}
                        />
                        <span className="clip-label">
                          {clip.audioMuted && "🔇 "}
                          {source?.name ?? "clip"}
                        </span>
                        <div
                          className="trim-handle trim-handle-right"
                          onPointerDown={(e) => handleTrimPointerDown(e, clip, "out")}
                        />
                      </div>
                    );
                  })}
                {getTransitionSlots(track.id).map((slot) => {
                  const editing =
                    activeTransitionSlot?.leftClipId === slot.left.id &&
                    activeTransitionSlot?.rightClipId === slot.right.id;
                  return (
                    <div
                      key={`${slot.left.id}-${slot.right.id}`}
                      className="transition-slot"
                      style={{ left: slot.right.start * pxPerSec }}
                    >
                      <TransitionBadge
                        hasTransition={!!slot.transition}
                        editing={editing}
                        onClick={() =>
                          onSelectTransitionSlot({ trackId: track.id, leftClipId: slot.left.id, rightClipId: slot.right.id })
                        }
                      />
                    </div>
                  );
                })}
              </div>
            ))}

            <div className="playhead" style={{ left: playhead * pxPerSec }}>
              <div className="playhead-handle" onPointerDown={startScrub} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
