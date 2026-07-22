import { useEffect, useRef, useState } from "react";
import { MIN_CLIP_DURATION, PX_PER_SEC, TRACK_HEIGHT } from "../lib/constants";
import { clampClipStart, clipDuration, totalDuration } from "../lib/timeline";
import { sliceWaveform } from "../lib/waveform";
import { TransitionBadge } from "./TransitionBadge";
import type { TransitionSlot } from "./TransitionPanel";
import { Waveform } from "./Waveform";
import type { Clip, SourceVideo, Track, Transition } from "../types";

const ADJACENCY_EPSILON = 0.02;

interface TimelineProps {
  sources: SourceVideo[];
  tracks: Track[];
  clips: Clip[];
  transitions: Transition[];
  playhead: number;
  selectedClipId: string | null;
  activeTransitionSlot: TransitionSlot | null;
  onSeek: (t: number) => void;
  onSelectClip: (id: string | null) => void;
  onTrimClip: (id: string, inPoint: number, outPoint: number) => void;
  onMoveClip: (id: string, trackId: string, start: number) => void;
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
  | { kind: "move"; clipId: string; startX: number; originalStart: number; originalTrackId: string }
  | { kind: "scrub" };

function formatTick(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

export function Timeline({
  sources,
  tracks,
  clips,
  transitions,
  playhead,
  selectedClipId,
  activeTransitionSlot,
  onSeek,
  onSelectClip,
  onTrimClip,
  onMoveClip,
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
  const laneRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragRef = useRef<Drag | null>(null);
  const [, forceRender] = useState(0);

  const duration = totalDuration(clips);
  const trackWidth = Math.max(duration * PX_PER_SEC, 400);
  const tickCount = Math.floor(trackWidth / PX_PER_SEC) + 1;
  const displayTracks = [...tracks].reverse();

  function xToTime(clientX: number) {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, (clientX - rect.left) / PX_PER_SEC);
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

  function handleLanePointerDown(e: React.PointerEvent) {
    if (e.target !== e.currentTarget) return;
    startScrub(e);
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
    onBeginEdit();
    dragRef.current = {
      kind: "move",
      clipId: clip.id,
      startX: e.clientX,
      originalStart: clip.start,
      originalTrackId: clip.trackId,
    };
  }

  function handleDrop(e: React.DragEvent, trackId: string) {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");
    if (!sourceId) return;
    onAddClip(sourceId, trackId, xToTime(e.clientX));
  }

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
        const deltaSec = (e.clientX - drag.startX) / PX_PER_SEC;
        const targetTrackId = trackIdAtY(e.clientY, clip.trackId);
        const desiredStart = drag.originalStart + deltaSec;
        const clamped = clampClipStart(clips, targetTrackId, clip.id, desiredStart, clipDuration(clip));
        onMoveClip(clip.id, targetTrackId, clamped);
        return;
      }

      const source = sourceMap.get(clip.sourceId);
      const deltaSec = (e.clientX - drag.startX) / PX_PER_SEC;
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
      if (dragRef.current?.kind === "trim" || dragRef.current?.kind === "move") onEndEdit();
      dragRef.current = null;
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
                  title={track.muted ? "Unmute track" : "Mute track"}
                  onClick={() => onToggleTrackMute(track.id)}
                >
                  {track.muted ? "🔇" : "🔊"}
                </button>
                <button
                  className="track-insert"
                  title="Insert track above"
                  onClick={() => onAddTrack(track.id, "above")}
                >
                  ▲+
                </button>
                <button
                  className="track-insert"
                  title="Insert track below"
                  onClick={() => onAddTrack(track.id, "below")}
                >
                  ▼+
                </button>
                <button
                  className="track-delete"
                  disabled={hasClips || tracks.length <= 1}
                  title={hasClips ? "Remove all clips first" : "Delete track"}
                  onClick={() => onDeleteTrack(track.id)}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
        <button className="button add-track-button" onClick={() => onAddTrack()}>
          + Add Track
        </button>
      </div>

      <div className="timeline-scroll">
        <div className="timeline-content" ref={contentRef} style={{ width: trackWidth }}>
          <div className="timeline-ruler" onPointerDown={startScrub}>
            {Array.from({ length: tickCount }, (_, i) => (
              <div key={i} className="tick" style={{ left: i * PX_PER_SEC }}>
                <span className="tick-label">{formatTick(i)}</span>
              </div>
            ))}
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
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(e, track.id)}
            >
              {clips
                .filter((c) => c.trackId === track.id)
                .map((clip) => {
                  const source = sourceMap.get(clip.sourceId);
                  return (
                    <div
                      key={clip.id}
                      className={"clip" + (clip.id === selectedClipId ? " selected" : "")}
                      style={{
                        left: clip.start * PX_PER_SEC,
                        width: clipDuration(clip) * PX_PER_SEC,
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
                    style={{ left: slot.right.start * PX_PER_SEC }}
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

          <div className="playhead" style={{ left: playhead * PX_PER_SEC }}>
            <div className="playhead-handle" onPointerDown={startScrub} />
          </div>
        </div>
      </div>
    </div>
  );
}
