"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { useT } from "@/components/i18n";

/** Round button bottom-right once you're well down a long page; glides back to the top. */
export function BackToTop() {
  const tr = useT();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > window.innerHeight * 1.5);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <button
      type="button"
      aria-label={tr("Back to top")}
      title={tr("Back to top")}
      tabIndex={show ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
      className={cx(
        // Sits above the product page's buy bar on phones (it sets --buy-bar).
        "fixed right-4 bottom-[calc(1rem+var(--buy-bar,0px)+env(safe-area-inset-bottom))] z-30 grid size-11 cursor-pointer place-items-center rounded-full bg-leaf-900 text-white shadow-[0_8px_24px_-8px_rgb(17_58_39/0.6)] transition-[opacity,translate,bottom,scale] duration-300 hover:bg-leaf-800 active:scale-90 sm:right-6 sm:bottom-6",
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
      )}
    >
      <ArrowUp className="size-5" />
    </button>
  );
}
