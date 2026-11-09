"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import Link from "@/components/link";
import { cx } from "@/components/ui";
import { T } from "@/components/i18n";

type Item = { href: string; label: string; n?: number; icon?: boolean };

/**
 * The link for the page you're on, or the one just clicked: it lights up the moment it's
 * clicked rather than when the next page arrives, so a tap always gets an instant answer.
 */
function useActive() {
  const pathname = usePathname();
  const [clicked, setClicked] = useState<{ href: string; from: string } | null>(null);
  const active = clicked && clicked.from === pathname ? clicked.href : pathname;
  const onClick = (href: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0 || href.includes("#")) return;
    setClicked({ href, from: pathname });
  };
  return { active, onClick };
}

/**
 * Moves the highlight (a pill or an underline) onto the active link, gliding from the last one.
 * Works for rows that scroll sideways too, and keeps the active link in view there.
 */
function useIndicator(active: string, mode: "pill" | "underline") {
  const nav = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const box = nav.current;
    const bar = mark.current;
    if (!box || !bar) return;
    const place = (animate: boolean) => {
      const el = box.querySelector<HTMLElement>("[data-active]");
      if (!el) {
        bar.style.opacity = "0";
        return;
      }
      if (!animate) bar.style.transition = "none";
      bar.style.opacity = "1";
      bar.style.width = `${el.offsetWidth}px`;
      if (mode === "pill") {
        bar.style.height = `${el.offsetHeight}px`;
        bar.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`;
      } else bar.style.transform = `translateX(${el.offsetLeft}px)`;
      if (!animate) {
        void bar.offsetWidth;
        bar.style.transition = "";
      }
      box.dataset.ready = "";
      // In a sideways-scrolling row, bring the active link into view.
      if (box.scrollWidth > box.clientWidth) {
        const left = el.offsetLeft;
        if (left < box.scrollLeft || left + el.offsetWidth > box.scrollLeft + box.clientWidth)
          box.scrollTo({ left: left - (box.clientWidth - el.offsetWidth) / 2, behavior: animate ? "smooth" : "auto" });
      }
    };
    place(box.dataset.ready !== undefined);
    const ro = new ResizeObserver(() => place(false));
    ro.observe(box);
    const el = box.querySelector("[data-active]");
    if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [active, mode]);
  return { nav, mark };
}

/** The category row under the site header, with an underline that slides to the current page. */
export function CategoryNav({ items }: { items: Item[] }) {
  const { active, onClick } = useActive();
  const { nav, mark } = useIndicator(active, "underline");
  return (
    <div ref={nav} className="relative mx-auto flex max-w-6xl gap-5 overflow-x-auto px-4 py-0.5 text-sm whitespace-nowrap text-leaf-900/75 [scrollbar-width:none] sm:px-6">
      {items.map((it) => {
        const on = it.href === active;
        return (
          <Link
            key={it.href}
            href={it.href}
            onClick={onClick(it.href)}
            data-active={on || undefined}
            aria-current={on ? "page" : undefined}
            className={cx("relative inline-flex h-10 items-center transition-colors hover:text-leaf-700", on && "font-semibold text-leaf-950", it.href === "/products" && "font-medium text-leaf-950")}
          >
            <T>{it.label}</T>
          </Link>
        );
      })}
      <span
        ref={mark}
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 h-[2px] bg-leaf-950 opacity-0 transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
      />
    </div>
  );
}

/** The category list beside the products: a pill glides to the chosen category. */
export function CategorySidebar({ items }: { items: Item[] }) {
  const { active, onClick } = useActive();
  const { nav, mark } = useIndicator(active, "pill");
  return (
    <div ref={nav} className="group/nav relative mt-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-col lg:overflow-visible">
      <span
        ref={mark}
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 rounded-md bg-leaf-950 opacity-0 transition-[transform,width,height,opacity] duration-200 ease-out"
      />
      {items.map((it) => {
        const on = it.href === active;
        return (
          <Link
            key={it.href}
            href={it.href}
            onClick={onClick(it.href)}
            data-active={on || undefined}
            aria-current={on ? "page" : undefined}
            className={cx(
              "group relative flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-[color,background-color] duration-150 max-lg:ring-1 max-lg:ring-leaf-950/15",
              // Until the pill is in place (before the page is interactive) the link paints its own.
              on ? "font-semibold text-white bg-leaf-950 group-data-ready/nav:bg-transparent" : "text-leaf-900/80 hover:bg-leaf-950/5",
            )}
          >
            <span className="flex-1">
              <T>{it.label}</T>
            </span>
            {it.n !== undefined && <span className={cx("text-xs tabular-nums", on ? "text-white/70" : "text-leaf-900/40")}>{it.n}</span>}
          </Link>
        );
      })}
    </div>
  );
}
