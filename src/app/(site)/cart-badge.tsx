"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui";

/** Tells every cart badge on the page that items were added (negative to undo), before the server confirms. */
export function bumpCart(qty: number) {
  window.dispatchEvent(new CustomEvent("cart:add", { detail: qty }));
}

/** Cart count that updates the moment something is added, then settles on the server's number. */
export function CartBadge({ count }: { count: number }) {
  // Shown = server count + items added since that count arrived. A new server count replaces the guess.
  const [base, setBase] = useState(count);
  const [pending, setPending] = useState(0);
  const [pulse, setPulse] = useState(0);
  if (count !== base) {
    setBase(count);
    setPending(0);
  }
  const shown = Math.max(0, count + pending);
  useEffect(() => {
    const on = (e: Event) => {
      const qty = (e as CustomEvent<number>).detail;
      setPending((n) => n + qty);
      if (qty > 0) setPulse((p) => p + 1);
    };
    window.addEventListener("cart:add", on);
    return () => window.removeEventListener("cart:add", on);
  }, []);
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
