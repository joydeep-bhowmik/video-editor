import type { ReactNode } from "react";

export type InspectorTab = "transform" | "effects" | "transitions";

interface InspectorPanelProps {
  open: boolean;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onClose: () => void;
  transform: ReactNode;
  effects: ReactNode;
  transitions: ReactNode;
}

const TABS: { id: InspectorTab; icon: string; label: string }[] = [
  { id: "transform", icon: "ri-drag-move-2-line", label: "Transform" },
  { id: "effects", icon: "ri-sparkling-line", label: "Effects" },
  { id: "transitions", icon: "ri-magic-line", label: "Transitions" },
];

/**
 * Right-hand inspector. Transform, Effects and Transitions share one column via tabs rather than
 * each claiming their own — three side-by-side panels doesn't fit, and all three only ever act on
 * the current selection anyway.
 */
export function InspectorPanel({
  open,
  tab,
  onTabChange,
  onClose,
  transform,
  effects,
  transitions,
}: InspectorPanelProps) {
  return (
    <aside className={"inspector side-panel" + (open ? " is-open" : "")}>
      <div className="side-panel-header">
        <div className="inspector-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={"inspector-tab" + (tab === t.id ? " is-active" : "")}
              onClick={() => onTabChange(t.id)}
              data-tip={t.label}
              aria-label={t.label}
            >
              <i className={t.icon} aria-hidden="true" />
              {/* Label only on the active tab, so three tabs fit a narrow column. */}
              <span className="inspector-tab-label">{t.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="side-panel-close" onClick={onClose} aria-label="Close">
          <i className="ri-close-line" aria-hidden="true" />
        </button>
      </div>

      <div className="inspector-body">
        {tab === "transform" ? transform : tab === "effects" ? effects : transitions}
      </div>
    </aside>
  );
}
