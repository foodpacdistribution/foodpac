"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * A thin orange bar across the top from the moment a link to another page is clicked until that
 * page is showing, so every click gets an answer even when the page takes a moment to load.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = pathname + (search ? `?${search}` : "");
  // The page the click was made on: the bar shows until the address moves on from it.
  const [from, setFrom] = useState<string | null>(null);
  // Arrived somewhere new: done (so coming back here later doesn't bring the bar back).
  const [seen, setSeen] = useState(here);
  if (seen !== here) {
    setSeen(here);
    setFrom(null);
  }

  useEffect(() => {
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    // Capture phase: runs before the link's own handler takes over the click.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      setFrom(location.pathname + location.search);
      clearTimeout(giveUp);
      giveUp = setTimeout(() => setFrom(null), 15000);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearTimeout(giveUp);
    };
  }, []);

  if (from === null || from !== here) return null;
  return (
    <span aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] origin-left animate-progress bg-gradient-to-r from-tomato to-amber-400 shadow-[0_0_10px_rgb(224_98_12/0.6)]" />
  );
}
