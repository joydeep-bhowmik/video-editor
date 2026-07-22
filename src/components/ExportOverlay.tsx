import type { ExportProgress } from "../export";

interface ExportOverlayProps {
  progress: ExportProgress;
}

export function ExportOverlay({ progress }: ExportOverlayProps) {
  const percent = Math.round(progress.ratio * 100);
  return (
    <div className="export-overlay">
      <div className="export-overlay-box">
        <div className="export-overlay-title">Exporting…</div>
        <div className="export-overlay-stage">{progress.stage}</div>
        <div className="export-overlay-bar-track">
          <div className="export-overlay-bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="export-overlay-percent">{percent}%</div>
        <div className="export-overlay-hint">Editing is locked until the export finishes.</div>
      </div>
    </div>
  );
}
