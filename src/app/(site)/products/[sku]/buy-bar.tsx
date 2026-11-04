"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

/**
 * Phones: once the main price and buttons (`watch`, an element id) have scrolled up out of view,
 * a bar with the same essentials stays at the bottom of the screen.
 */
export function BuyBar({ watch, children }: { watch: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = document.getElementById(watch);
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, [watch]);
  // Lets the back-to-top button sit above the bar.
  useEffect(() => {
    const root = document.documentElement;
    const h = bar.current?.offsetHeight ?? 0;
    const narrow = matchMedia("(max-width: 1023px)").matches;
    if (show && narrow) root.style.setProperty("--buy-bar", `${h}px`);
    else root.style.removeProperty("--buy-bar");
    return () => {
      root.style.removeProperty("--buy-bar");
    };
  }, [show]);
  return (
    <div
      ref={bar}
      inert={!show}
      className={cx(
        "fixed inset-x-0 bottom-0 z-30 border-t border-leaf-950/10 bg-cream/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_rgb(17_58_39/0.25)] backdrop-blur transition-transform duration-300 ease-out lg:hidden",
        show ? "translate-y-0" : "translate-y-full",
      )}
    >
      {children}
    </div>
  );
}
