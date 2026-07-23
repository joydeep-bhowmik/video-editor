import type { ChangeEvent } from "react";
import { IconButton } from "./IconButton";
import type { ExportProgress } from "../export";

interface TopBarProps {
  projectName: string;
  canUndo: boolean;
  canRedo: boolean;
  canExport: boolean;
  exportProgress: ExportProgress | null;
  importProgress: { name: string; ratio: number } | null;
  mobilePanel: "media" | "inspector" | null;
  onImport: (files: FileList) => void;
  onCancelImport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenExport: () => void;
  onOpenProjects: () => void;
  onOpenAspectRatio: () => void;
  onTogglePanel: (panel: "media" | "inspector") => void;
}

export function TopBar({
  projectName,
  canUndo,
  canRedo,
  canExport,
  exportProgress,
  importProgress,
  mobilePanel,
  onImport,
  onCancelImport,
  onUndo,
  onRedo,
  onOpenExport,
  onOpenProjects,
  onOpenAspectRatio,
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
      <button
        type="button"
        className="brand brand-button"
        onClick={onOpenProjects}
        data-tip="Projects — switch, rename or create"
      >
        <i className="ri-clapperboard-fill" aria-hidden="true" />
        <span className="brand-name">{projectName}</span>
        <i className="ri-arrow-down-s-line brand-caret" aria-hidden="true" />
      </button>
      <IconButton
        icon="ri-aspect-ratio-line"
        label="Canvas"
        hint="Change aspect ratio / resolution"
        onClick={onOpenAspectRatio}
      />

      {importProgress ? (
        // Swaps to a real button while busy: the idle control is a <label> wrapping a file
        // input, so clicking it would reopen the file picker instead of stopping the import.
        <button
          type="button"
          className="btn btn-icon"
          onClick={onCancelImport}
          data-tip={`Importing ${importProgress.name} — click to cancel`}
          aria-label="Cancel import"
        >
          <i className="ri-close-line" aria-hidden="true" />
          <span className="btn-progress">{Math.round(importProgress.ratio * 100)}%</span>
        </button>
      ) : (
        <label
          className="btn btn-primary btn-icon"
          data-tip="Add media — pick video or audio from your device"
        >
          <i className="ri-add-line" aria-hidden="true" />
          <input
            type="file"
            accept="video/*,audio/*,image/*"
            multiple
            onChange={handleFileChange}
            hidden
          />
        </label>
      )}

      <div className="topbar-spacer" />

      <IconButton
        icon="ri-arrow-go-back-line"
        label="Undo"
        hint="Take back your last change"
        shortcut="Ctrl+Z"
        iconOnly
        disabled={!canUndo}
        onClick={onUndo}
      />
      <IconButton
        icon="ri-arrow-go-forward-line"
        label="Redo"
        hint="Re-apply what you undid"
        shortcut="Ctrl+Shift+Z"
        iconOnly
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
          icon="ri-sparkling-line"
          label="Effects"
          hint="Effects and transitions for the selected clip"
          active={mobilePanel === "inspector"}
          onClick={() => onTogglePanel("inspector")}
        />
      </div>

      <button
        type="button"
        className="btn btn-primary btn-icon"
        onClick={onOpenExport}
        disabled={!canExport}
        data-tip="Export — save the finished video to your device"
        aria-label="Export"
      >
        <i className={exportProgress ? "ri-loader-4-line spinning" : "ri-download-2-line"} aria-hidden="true" />
      </button>
    </header>
  );
}
