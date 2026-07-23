import { webCodecsSupported, type ExportEngine, type ExportProgress, type ExportQuality, type ExportSettings } from "../export";

interface ExportDialogProps {
  settings: ExportSettings;
  progress: ExportProgress | null;
  projectWidth: number;
  projectHeight: number;
  duration: number;
  /** True when any clip is keyframe-animated — ffmpeg renders those as a static snapshot. */
  hasAnimation: boolean;
  onChange: (settings: ExportSettings) => void;
  onStart: () => void;
  onCancel: () => void;
  onClose: () => void;
}

interface Choice<T> {
  value: T;
  label: string;
  description: string;
  badge?: string;
}

const ENGINES: Choice<ExportEngine>[] = [
  {
    value: "auto",
    label: "Automatic",
    description: "Picks the safest engine for your project. Keeps audio. Best choice if you're unsure.",
    badge: "Recommended",
  },
  {
    value: "ffmpeg",
    label: "Full quality",
    description: "Renders everything — video, audio, transitions and effects. Slower, but nothing is left out.",
  },
  {
    value: "webcodecs",
    label: "Fast",
    description: "Uses your device's hardware encoder, so it finishes much sooner. Your video will have no sound.",
    badge: "No audio",
  },
];

const QUALITIES: Choice<ExportQuality>[] = [
  { value: "high", label: "High", description: "Sharpest picture, biggest file. Good for archiving or re-editing." },
  { value: "balanced", label: "Balanced", description: "Looks good at a sensible file size. Fine for most uploads.", badge: "Recommended" },
  { value: "small", label: "Small", description: "Smallest file, softer picture. Handy for messaging or slow connections." },
];

function formatDuration(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ExportDialog({
  settings,
  progress,
  projectWidth,
  projectHeight,
  duration,
  hasAnimation,
  onChange,
  onStart,
  onCancel,
  onClose,
}: ExportDialogProps) {
  const busy = progress !== null;
  const percent = progress ? Math.round(progress.ratio * 100) : 0;
  // Animated projects now render their motion on every engine (the ffmpeg path borrows the
  // canvas renderer for video and muxes audio back in). The only exception is the rare browser
  // without WebCodecs, where the ffmpeg engine still falls back to a static frame.
  const animationWarning = hasAnimation && settings.engine !== "webcodecs" && !webCodecsSupported();

  return (
    // Backdrop clicks only dismiss while idle — a render in flight shouldn't be closable by accident.
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <i className="ri-download-2-line" aria-hidden="true" />
          <span>Export video</span>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={busy}
            data-tip={busy ? "Cancel the export first" : "Close"}
            aria-label="Close"
          >
            <i className="ri-close-line" aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body">
          <div className="export-summary">
            <span>
              <i className="ri-aspect-ratio-line" aria-hidden="true" /> {projectWidth}×{projectHeight}
            </span>
            <span>
              <i className="ri-time-line" aria-hidden="true" /> {formatDuration(duration)}
            </span>
          </div>

          <fieldset className="option-group" disabled={busy}>
            <legend>How should we render it?</legend>
            {ENGINES.map((choice) => (
              <label
                key={choice.value}
                className={"option" + (settings.engine === choice.value ? " is-selected" : "")}
              >
                <input
                  type="radio"
                  name="export-engine"
                  checked={settings.engine === choice.value}
                  onChange={() => onChange({ ...settings, engine: choice.value })}
                />
                <span className="option-text">
                  <span className="option-label">
                    {choice.label}
                    {choice.badge && <span className="option-badge">{choice.badge}</span>}
                  </span>
                  <span className="option-desc">{choice.description}</span>
                </span>
              </label>
            ))}
            {animationWarning && (
              <div className="export-warning">
                <i className="ri-alert-line" aria-hidden="true" />
                <span>
                  This project has animated clips, but this browser lacks WebCodecs — the motion
                  will render frozen on one frame. Try a current Chrome or Edge.
                </span>
              </div>
            )}
          </fieldset>

          <fieldset className="option-group" disabled={busy}>
            <legend>Quality</legend>
            {QUALITIES.map((choice) => (
              <label
                key={choice.value}
                className={"option" + (settings.quality === choice.value ? " is-selected" : "")}
              >
                <input
                  type="radio"
                  name="export-quality"
                  checked={settings.quality === choice.value}
                  onChange={() => onChange({ ...settings, quality: choice.value })}
                />
                <span className="option-text">
                  <span className="option-label">
                    {choice.label}
                    {choice.badge && <span className="option-badge">{choice.badge}</span>}
                  </span>
                  <span className="option-desc">{choice.description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {busy && (
            <div className="export-progress">
              <div className="export-progress-head">
                <span>{progress.stage}</span>
                <span className="export-progress-pct">{percent}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <p className="export-progress-note">
                Keep this tab open — closing it will stop the export.
              </p>
            </div>
          )}
        </div>

        <div className="modal-foot">
          {busy ? (
            <button type="button" className="btn btn-danger" onClick={onCancel}>
              <i className="ri-stop-circle-line" aria-hidden="true" />
              <span>Cancel export</span>
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
              <button type="button" className="btn btn-primary" onClick={onStart}>
                <i className="ri-download-2-line" aria-hidden="true" />
                <span>Start export</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
