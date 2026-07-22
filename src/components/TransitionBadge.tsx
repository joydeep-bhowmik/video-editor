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
      title={hasTransition ? "Edit transition" : "Add transition"}
    >
      ⧗
    </button>
  );
}
