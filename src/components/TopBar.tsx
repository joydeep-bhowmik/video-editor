import type { ChangeEvent } from "react";
import { IconButton } from "./IconButton";
import type { ExportEngine, ExportProgress } from "../export";

interface TopBarProps {
  canUndo: boolean;
  canRedo: boolean;
  canExport: boolean;
  exportEngine: ExportEngine;
  exportProgress: ExportProgress | null;
  importProgress: { name: string; ratio: number } | null;
  mobilePanel: "media" | "transitions" | null;
  onImport: (files: FileList) => void;
  onUndo: () => void;
  onRedo: () => void;
  onExportEngineChange: (engine: ExportEngine) => void;
  onExport: () => void;
  onTogglePanel: (panel: "media" | "transitions") => void;
}

export function TopBar({
  canUndo,
  canRedo,
  canExport,
  exportEngine,
  exportProgress,
  importProgress,
  mobilePanel,
  onImport,
  onUndo,
  onRedo,
  onExportEngineChange,
  onExport,
  onTogglePanel,
}: TopBarProps) {
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      onImport(e.target.files);
      e.target.value = "";
    }
  }

  return (
    <header className="topbar">
      <div className="brand">
        <i className="ri-clapperboard-fill" aria-hidden="true" />
        <span>Studio</span>
      </div>

      <label
        className={"btn btn-primary" + (importProgress ? " is-busy" : "")}
        data-tip="Add video or audio from your device"
      >
        <i className={importProgress ? "ri-loader-4-line spinning" : "ri-add-line"} aria-hidden="true" />
        <span>{importProgress ? `${Math.round(importProgress.ratio * 100)}%` : "Add"}</span>
        <input
          type="file"
          accept="video/*,audio/*"
          multiple
          onChange={handleFileChange}
          disabled={importProgress !== null}
          hidden
        />
      </label>

      <div className="topbar-spacer" />

      <IconButton
        icon="ri-arrow-go-back-line"
        label="Undo"
        hint="Take back your last change"
        shortcut="Ctrl+Z"
        disabled={!canUndo}
        onClick={onUndo}
      />
      <IconButton
        icon="ri-arrow-go-forward-line"
        label="Redo"
        hint="Re-apply what you undid"
        shortcut="Ctrl+Shift+Z"
        disabled={!canRedo}
        onClick={onRedo}
      />

      {/* Panel toggles live here on phones, where the side columns become drawers. */}
      <div className="topbar-panels">
        <IconButton
          icon="ri-folder-video-line"
          label="Media"
          hint="Your imported clips"
          active={mobilePanel === "media"}
          onClick={() => onTogglePanel("media")}
        />
        <IconButton
          icon="ri-magic-line"
          label="Effects"
          hint="Transitions between clips"
          active={mobilePanel === "transitions"}
          onClick={() => onTogglePanel("transitions")}
        />
      </div>

      <select
        className="engine-select"
        value={exportEngine}
        onChange={(e) => onExportEngineChange(e.target.value as ExportEngine)}
        disabled={exportProgress !== null}
        data-tip="Auto keeps sound; WebCodecs is faster but video-only"
        aria-label="Export engine"
      >
        <option value="auto">Auto</option>
        <option value="ffmpeg">FFmpeg</option>
        <option value="webcodecs">Fast (no audio)</option>
      </select>

      <button
        type="button"
        className="btn btn-primary"
        onClick={onExport}
        disabled={!canExport || exportProgress !== null}
        data-tip="Save the finished video to your device"
      >
        <i className={exportProgress ? "ri-loader-4-line spinning" : "ri-download-2-line"} aria-hidden="true" />
        <span>{exportProgress ? `${Math.round(exportProgress.ratio * 100)}%` : "Export"}</span>
      </button>
    </header>
  );
}
