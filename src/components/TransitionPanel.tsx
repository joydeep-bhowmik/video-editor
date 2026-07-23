import { useEffect, useState } from "react";
import { DEFAULT_TRANSITION_DURATION, TRANSITION_BY_KIND, TRANSITION_CATALOG } from "../lib/transitions";
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
  onApply,
  onRemove,
  onDurationChange,
  onWindowChange,
}: TransitionPanelProps) {
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

  if (!slot) {
    return (
      <div className="panel-empty">
        Put two clips side by side on a track, then tap the{" "}
        <i className="ri-contrast-2-line" aria-hidden="true" /> badge where they meet to blend
        them.
      </div>
    );
  }

  const activeDef = transition ? TRANSITION_BY_KIND.get(transition.kind) : undefined;

  return (
    <div className="effects-body">
      {transition && windowRange && (
        <div className="effect-applied">
          <div className="effect-card">
            <div className="effect-card-head">
              <i className={activeDef?.icon ?? "ri-magic-line"} aria-hidden="true" />
              <span className="effect-card-name">{activeDef?.label ?? transition.kind}</span>
              <button
                type="button"
                className="effect-remove"
                onClick={onRemove}
                data-tip="Remove this transition"
                aria-label="Remove transition"
              >
                <i className="ri-close-line" aria-hidden="true" />
              </button>
            </div>

            <label className="effect-slider-row">
              <span>In</span>
              <input
                type="number"
                step="0.1"
                className="effect-number"
                value={inInput}
                onChange={(e) => setInInput(e.target.value)}
                onBlur={commitIn}
                onKeyDown={onEnterBlur(commitIn)}
              />
              <span className="effect-value">s</span>
            </label>
            <label className="effect-slider-row">
              <span>Out</span>
              <input
                type="number"
                step="0.1"
                className="effect-number"
                value={outInput}
                onChange={(e) => setOutInput(e.target.value)}
                onBlur={commitOut}
                onKeyDown={onEnterBlur(commitOut)}
              />
              <span className="effect-value">s</span>
            </label>
            <label className="effect-slider-row">
              <span>Duration</span>
              <input
                type="number"
                step="0.1"
                min="0.1"
                className="effect-number"
                value={durationInput}
                onChange={(e) => setDurationInput(e.target.value)}
                onBlur={commitDuration}
                onKeyDown={onEnterBlur(commitDuration)}
              />
              <span className="effect-value">s</span>
            </label>
          </div>
        </div>
      )}

      <div className="effect-picker-title">{transition ? "Change transition" : "Add a transition"}</div>

      {TRANSITION_CATALOG.map((cat) => (
        <div className="transition-category" key={cat.category}>
          <div className="transition-category-title">
            <i className={cat.icon} aria-hidden="true" />
            <span>{cat.category}</span>
          </div>
          <div className="effect-grid">
            {cat.items.map((item) => (
              <button
                type="button"
                key={item.kind}
                className={"effect-tile" + (transition?.kind === item.kind ? " is-applied" : "")}
                onClick={() => onApply(item.kind)}
                data-tip={
                  transition?.kind === item.kind
                    ? `${item.label} is applied here`
                    : `${cat.category} — ${item.label}`
                }
              >
                <i className={item.icon} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
