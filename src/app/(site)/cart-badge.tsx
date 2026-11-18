"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { aud } from "@/lib/money";

/** Tells every cart badge on the page that items were added (negative to undo), before the server confirms. */
export function bumpCart(qty: number) {
  window.dispatchEvent(new CustomEvent("cart:add", { detail: qty }));
}

/**
 * The cart count as shown: the server's count plus whatever was added since it arrived (so it
 * moves the moment a button is tapped), with `pulse` going up on each add and `pending` the
 * part the server hasn't confirmed yet. A new server count replaces the guess.
 */
export function useCartCount(count: number) {
  const [base, setBase] = useState(count);
  const [pending, setPending] = useState(0);
  const [pulse, setPulse] = useState(0);
  if (count !== base) {
    setBase(count);
    setPending(0);
  }
  useEffect(() => {
    const on = (e: Event) => {
      const qty = (e as CustomEvent<number>).detail;
      setPending((n) => n + qty);
      if (qty > 0) setPulse((p) => p + 1);
    };
    window.addEventListener("cart:add", on);
    return () => window.removeEventListener("cart:add", on);
  }, []);
  return { shown: Math.max(0, count + pending), pending, pulse };
}

/** Cart count that updates the moment something is added, then settles on the server's number. */
export function CartBadge({ count }: { count: number }) {
  const { shown, pulse } = useCartCount(count);
  if (shown <= 0) return null;
  return (
    <span
      key={pulse}
      className={cx(
        "absolute -top-0.5 right-0 grid h-5 min-w-5 place-items-center rounded-full bg-tomato px-1 text-[11px] font-semibold text-white tabular-nums",
        pulse > 0 && "animate-bump",
      )}
    >
      {shown > 99 ? "99+" : shown}
    </span>
  );
}

/**
 * A small dot that flies in an arc from the button that was tapped to the cart (the bottom bar
 * on a phone, else the header's cart), so it's clear where the item went. Nothing with
 * "reduce motion" on, or when no cart is on screen.
 */
export function flyToCart(from: Element) {
  if (typeof window === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const onScreen = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < innerHeight;
  };
  const targets = [...document.querySelectorAll<HTMLElement>("[data-cart-target]")].filter(onScreen);
  const to = targets.find((t) => t.dataset.cartTarget === "bar") ?? targets[0];
  if (!to) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  // Across on one element and up-then-down on the other: together they make an arc.
  const across = document.createElement("span");
  across.className = "cart-fly";
  across.style.left = `${a.left + a.width / 2 - 9}px`;
  across.style.top = `${a.top + a.height / 2 - 9}px`;
  const dot = document.createElement("span");
  across.append(dot);
  document.body.append(across);
  const lift = Math.min(90, Math.abs(dy) * 0.35 + 40);
  const duration = 620;
  across.animate([{ transform: "translateX(0)" }, { transform: `translateX(${dx}px)` }], { duration, easing: "cubic-bezier(0.4, 0, 0.6, 1)", fill: "forwards" });
  dot
    .animate(
      [
        { transform: "translateY(0) scale(1)", opacity: 1 },
        { transform: `translateY(${Math.min(0, dy) - lift}px) scale(1.15)`, opacity: 1, offset: 0.35, easing: "cubic-bezier(0.4, 0, 1, 1)" },
        { transform: `translateY(${dy}px) scale(0.45)`, opacity: 0.7 },
      ],
      { duration, easing: "cubic-bezier(0.2, 0, 0.2, 1)", fill: "forwards" },
    )
    .finished.then(
      () => across.remove(),
      () => across.remove(),
    );
}

/** A dollar amount that rolls to its new value instead of jumping (a short count, eased). */
export function RollingAmount({ cents, className }: { cents: number; className?: string }) {
  const [shown, setShown] = useState(cents);
  const from = useRef(cents);
  useEffect(() => {
    const start = from.current;
    if (start === cents) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = cents;
      queueMicrotask(() => setShown(cents));
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 450);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = Math.round(start + (cents - start) * eased);
      setShown(v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [cents]);
  return <span className={cx("tabular-nums", className)}>{aud(shown)}</span>;
}
