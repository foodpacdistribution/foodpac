"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "./i18n";
import { btn } from "./ui";

/**
 * Long lists are drawn a page at a time: hundreds of rows on screen at once make a phone stall
 * on every tap (opening a form, typing a search). `key` is whatever narrows the list (search,
 * filter); when it changes, the list starts again from the first page.
 */
export function usePaged<T>(items: T[], key: string, page = 60) {
  const [limit, setLimit] = useState(page);
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setLimit(page);
  }
  return {
    visible: items.length > limit ? items.slice(0, limit) : items,
    remaining: Math.max(0, items.length - limit),
    more: () => setLimit((n) => n + page),
  };
}

/** At the end of a paged list: draws the next page as it comes near the screen, or on a tap. */
export function LoadMore({ remaining, onMore }: { remaining: number; onMore: () => void }) {
  const tr = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && onMore(), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [onMore]);
  if (!remaining) return null;
  return (
    <div ref={ref} className="p-3 text-center">
      <button type="button" className={btn("secondary", "sm")} onClick={onMore}>
        {tr("Show more")} <span className="opacity-60">({remaining})</span>
      </button>
    </div>
  );
}
