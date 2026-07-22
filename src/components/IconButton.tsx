import type { ReactNode } from "react";

interface IconButtonProps {
  /** RemixIcon class, e.g. "ri-play-fill". */
  icon: string;
  /** Short name shown beside the icon on wide screens and inside the tooltip. */
  label: string;
  /** Plain-language explanation of what this does — the beginner-facing part of the tooltip. */
  hint?: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  /** Keep the text label visible even on narrow screens (for primary actions). */
  alwaysShowLabel?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}

export function IconButton({
  icon,
  label,
  hint,
  shortcut,
  active,
  disabled,
  alwaysShowLabel,
  onClick,
  children,
}: IconButtonProps) {
  const tip = [label, hint, shortcut ? `(${shortcut})` : ""].filter(Boolean).join(" — ");
  return (
    <button
      type="button"
      className={"icon-button" + (active ? " is-active" : "")}
      onClick={onClick}
      disabled={disabled}
      data-tip={tip}
      aria-label={label}
    >
      <i className={icon} aria-hidden="true" />
      <span className={"icon-button-label" + (alwaysShowLabel ? " is-always" : "")}>{label}</span>
      {children}
    </button>
  );
}
