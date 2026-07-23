import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import "./App.css";
import { ExportCancelledError, runExport, type ExportProgress, type ExportSettings } from "./export";
import {
  DEFAULT_PROJECT_HEIGHT,
  DEFAULT_PROJECT_WIDTH,
  DEFAULT_TRANSFORM_BASE,
  DEFAULT_TRANSFORM_OVERLAY,
  IMAGE_DEFAULT_DURATION,
  MIN_CLIP_DURATION,
} from "./lib/constants";
import { historyReducer, initialHistory } from "./lib/history";
import { CancelledError } from "./lib/cancel";
import { makeEffect, type EffectExtraKey } from "./lib/effects";
import {
  keyframeAt,
  keyframeColumns,
  moveKeyframes,
  removeKeyframeAt,
  upsertKeyframe,
  valueAt,
  type AnimatableProp,
} from "./lib/keyframes";
import { loadImageMeta, loadVideoMeta } from "./lib/videoMeta";
import { extractWaveform } from "./lib/waveform";
import { MediaPool } from "./components/MediaPool";
import { Preview } from "./components/Preview";
import { Timeline } from "./components/Timeline";
import { TopBar } from "./components/TopBar";
import { ActionBar } from "./components/ActionBar";
import { ExportDialog } from "./components/ExportDialog";
import { TransitionPanel, type TransitionSlot } from "./components/TransitionPanel";
import { EffectsPanel } from "./components/EffectsPanel";
import { TransformPanel } from "./components/TransformPanel";
import { InspectorPanel, type InspectorTab } from "./components/InspectorPanel";
import {
  clipDuration,
  isClipActiveAt,
  maxClipDurationAt,
  planInsert,
  splitClipAt,
  totalDuration,
} from "./lib/timeline";
import { applyTransition, DEFAULT_TRANSITION_DURATION, retimeTransition } from "./lib/transitions";
import type { Clip, EffectKind, MediaKind, SourceVideo, Track, Transform, Transition, TransitionKind } from "./types";

const FRAME_STEP = 1 / 30;

function makeTrack(index: number, kind: Track["kind"] = "video"): Track {
  return {
    id: crypto.randomUUID(),
    name: kind === "audio" ? `Audio ${index}` : `Track ${index}`,
    kind,
    muted: false,
  };
}

interface EditState {
  tracks: Track[];
  clips: Clip[];
  transitions: Transition[];
}

export default function App() {
  const [sources, setSources] = useState<SourceVideo[]>([]);
  const [history, dispatch] = useReducer(historyReducer<EditState>, undefined, () =>
    initialHistory<EditState>({ tracks: [makeTrack(1)], clips: [], transitions: [] })
  );
  const { tracks, clips, transitions } = history.present;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const [activeTransitionSlot, setActiveTransitionSlot] = useState<TransitionSlot | null>(null);
  const [draggingSourceId, setDraggingSourceId] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"media" | "inspector" | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("transform");
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [exportSettings, setExportSettings] = useState<ExportSettings>({ engine: "auto", quality: "balanced" });
  const [exportOpen, setExportOpen] = useState(false);
  const exportAbortRef = useRef<AbortController | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [projectSize, setProjectSize] = useState({ width: DEFAULT_PROJECT_WIDTH, height: DEFAULT_PROJECT_HEIGHT });
  const [importProgress, setImportProgress] = useState<{ name: string; ratio: number } | null>(null);

  const duration = totalDuration(clips);

  function commitEdit(updater: (prev: EditState) => EditState) {
    dispatch({ type: "commit", updater });
  }

  // Continuous drags (clip move/trim, gizmo transform) call beginLiveEdit once at drag start,
  // updateLive on every pointermove, endLiveEdit once at drag end — so a whole drag gesture
  // collapses into a single undo step instead of one per animation frame.
  const dragSnapshotRef = useRef<EditState | null>(null);
  function beginLiveEdit() {
    dragSnapshotRef.current = history.present;
  }
  function updateLive(updater: (prev: EditState) => EditState) {
    dispatch({ type: "replace", updater });
  }
  function endLiveEdit() {
    if (dragSnapshotRef.current) {
      dispatch({ type: "snapshotCommit", snapshot: dragSnapshotRef.current });
      dragSnapshotRef.current = null;
    }
  }
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  async function handleImport(files: FileList) {
    const controller = new AbortController();
    importAbortRef.current = controller;
    const signal = controller.signal;

    for (const file of Array.from(files)) {
      if (signal.aborted) break;
      setImportProgress({ name: file.name, ratio: 0 });
      try {
        const kind: MediaKind = file.type.startsWith("image/")
          ? "image"
          : file.type.startsWith("audio/")
            ? "audio"
            : "video";
        const url = URL.createObjectURL(file);

        // Images have no timeline or audio to probe — just measure the still. Video/audio go
        // through the frame/metadata extractor, and only real audio tracks get a waveform.
        const meta =
          kind === "image"
            ? await loadImageMeta(url, IMAGE_DEFAULT_DURATION, signal)
            : await loadVideoMeta(url, (ratio) => setImportProgress({ name: file.name, ratio: ratio * 0.7 }), signal);
        setImportProgress({ name: file.name, ratio: 0.75 });
        const waveform = kind === "image" ? { min: [], max: [] } : await extractWaveform(file, signal);
        const sourceId = crypto.randomUUID();

        setSources((prev) => {
          // Adopt the first visual source's dimensions as the project canvas size.
          if (prev.length === 0 && kind !== "audio" && meta.width && meta.height) {
            setProjectSize({ width: meta.width, height: meta.height });
          }
          return [
            ...prev,
            {
              id: sourceId,
              kind,
              url,
              name: file.name,
              duration: meta.duration,
              thumbnail: meta.thumbnail,
              filmstrip: meta.filmstrip,
              waveform,
              width: meta.width,
              height: meta.height,
              file,
            },
          ];
        });
      } catch (err) {
        // Cancelling is a normal outcome; stop quietly rather than reporting a failure.
        if (err instanceof CancelledError) break;
        console.error("import failed", err);
        alert(`Failed to import ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    importAbortRef.current = null;
    setImportProgress(null);
  }

  function handleCancelImport() {
    importAbortRef.current?.abort();
  }

  function handleAddClip(sourceId: string, trackId: string, dropTime: number) {
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return;
    const trackIndex = tracks.findIndex((t) => t.id === trackId);
    const isBaseTrack = trackIndex <= 0;
    const clipId = crypto.randomUUID();
    const plan = planInsert(clips, trackId, dropTime, source.duration);

    const newClip: Clip = {
      id: clipId,
      trackId,
      sourceId,
      start: plan.start,
      inPoint: 0,
      outPoint: source.duration,
      transform: { ...(isBaseTrack ? DEFAULT_TRANSFORM_BASE : DEFAULT_TRANSFORM_OVERLAY) },
      audioMuted: false,
      effects: [],
      keyframes: [],
    };

    commitEdit((prev) => {
      const shiftOf = (c: Clip) =>
        c.trackId === trackId && plan.rippleBy > 0 && c.start >= plan.rippleFrom ? plan.rippleBy : 0;
      const nextClips = prev.clips.map((c) => (shiftOf(c) ? { ...c, start: c.start + shiftOf(c) } : c));

      // A transition only makes sense while its two clips stay adjacent. If the insert pushed
      // one of them but not the other, the pair has been split apart — drop that transition
      // rather than leave it pointing at a gap.
      const nextTransitions = prev.transitions.filter((t) => {
        const left = prev.clips.find((c) => c.id === t.leftClipId);
        const right = prev.clips.find((c) => c.id === t.rightClipId);
        if (!left || !right) return true;
        return shiftOf(left) === shiftOf(right);
      });

      return { ...prev, clips: [...nextClips, newClip], transitions: nextTransitions };
    });

    setSelectedClipId(clipId);
    setIsPlaying(false);
    setPlayhead(plan.start);
  }

  /**
   * Commit a clip drag. Uses the same insert semantics as dropping new media, so dragging a clip
   * onto an occupied spot reorders (pushing neighbours aside) instead of refusing to move.
   * Called once on pointer-release, so a whole drag is a single undo step.
   */
  function handleReorderClip(id: string, trackId: string, dropTime: number) {
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    const others = clips.filter((c) => c.id !== id);
    const plan = planInsert(others, trackId, dropTime, clipDuration(clip));

    const unchanged =
      trackId === clip.trackId && Math.abs(plan.start - clip.start) < 1e-6 && plan.rippleBy === 0;
    if (unchanged) return;

    commitEdit((prev) => {
      const shiftOf = (c: Clip) =>
        c.id !== id && c.trackId === trackId && plan.rippleBy > 0 && c.start >= plan.rippleFrom
          ? plan.rippleBy
          : 0;

      const nextClips = prev.clips.map((c) => {
        if (c.id === id) return { ...c, trackId, start: plan.start };
        const shift = shiftOf(c);
        return shift ? { ...c, start: c.start + shift } : c;
      });

      // Moving a clip breaks any transition it was part of (it's no longer adjacent to its
      // partner), and a ripple that shifts only one side of a pair breaks that pair too.
      const nextTransitions = prev.transitions.filter((t) => {
        if (t.leftClipId === id || t.rightClipId === id) return false;
        const left = prev.clips.find((c) => c.id === t.leftClipId);
        const right = prev.clips.find((c) => c.id === t.rightClipId);
        if (!left || !right) return true;
        return shiftOf(left) === shiftOf(right);
      });

      return { ...prev, clips: nextClips, transitions: nextTransitions };
    });
  }

  function handleTransformClip(id: string, transform: Transform) {
    updateLive((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => (c.id === id ? { ...c, transform } : c)),
    }));
  }

  // Clip-local time of the playhead for a clip, clamped to its span — where keyframes are written.
  function localTimeFor(clip: Clip) {
    return Math.max(0, Math.min(clipDuration(clip), playhead - clip.start));
  }

  /** Write (or move) a keyframe for one property at the playhead. Continuous when dragging. */
  function handleSetKeyframe(clipId: string, prop: AnimatableProp, value: number) {
    updateLive((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => {
        if (c.id !== clipId) return c;
        return { ...c, keyframes: upsertKeyframe(c.keyframes, prop, localTimeFor(c), value) };
      }),
    }));
  }

  /** Diamond toggle: add a keyframe at the playhead (capturing the current value), or drop the one there. */
  function handleToggleKeyframe(clipId: string, prop: AnimatableProp) {
    commitEdit((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => {
        if (c.id !== clipId) return c;
        const t = localTimeFor(c);
        const existing = keyframeAt(c, prop, t);
        const keyframes = existing
          ? removeKeyframeAt(c.keyframes, prop, t)
          : upsertKeyframe(c.keyframes, prop, t, valueAt(c, prop, t));
        return { ...c, keyframes };
      }),
    }));
  }

  /** Jump the playhead to the previous/next keyframe time within the given clip. */
  function handleSeekKeyframe(clip: Clip, dir: -1 | 1) {
    const times = keyframeColumns(clip).map((t) => clip.start + t);
    const cur = playhead;
    const target = dir < 0 ? [...times].reverse().find((t) => t < cur - 1e-4) : times.find((t) => t > cur + 1e-4);
    if (target !== undefined) {
      setIsPlaying(false);
      setPlayhead(target);
    }
  }

  /** Retime a whole keyframe column (dragged on the timeline). Continuous — one undo step. */
  function handleMoveKeyframes(clipId: string, ids: string[], toLocalTime: number) {
    updateLive((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => (c.id === clipId ? { ...c, keyframes: moveKeyframes(c.keyframes, ids, toLocalTime) } : c)),
    }));
  }

  function handleClearKeyframes(clipId: string) {
    commitEdit((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => (c.id === clipId ? { ...c, keyframes: [] } : c)),
    }));
  }

  function handleTrimClip(id: string, inPoint: number, outPoint: number) {
    updateLive((prev) => {
      const clip = prev.clips.find((c) => c.id === id);
      if (!clip) return prev;
      // Both trim edges extend the clip rightward from its fixed start, so stop it at the
      // next clip on the track rather than letting the two overlap.
      const maxDur = maxClipDurationAt(prev.clips, clip.trackId, id, clip.start);
      const clampedOut = Math.min(outPoint, inPoint + maxDur);
      if (clampedOut - inPoint < MIN_CLIP_DURATION) return prev;
      return { ...prev, clips: prev.clips.map((c) => (c.id === id ? { ...c, inPoint, outPoint: clampedOut } : c)) };
    });
  }

  function handleAddTrack(refTrackId?: string, position?: "above" | "below") {
    commitEdit((prev) => {
      const newTrack = makeTrack(prev.tracks.length + 1);
      const refIndex = refTrackId ? prev.tracks.findIndex((t) => t.id === refTrackId) : -1;
      if (refIndex === -1) return { ...prev, tracks: [...prev.tracks, newTrack] };
      const insertAt = position === "below" ? refIndex : refIndex + 1;
      const nextTracks = [...prev.tracks];
      nextTracks.splice(insertAt, 0, newTrack);
      return { ...prev, tracks: nextTracks };
    });
  }

  function handleDeleteTrack(trackId: string) {
    commitEdit((prev) =>
      prev.tracks.length <= 1 ? prev : { ...prev, tracks: prev.tracks.filter((t) => t.id !== trackId) }
    );
  }

  function handleToggleTrackMute(trackId: string) {
    commitEdit((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)),
    }));
  }

  function handleToggleClipMute(clipId: string) {
    commitEdit((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => (c.id === clipId ? { ...c, audioMuted: !c.audioMuted } : c)),
    }));
  }

  function handleExtractAudio(clipId: string) {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    const audioTrackNumber = tracks.filter((t) => t.kind === "audio").length + 1;
    const newTrack = makeTrack(audioTrackNumber, "audio");
    const newClip: Clip = {
      ...clip,
      id: crypto.randomUUID(),
      trackId: newTrack.id,
      transform: { ...DEFAULT_TRANSFORM_BASE },
      audioMuted: false,
      // The detached copy is audio-only, so visual effects/animation don't carry over.
      effects: [],
      keyframes: [],
    };
    commitEdit((prev) => ({
      tracks: [...prev.tracks, newTrack],
      clips: [...prev.clips.map((c) => (c.id === clipId ? { ...c, audioMuted: true } : c)), newClip],
      transitions: prev.transitions,
    }));
  }

  function handleAddEffect(clipId: string, kind: EffectKind) {
    commitEdit((prev) => ({
      ...prev,
      clips: prev.clips.map((c) =>
        // One instance per kind — stacking two blurs just means "more blur", which the
        // intensity slider already covers.
        c.id === clipId && !c.effects.some((e) => e.kind === kind)
          ? { ...c, effects: [...c.effects, makeEffect(kind)] }
          : c
      ),
    }));
  }

  function handleRemoveEffect(clipId: string, effectId: string) {
    commitEdit((prev) => ({
      ...prev,
      clips: prev.clips.map((c) =>
        c.id === clipId ? { ...c, effects: c.effects.filter((e) => e.id !== effectId) } : c
      ),
    }));
  }

  function handleEffectExtra(clipId: string, effectId: string, key: EffectExtraKey, value: number) {
    updateLive((prev) => ({
      ...prev,
      clips: prev.clips.map((c) =>
        c.id === clipId
          ? { ...c, effects: c.effects.map((e) => (e.id === effectId ? { ...e, [key]: value } : e)) }
          : c
      ),
    }));
  }

  function handleEffectIntensity(clipId: string, effectId: string, intensity: number) {
    // Dragging the slider is a continuous gesture, so it coalesces into one undo step.
    updateLive((prev) => ({
      ...prev,
      clips: prev.clips.map((c) =>
        c.id === clipId
          ? { ...c, effects: c.effects.map((e) => (e.id === effectId ? { ...e, intensity } : e)) }
          : c
      ),
    }));
  }

  function handleSelectTransitionSlot(slot: TransitionSlot) {
    setActiveTransitionSlot((prev) =>
      prev && prev.leftClipId === slot.leftClipId && prev.rightClipId === slot.rightClipId ? null : slot
    );
  }

  function handleApplyTransition(kind: TransitionKind) {
    const slot = activeTransitionSlot;
    if (!slot) return;
    const existing = transitions.find((t) => t.leftClipId === slot.leftClipId && t.rightClipId === slot.rightClipId);
    const transitionDuration = existing?.duration ?? DEFAULT_TRANSITION_DURATION;

    commitEdit((prev) => {
      const { clips: nextClips, transition } = applyTransition(
        prev.clips,
        slot.trackId,
        slot.leftClipId,
        slot.rightClipId,
        kind,
        transitionDuration
      );
      return {
        ...prev,
        clips: nextClips,
        transitions: [...prev.transitions.filter((t) => t.id !== existing?.id), transition],
      };
    });

    setIsPlaying(false);
    const leftClip = clips.find((c) => c.id === slot.leftClipId);
    if (leftClip) {
      const leftEnd = leftClip.start + (leftClip.outPoint - leftClip.inPoint);
      setPlayhead(leftEnd - transitionDuration / 2);
    }
  }

  function handleRemoveTransition(id: string) {
    commitEdit((prev) => ({ ...prev, transitions: prev.transitions.filter((t) => t.id !== id) }));
  }

  function handleTransitionDuration(id: string, newDuration: number) {
    commitEdit((prev) => {
      const transition = prev.transitions.find((t) => t.id === id);
      if (!transition) return prev;
      const clampedDuration = Math.max(MIN_CLIP_DURATION, newDuration);
      const nextClips = retimeTransition(prev.clips, transition, clampedDuration);
      return {
        ...prev,
        clips: nextClips,
        transitions: prev.transitions.map((t) => (t.id === id ? { ...t, duration: clampedDuration } : t)),
      };
    });
  }

  function handleTransitionWindow(id: string, field: "in" | "out", value: number) {
    commitEdit((prev) => {
      const transition = prev.transitions.find((t) => t.id === id);
      if (!transition) return prev;
      const rightClip = prev.clips.find((c) => c.id === transition.rightClipId);
      if (!rightClip) return prev;

      const currentStart = rightClip.start;
      const currentEnd = rightClip.start + transition.duration;
      let newStart = currentStart;
      let newDuration = transition.duration;

      if (field === "in") {
        newStart = Math.max(0, Math.min(value, currentEnd - MIN_CLIP_DURATION));
        newDuration = currentEnd - newStart;
      } else {
        const newEnd = Math.max(currentStart + MIN_CLIP_DURATION, value);
        newDuration = newEnd - currentStart;
      }

      return {
        ...prev,
        clips: prev.clips.map((c) => (c.id === rightClip.id ? { ...c, start: newStart } : c)),
        transitions: prev.transitions.map((t) => (t.id === id ? { ...t, duration: newDuration } : t)),
      };
    });
  }

  function handleSelectClip(id: string | null) {
    setSelectedClipId(id);
    if (!id) return;
    const clip = clips.find((c) => c.id === id);
    if (clip && !isClipActiveAt(clip, playhead)) {
      setIsPlaying(false);
      setPlayhead(clip.start);
    }
  }

  function handleTogglePlay() {
    setIsPlaying((playing) => {
      if (!playing && playhead >= duration) {
        setPlayhead(0);
      }
      return !playing;
    });
  }

  function handleSeek(t: number) {
    setIsPlaying(false);
    setPlayhead(Math.max(0, Math.min(t, duration)));
  }

  const handleSplit = useCallback(() => {
    if (!selectedClipId) return;
    const result = splitClipAt(clips, selectedClipId, playhead);
    if (!result) return;
    const index = clips.findIndex((c) => c.id === selectedClipId);
    commitEdit((prev) => {
      const next = [...prev.clips];
      next.splice(index, 1, result.first, result.second);
      return { ...prev, clips: next };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, selectedClipId, clips]);

  // "Cut here and add a transition": splits the selected clip at the playhead, then immediately
  // applies a default cross-dissolve between the two new halves — the one-step version of
  // manually splitting (S) and then picking a transition in the panel.
  const handleCutAndAddTransition = useCallback(() => {
    if (!selectedClipId) return;
    const result = splitClipAt(clips, selectedClipId, playhead);
    if (!result) return;
    const clip = clips.find((c) => c.id === selectedClipId);
    if (!clip) return;
    const index = clips.findIndex((c) => c.id === selectedClipId);
    const trackId = clip.trackId;

    commitEdit((prev) => {
      const nextClips = [...prev.clips];
      nextClips.splice(index, 1, result.first, result.second);
      const { clips: withTransition, transition } = applyTransition(
        nextClips,
        trackId,
        result.first.id,
        result.second.id,
        "fade-cross",
        DEFAULT_TRANSITION_DURATION
      );
      return { ...prev, clips: withTransition, transitions: [...prev.transitions, transition] };
    });

    setActiveTransitionSlot({ trackId, leftClipId: result.first.id, rightClipId: result.second.id });
    setIsPlaying(false);
    setPlayhead(playhead - DEFAULT_TRANSITION_DURATION / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, selectedClipId, clips]);

  const handleDelete = useCallback(() => {
    if (!selectedClipId) return;
    commitEdit((prev) => ({
      ...prev,
      clips: prev.clips.filter((c) => c.id !== selectedClipId),
      transitions: prev.transitions.filter((t) => t.leftClipId !== selectedClipId && t.rightClipId !== selectedClipId),
    }));
    setActiveTransitionSlot((prev) =>
      prev && (prev.leftClipId === selectedClipId || prev.rightClipId === selectedClipId) ? null : prev
    );
    setSelectedClipId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClipId]);

  async function handleExport() {
    if (clips.length === 0 || exportProgress) return;
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExportProgress({ ratio: 0, stage: "Getting ready…" });
    try {
      const blob = await runExport({
        settings: exportSettings,
        sources,
        tracks,
        clips,
        transitions,
        projectWidth: projectSize.width,
        projectHeight: projectSize.height,
        onProgress: setExportProgress,
        signal: controller.signal,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "export.mp4";
      a.click();
      URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch (err) {
      // Cancelling is a normal outcome, not a failure — leave the dialog open so the user can
      // adjust settings and try again.
      if (!(err instanceof ExportCancelledError)) {
        console.error("export failed", err);
        alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      exportAbortRef.current = null;
      setExportProgress(null);
    }
  }

  function handleCancelExport() {
    exportAbortRef.current?.abort();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (exportProgress) return; // editing is locked while the export overlay is up
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === "t" || e.key === "T") {
        handleCutAndAddTransition();
      } else if (e.key === "s" || e.key === "S") {
        handleSplit();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        handleDelete();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 1 : FRAME_STEP;
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        handleSeek(playhead + dir * step);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSplit, handleCutAndAddTransition, handleDelete, undo, redo, playhead, duration, exportProgress]);

  const selectedClip = clips.find((c) => c.id === selectedClipId);
  const canSplit = !!selectedClip && isClipActiveAt(selectedClip, playhead);
  const activeTransition = activeTransitionSlot
    ? transitions.find(
        (t) => t.leftClipId === activeTransitionSlot.leftClipId && t.rightClipId === activeTransitionSlot.rightClipId
      )
    : undefined;
  const activeTransitionWindow = (() => {
    if (!activeTransition) return undefined;
    const rightClip = clips.find((c) => c.id === activeTransition.rightClipId);
    if (!rightClip) return undefined;
    return { start: rightClip.start, end: rightClip.start + activeTransition.duration };
  })();

  return (
    <div className="app">
      <TopBar
        canExport={clips.length > 0}
        canUndo={canUndo}
        canRedo={canRedo}
        exportProgress={exportProgress}
        importProgress={importProgress}
        mobilePanel={mobilePanel}
        onImport={handleImport}
        onCancelImport={handleCancelImport}
        onUndo={undo}
        onRedo={redo}
        onOpenExport={() => setExportOpen(true)}
        onTogglePanel={(p) => setMobilePanel((cur) => (cur === p ? null : p))}
      />
      <div className="app-body">
        {mobilePanel && <div className="panel-backdrop" onClick={() => setMobilePanel(null)} />}
        <MediaPool
          sources={sources}
          importProgress={importProgress}
          open={mobilePanel === "media"}
          onClose={() => setMobilePanel(null)}
          onDragSourceChange={setDraggingSourceId}
        />
        <div className="main-column">
          <Preview
            sources={sources}
            tracks={tracks}
            clips={clips}
            transitions={transitions}
            playhead={playhead}
            isPlaying={isPlaying}
            projectWidth={projectSize.width}
            projectHeight={projectSize.height}
            selectedClipId={selectedClipId}
            onPlayheadChange={setPlayhead}
            onEnded={() => setIsPlaying(false)}
            onTransformClip={handleTransformClip}
            onSelectClip={handleSelectClip}
            onBeginEdit={beginLiveEdit}
            onEndEdit={endLiveEdit}
          />
          <ActionBar
            isPlaying={isPlaying}
            playhead={playhead}
            duration={duration}
            canSplit={canSplit}
            canDelete={selectedClipId !== null}
            selectedClipMuted={selectedClip?.audioMuted ?? false}
            onTogglePlay={handleTogglePlay}
            onSplit={handleSplit}
            onCutAndAddTransition={handleCutAndAddTransition}
            onDelete={handleDelete}
            onToggleMuteClip={() => selectedClipId && handleToggleClipMute(selectedClipId)}
            onExtractAudio={() => selectedClipId && handleExtractAudio(selectedClipId)}
          />
          <Timeline
            sources={sources}
            tracks={tracks}
            clips={clips}
            transitions={transitions}
            playhead={playhead}
            selectedClipId={selectedClipId}
            activeTransitionSlot={activeTransitionSlot}
            draggingSourceId={draggingSourceId}
            onSeek={handleSeek}
            onSelectClip={handleSelectClip}
            onTrimClip={handleTrimClip}
            onReorderClip={handleReorderClip}
            onAddClip={handleAddClip}
            onAddTrack={handleAddTrack}
            onDeleteTrack={handleDeleteTrack}
            onToggleTrackMute={handleToggleTrackMute}
            onSelectTransitionSlot={handleSelectTransitionSlot}
            onMoveKeyframes={handleMoveKeyframes}
            onBeginEdit={beginLiveEdit}
            onEndEdit={endLiveEdit}
          />
        </div>
        <InspectorPanel
          open={mobilePanel === "inspector"}
          tab={inspectorTab}
          onTabChange={setInspectorTab}
          onClose={() => setMobilePanel(null)}
          transform={
            <TransformPanel
              clip={selectedClip}
              playhead={playhead}
              onChange={(t) => selectedClipId && handleTransformClip(selectedClipId, t)}
              onSetKeyframe={(prop, v) => selectedClipId && handleSetKeyframe(selectedClipId, prop, v)}
              onToggleKeyframe={(prop) => selectedClipId && handleToggleKeyframe(selectedClipId, prop)}
              onSeekKeyframe={(dir) => selectedClip && handleSeekKeyframe(selectedClip, dir)}
              onClearKeyframes={() => selectedClipId && handleClearKeyframes(selectedClipId)}
              onBeginEdit={beginLiveEdit}
              onEndEdit={endLiveEdit}
            />
          }
          effects={
            <EffectsPanel
              clip={selectedClip}
              onAdd={(kind) => selectedClipId && handleAddEffect(selectedClipId, kind)}
              onRemove={(effectId) => selectedClipId && handleRemoveEffect(selectedClipId, effectId)}
              onIntensity={(effectId, v) => selectedClipId && handleEffectIntensity(selectedClipId, effectId, v)}
              onExtra={(effectId, key, v) => selectedClipId && handleEffectExtra(selectedClipId, effectId, key, v)}
              onBeginEdit={beginLiveEdit}
              onEndEdit={endLiveEdit}
            />
          }
          transitions={
            <TransitionPanel
              slot={activeTransitionSlot}
              transition={activeTransition}
              windowRange={activeTransitionWindow}
              onApply={handleApplyTransition}
              onRemove={() => activeTransition && handleRemoveTransition(activeTransition.id)}
              onDurationChange={(d) => activeTransition && handleTransitionDuration(activeTransition.id, d)}
              onWindowChange={(field, v) => activeTransition && handleTransitionWindow(activeTransition.id, field, v)}
            />
          }
        />
      </div>

      {(exportOpen || exportProgress) && (
        <ExportDialog
          settings={exportSettings}
          progress={exportProgress}
          projectWidth={projectSize.width}
          projectHeight={projectSize.height}
          duration={duration}
          hasAnimation={clips.some((c) => c.keyframes.length > 0)}
          onChange={setExportSettings}
          onStart={handleExport}
          onCancel={handleCancelExport}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}
