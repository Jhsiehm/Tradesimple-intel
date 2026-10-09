import type { ReactNode } from "react";
import type { IconName } from "./names";
import { PATHS } from "./paths";
import "./icons.css";

export type { IconName } from "./names";

/**
 * Inline SVG icon from the hand-drawn set. Decorative (`aria-hidden`) unless `title` is given; the button
 * around it carries the accessible name.
 */
export function Icon({ name, size = 14, title, className }: { name: IconName; size?: number; title?: string; className?: string }) {
  return (
    <svg
      className={className ? `ic ${className}` : "ic"}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name].map((p, i) => (typeof p === "string" ? <path key={i} d={p} /> : <path key={i} d={p.d} fill="currentColor" />))}
    </svg>
  );
}

/**
 * Icon plus a text label. `hide` marks where the label may collapse to icon-only (phones, tight toolbars);
 * it stays in the accessible name either way.
 */
export function IconLabel({ icon, children, hide }: { icon: IconName; children: ReactNode; hide?: boolean }) {
  return (
    <>
      <Icon name={icon} />
      <span className={hide ? "ic-lbl ic-tight" : "ic-lbl"}>{children}</span>
    </>
  );
}
