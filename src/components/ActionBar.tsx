interface ActionBarProps {
  isPlaying: boolean;
  playhead: number;
  duration: number;
  canSplit: boolean;
  canDelete: boolean;
  selectedClipMuted: boolean;
  onTogglePlay: () => void;
  onSplit: () => void;
  onCutAndAddTransition: () => void;
  onDelete: () => void;
  onToggleMuteClip: () => void;
  onExtractAudio: () => void;
}

function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Action {
  icon: string;
  label: string;
  hint: string;
  shortcut?: string;
  disabled: boolean;
  onClick: () => void;
}

/**
 * Transport + clip actions, sitting directly under the preview. Everything here operates on
 * the current selection, so keeping it adjacent to the canvas (rather than in the top bar)
 * puts the controls next to what they affect — and gives phones a proper thumb-reach row.
 */
export function ActionBar({
  isPlaying,
  playhead,
  duration,
  canSplit,
  canDelete,
  selectedClipMuted,
  onTogglePlay,
  onSplit,
  onCutAndAddTransition,
  onDelete,
  onToggleMuteClip,
  onExtractAudio,
}: ActionBarProps) {
  const actions: Action[] = [
    {
      icon: "ri-scissors-cut-line",
      label: "Split",
      hint: "Cut the selected clip in two at the playhead",
      shortcut: "S",
      disabled: !canSplit,
      onClick: onSplit,
    },
    {
      icon: "ri-magic-line",
      label: "Blend",
      hint: "Split here and fade between the halves",
      shortcut: "T",
      disabled: !canSplit,
      onClick: onCutAndAddTransition,
    },
    {
      icon: selectedClipMuted ? "ri-volume-mute-line" : "ri-volume-up-line",
      label: selectedClipMuted ? "Unmute" : "Mute",
      hint: "Silence just the selected clip",
      disabled: !canDelete,
      onClick: onToggleMuteClip,
    },
    {
      icon: "ri-music-2-line",
      label: "Detach",
      hint: "Move this clip's sound to its own track",
      disabled: !canDelete,
      onClick: onExtractAudio,
    },
    {
      icon: "ri-delete-bin-line",
      label: "Delete",
      hint: "Remove the selected clip",
      shortcut: "Del",
      disabled: !canDelete,
      onClick: onDelete,
    },
  ];

  return (
    <div className="action-bar">
      <button
        type="button"
        className="play-button"
        onClick={onTogglePlay}
        data-tip={isPlaying ? "Pause (Space)" : "Play (Space)"}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        <i className={isPlaying ? "ri-pause-fill" : "ri-play-fill"} aria-hidden="true" />
      </button>

      <div className="timecode">
        <span className="timecode-now">{formatTime(playhead)}</span>
        <span className="timecode-total">/ {formatTime(duration)}</span>
      </div>

      <div className="action-list">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className={"action" + (a.label === "Delete" ? " is-danger" : "")}
            onClick={a.onClick}
            disabled={a.disabled}
            data-tip={`${a.label} — ${a.hint}${a.shortcut ? ` (${a.shortcut})` : ""}`}
            aria-label={a.label}
          >
            <i className={a.icon} aria-hidden="true" />
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
