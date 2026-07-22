import { useEffect, useState } from "react";
import { DEFAULT_TRANSITION_DURATION, TRANSITION_CATALOG } from "../lib/transitions";
import type { Transition, TransitionKind } from "../types";

export interface TransitionSlot {
  trackId: string;
  leftClipId: string;
  rightClipId: string;
}

interface TransitionWindow {
  start: number;
  end: number;
}

interface TransitionPanelProps {
  slot: TransitionSlot | null;
  transition: Transition | undefined;
  windowRange: TransitionWindow | undefined;
  /** Drawer state — only meaningful on small screens; on desktop the panel is always shown. */
  open: boolean;
  onClose: () => void;
  onApply: (kind: TransitionKind) => void;
  onRemove: () => void;
  onDurationChange: (duration: number) => void;
  onWindowChange: (field: "in" | "out", value: number) => void;
}

function fmt(n: number) {
  return n.toFixed(2);
}

export function TransitionPanel({
  slot,
  transition,
  windowRange,
  open,
  onClose,
  onApply,
  onRemove,
  onDurationChange,
  onWindowChange,
}: TransitionPanelProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [durationInput, setDurationInput] = useState(String(transition?.duration ?? DEFAULT_TRANSITION_DURATION));
  const [inInput, setInInput] = useState(windowRange ? fmt(windowRange.start) : "");
  const [outInput, setOutInput] = useState(windowRange ? fmt(windowRange.end) : "");

  useEffect(() => {
    setDurationInput(String(transition?.duration ?? DEFAULT_TRANSITION_DURATION));
    setInInput(windowRange ? fmt(windowRange.start) : "");
    setOutInput(windowRange ? fmt(windowRange.end) : "");
  }, [transition?.duration, windowRange?.start, windowRange?.end, slot?.leftClipId, slot?.rightClipId]);

  function commitDuration() {
    const parsed = parseFloat(durationInput);
    if (!Number.isNaN(parsed) && parsed > 0) onDurationChange(parsed);
    else setDurationInput(String(transition?.duration ?? DEFAULT_TRANSITION_DURATION));
  }

  function commitIn() {
    const parsed = parseFloat(inInput);
    if (!Number.isNaN(parsed)) onWindowChange("in", parsed);
    else setInInput(windowRange ? fmt(windowRange.start) : "");
  }

  function commitOut() {
    const parsed = parseFloat(outInput);
    if (!Number.isNaN(parsed)) onWindowChange("out", parsed);
    else setOutInput(windowRange ? fmt(windowRange.end) : "");
  }

  function onEnterBlur(commit: () => void) {
    return (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        commit();
        e.currentTarget.blur();
      }
    };
  }

  return (
    <div className={"transition-panel side-panel" + (open ? " is-open" : "")}>
      <div className="side-panel-header">
        <i className="ri-magic-line" aria-hidden="true" />
        <span>Transitions</span>
        <button type="button" className="side-panel-close" onClick={onClose} aria-label="Close">
          <i className="ri-close-line" aria-hidden="true" />
        </button>
      </div>

      {!slot && (
        <div className="transition-panel-empty">
          Put two clips side by side on a track, then tap the{" "}
          <i className="ri-contrast-2-line" aria-hidden="true" /> badge where they meet to blend
          them.
        </div>
      )}

      {slot && (
        <>
          {transition && windowRange && (
            <div className="transition-panel-timing">
              <div className="transition-panel-row">
                <label>In</label>
                <input
                  type="number"
                  step="0.1"
                  value={inInput}
                  onChange={(e) => setInInput(e.target.value)}
                  onBlur={commitIn}
                  onKeyDown={onEnterBlur(commitIn)}
                />
                <span>s</span>
              </div>
              <div className="transition-panel-row">
                <label>Out</label>
                <input
                  type="number"
                  step="0.1"
                  value={outInput}
                  onChange={(e) => setOutInput(e.target.value)}
                  onBlur={commitOut}
                  onKeyDown={onEnterBlur(commitOut)}
                />
                <span>s</span>
              </div>
              <div className="transition-panel-row">
                <label>Duration</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={durationInput}
                  onChange={(e) => setDurationInput(e.target.value)}
                  onBlur={commitDuration}
                  onKeyDown={onEnterBlur(commitDuration)}
                />
                <span>s</span>
                <button type="button" className="transition-remove" onClick={onRemove}>
                  Remove
                </button>
              </div>
            </div>
          )}
          {!transition && <div className="transition-panel-hint">Pick a transition for this boundary:</div>}

          <div className="transition-catalog">
            {TRANSITION_CATALOG.map((cat) => (
              <div key={cat.category} className="transition-category">
                <button
                  type="button"
                  className="transition-category-toggle"
                  onClick={() => setExpandedCategory((c) => (c === cat.category ? null : cat.category))}
                >
                  {cat.category}
                </button>
                {expandedCategory === cat.category && (
                  <div className="transition-items">
                    {cat.items.map((item) => (
                      <button
                        type="button"
                        key={item.kind}
                        className={"transition-item" + (transition?.kind === item.kind ? " selected" : "")}
                        onClick={() => onApply(item.kind)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
