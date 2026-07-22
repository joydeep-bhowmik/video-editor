import type { ReactNode } from "react";

export type InspectorTab = "effects" | "transitions";

interface InspectorPanelProps {
  open: boolean;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onClose: () => void;
  effects: ReactNode;
  transitions: ReactNode;
}

/**
 * Right-hand inspector. Effects and Transitions share one column via tabs rather than each
 * claiming their own — three side-by-side panels doesn't fit, and both only ever act on the
 * current selection anyway.
 */
export function InspectorPanel({
  open,
  tab,
  onTabChange,
  onClose,
  effects,
  transitions,
}: InspectorPanelProps) {
  return (
    <aside className={"inspector side-panel" + (open ? " is-open" : "")}>
      <div className="side-panel-header">
        <div className="inspector-tabs">
          <button
            type="button"
            className={"inspector-tab" + (tab === "effects" ? " is-active" : "")}
            onClick={() => onTabChange("effects")}
          >
            <i className="ri-sparkling-line" aria-hidden="true" />
            Effects
          </button>
          <button
            type="button"
            className={"inspector-tab" + (tab === "transitions" ? " is-active" : "")}
            onClick={() => onTabChange("transitions")}
          >
            <i className="ri-magic-line" aria-hidden="true" />
            Transitions
          </button>
        </div>
        <button type="button" className="side-panel-close" onClick={onClose} aria-label="Close">
          <i className="ri-close-line" aria-hidden="true" />
        </button>
      </div>

      <div className="inspector-body">{tab === "effects" ? effects : transitions}</div>
    </aside>
  );
}
