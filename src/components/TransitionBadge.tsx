interface TransitionBadgeProps {
  hasTransition: boolean;
  editing: boolean;
  onClick: () => void;
}

export function TransitionBadge({ hasTransition, editing, onClick }: TransitionBadgeProps) {
  return (
    <button
      type="button"
      className={
        "transition-badge" +
        (hasTransition ? " transition-badge-active" : "") +
        (editing ? " transition-badge-editing" : "")
      }
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      data-tip={hasTransition ? "Edit this transition" : "Add a transition between these clips"}
      aria-label={hasTransition ? "Edit transition" : "Add transition"}
    >
      <i className="ri-contrast-2-line" aria-hidden="true" />
    </button>
  );
}
