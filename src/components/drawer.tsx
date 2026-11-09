"use client";

import { useEffect, useRef } from "react";
import { cx } from "./ui";

/**
 * A panel that slides in from the left over a fading backdrop (the phone menu). It stays mounted
 * so opening and closing both animate; only transform and opacity change, which phones animate
 * smoothly. Close by tapping outside, Esc, or swiping it back to the left (it follows the finger).
 */
export function Drawer({ open, onClose, label, className, children }: { open: boolean; onClose: () => void; label: string; className?: string; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; t: number; dx: number; horizontal: boolean | null } | null>(null);

  // While open: the page behind doesn't scroll, and Esc closes.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = before;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    drag.current = { x: t.clientX, y: t.clientY, t: performance.now(), dx: 0, horizontal: null };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const d = drag.current;
    const p = panel.current;
    if (!d || !p) return;
    const t = e.touches[0];
    const dx = t.clientX - d.x;
    const dy = t.clientY - d.y;
    // Decide once whether this is a sideways swipe or a scroll of the list.
    if (d.horizontal === null && Math.hypot(dx, dy) > 8) d.horizontal = Math.abs(dx) > Math.abs(dy);
    if (!d.horizontal) return;
    d.dx = Math.min(0, dx);
    p.style.transition = "none";
    p.style.transform = `translateX(${d.dx}px)`;
    if (backdrop.current) {
      backdrop.current.style.transition = "none";
      backdrop.current.style.opacity = String(Math.max(0, 1 + d.dx / p.offsetWidth));
    }
  };
  const onTouchEnd = () => {
    const d = drag.current;
    const p = panel.current;
    drag.current = null;
    if (!d?.horizontal || !p) return;
    // Hand the movement back to the CSS transition, from wherever the finger left it.
    p.style.transition = "";
    if (backdrop.current) backdrop.current.style.transition = "";
    const speed = d.dx / Math.max(1, performance.now() - d.t); // px per ms
    if (d.dx < -p.offsetWidth * 0.3 || speed < -0.5) {
      onClose();
    } else {
      p.style.transform = "translateX(0)";
      if (backdrop.current) backdrop.current.style.opacity = "1";
    }
  };

  return (
    <div className={cx("fixed inset-0 z-50", !open && "pointer-events-none")} inert={!open}>
      <div ref={backdrop} aria-hidden onClick={onClose} className="drawer-backdrop absolute inset-0 bg-black/45" style={{ opacity: open ? 1 : 0 }} />
      <div
        ref={panel}
        role="dialog"
        aria-modal
        aria-label={label}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        className={cx("drawer-panel absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col overflow-y-auto overscroll-contain shadow-2xl", className)}
        style={{ transform: open ? "translateX(0)" : "translateX(-100%)" }}
      >
        {children}
      </div>
    </div>
  );
}
