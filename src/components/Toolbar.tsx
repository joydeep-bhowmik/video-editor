import type { ChangeEvent } from "react";
import type { ExportEngine, ExportProgress } from "../export";

interface ToolbarProps {
  isPlaying: boolean;
  playhead: number;
  duration: number;
  canSplit: boolean;
  canDelete: boolean;
  canExport: boolean;
  canUndo: boolean;
  canRedo: boolean;
  selectedClipMuted: boolean;
  exportEngine: ExportEngine;
  exportProgress: ExportProgress | null;
  importProgress: { name: string; ratio: number } | null;
  onImport: (files: FileList) => void;
  onTogglePlay: () => void;
  onSplit: () => void;
  onCutAndAddTransition: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleMuteClip: () => void;
  onExtractAudio: () => void;
  onExportEngineChange: (engine: ExportEngine) => void;
  onExport: () => void;
}

function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

export function Toolbar({
  isPlaying,
  playhead,
  duration,
  canSplit,
  canDelete,
  canExport,
  canUndo,
  canRedo,
  selectedClipMuted,
  exportEngine,
  exportProgress,
  importProgress,
  onImport,
  onTogglePlay,
  onSplit,
  onCutAndAddTransition,
  onDelete,
  onUndo,
  onRedo,
  onToggleMuteClip,
  onExtractAudio,
  onExportEngineChange,
  onExport,
}: ToolbarProps) {
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      onImport(e.target.files);
      e.target.value = "";
    }
  }

  return (
    <div className="toolbar">
      <label className="button">
        {importProgress ? `Importing ${Math.round(importProgress.ratio * 100)}%` : "Import"}
        <input
          type="file"
          accept="video/*,audio/*"
          multiple
          onChange={handleFileChange}
          disabled={importProgress !== null}
          style={{ display: "none" }}
        />
      </label>
      <button className="button" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        Undo
      </button>
      <button className="button" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
        Redo
      </button>

      <span className="toolbar-divider" />

      <button className="button" onClick={onTogglePlay}>
        {isPlaying ? "Pause" : "Play"}
      </button>
      <button className="button" onClick={onSplit} disabled={!canSplit} title="Split at playhead (S)">
        Split
      </button>
      <button
        className="button"
        onClick={onCutAndAddTransition}
        disabled={!canSplit}
        title="Cut selected clip at playhead and add a transition there (T)"
      >
        Cut + Transition
      </button>
      <button className="button" onClick={onDelete} disabled={!canDelete} title="Delete selected clip (Del)">
        Delete
      </button>
      <button
        className="button"
        onClick={onToggleMuteClip}
        disabled={!canDelete}
        title="Mute/unmute selected clip's audio"
      >
        {selectedClipMuted ? "Unmute" : "Mute"}
      </button>
      <button
        className="button"
        onClick={onExtractAudio}
        disabled={!canDelete}
        title="Copy selected clip's audio to a new audio track"
      >
        Extract Audio
      </button>

      <span className="toolbar-divider" />

      <select
        className="button"
        value={exportEngine}
        onChange={(e) => onExportEngineChange(e.target.value as ExportEngine)}
        disabled={exportProgress !== null}
        title="Export engine"
      >
        <option value="auto">Auto</option>
        <option value="ffmpeg">FFmpeg</option>
        <option value="webcodecs">WebCodecs</option>
      </select>
      <button className="button" onClick={onExport} disabled={!canExport || exportProgress !== null}>
        {exportProgress ? `Exporting ${Math.round(exportProgress.ratio * 100)}%` : "Export"}
      </button>

      <span className="time-display">
        {formatTime(playhead)} / {formatTime(duration)}
      </span>
    </div>
  );
}
