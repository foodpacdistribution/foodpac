import { cx } from "./ui";

/** Foodpac Distribution mark: a packed box with a leaf, on a green tile. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx("shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#1e6b44" />
      <path d="M8 13.5 16 10l8 3.5v8L16 25l-8-3.5z" fill="#faf6ee" />
      <path d="M8 13.5 16 17l8-3.5M16 17v8" stroke="#1e6b44" strokeWidth="1.4" strokeLinejoin="round" fill="none" />
      <path d="M17.5 9.2c.4-2.6 2.6-4 5.4-3.8-.2 2.9-2.4 4.4-5.4 3.8z" fill="#e4572e" />
    </svg>
  );
}
