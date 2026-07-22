import { Waveform } from "./Waveform";
import type { SourceVideo } from "../types";

interface MediaPoolProps {
  sources: SourceVideo[];
  importProgress: { name: string; ratio: number } | null;
}

function formatDuration(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

export function MediaPool({ sources, importProgress }: MediaPoolProps) {
  return (
    <div className="media-pool">
      <div className="media-pool-header">Media Pool</div>
      {sources.length === 0 && !importProgress && (
        <div className="media-pool-empty">Import a video to add it here</div>
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
            }}
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
      <div className="media-pool-hint">Drag a clip onto a track</div>
    </div>
  );
}
