import { Waveform } from "./Waveform";
import type { SourceVideo } from "../types";

interface MediaPoolProps {
  sources: SourceVideo[];
  importProgress: { name: string; ratio: number } | null;
  /** Drawer state — only meaningful on small screens; on desktop the panel is always shown. */
  open: boolean;
  onClose: () => void;
  onDragSourceChange: (sourceId: string | null) => void;
}

function formatDuration(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

export function MediaPool({ sources, importProgress, open, onClose, onDragSourceChange }: MediaPoolProps) {
  return (
    <div className={"media-pool side-panel" + (open ? " is-open" : "")}>
      <div className="side-panel-header">
        <i className="ri-folder-video-line" aria-hidden="true" />
        <span>Your Media</span>
        <button type="button" className="side-panel-close" onClick={onClose} aria-label="Close">
          <i className="ri-close-line" aria-hidden="true" />
        </button>
      </div>
      {sources.length === 0 && !importProgress && (
        <div className="media-pool-empty">
          Tap <strong>Add</strong> in the toolbar to bring in a video or song.
        </div>
      )}
      <div className="media-pool-list">
        {importProgress && (
          <div className="media-pool-item media-pool-item-loading">
            <div className="media-pool-item-row">
              <div className="media-pool-thumb media-pool-thumb-placeholder" />
              <div className="media-pool-meta">
                <span className="media-pool-name">{importProgress.name}</span>
                <span className="media-pool-duration">Importing… {Math.round(importProgress.ratio * 100)}%</span>
              </div>
            </div>
          </div>
        )}
        {sources.map((source) => (
          <div
            key={source.id}
            className="media-pool-item"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", source.id);
              e.dataTransfer.effectAllowed = "copy";
              // dataTransfer contents aren't readable during dragover (only on drop), so the
              // timeline gets the dragged source through app state to preview the drop.
              onDragSourceChange(source.id);
            }}
            onDragEnd={() => onDragSourceChange(null)}
          >
            <div className="media-pool-item-row">
              {source.thumbnail ? (
                <img src={source.thumbnail} alt="" className="media-pool-thumb" draggable={false} />
              ) : (
                <div className="media-pool-thumb media-pool-thumb-placeholder" />
              )}
              <div className="media-pool-meta">
                <span className="media-pool-name">{source.name}</span>
                <span className="media-pool-duration">{formatDuration(source.duration)}</span>
              </div>
            </div>
            {source.waveform.max.length > 0 && (
              <Waveform className="media-pool-waveform" peaks={source.waveform} />
            )}
          </div>
        ))}
      </div>
      <div className="media-pool-hint">
        <i className="ri-drag-move-2-line" aria-hidden="true" /> Drag any item down onto a track
      </div>
    </div>
  );
}
