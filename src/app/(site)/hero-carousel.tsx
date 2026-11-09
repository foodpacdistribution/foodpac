"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cx } from "@/components/ui";
import { useT } from "@/components/i18n";

export type CarouselSlide = { id: string; tab: string; content: React.ReactNode };

const reducedMotion = {
  subscribe(cb: () => void) {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    m.addEventListener("change", cb);
    return () => m.removeEventListener("change", cb);
  },
  get: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
};

/**
 * Home page posters, one at a time. Moves on by itself every `interval` ms (the tab under the
 * active poster fills up meanwhile), and holds while the pointer or keyboard focus is on it, while
 * it's scrolled out of view, or after the pause button. Swipe, the arrows or the arrow keys move
 * it by hand. With "reduce motion" switched on it never moves by itself.
 */
export function HeroCarousel({ slides, interval = 7000 }: { slides: CarouselSlide[]; interval?: number }) {
  const tr = useT();
  const n = slides.length;
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<"next" | "prev">("next");
  // Each turn restarts the tab's fill, even when the same poster comes round again.
  const [turn, setTurn] = useState(0);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  const reduce = useSyncExternalStore(reducedMotion.subscribe, reducedMotion.get, () => false);
  const root = useRef<HTMLElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const autoplay = n > 1 && !reduce && !stopped;
  const holding = hover || focused || offscreen;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOffscreen(!e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const go = (to: number, d: "next" | "prev" = to > index ? "next" : "prev") => {
    setDir(d);
    setIndex(((to % n) + n) % n);
    setTurn((t) => t + 1);
  };
  const next = () => go(index + 1, "next");
  const prev = () => go(index - 1, "prev");

  if (!n) return null;

  return (
    <section
      ref={root}
      aria-roledescription={tr("carousel")}
      aria-label={tr("Featured")}
      data-dir={dir}
      className="hero-carousel relative isolate overflow-hidden bg-leaf-950 text-cream [touch-action:pan-y]"
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
      // Keyboard focus holds it; a mouse click on a tab or arrow doesn't.
      onFocus={(e) => setFocused(e.target.matches(":focus-visible"))}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocused(false)}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("input, textarea, select")) return;
        if (e.key === "ArrowRight") next();
        else if (e.key === "ArrowLeft") prev();
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s) return;
        const dx = e.clientX - s.x;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) (dx < 0 ? next : prev)();
      }}
      onPointerCancel={() => (swipe.current = null)}
    >
      {/* Every poster sits in the same cell, so the carousel is as tall as the tallest one and never jumps. */}
      <div className="grid" aria-live={autoplay && !holding ? "off" : "polite"}>
        {slides.map((s, i) => (
          <div
            key={s.id}
            role="group"
            aria-roledescription={tr("slide")}
            aria-label={`${i + 1} / ${n} · ${tr(s.tab)}`}
            inert={i !== index}
            data-active={i === index || undefined}
            className={cx(
              "hero-slide [grid-area:1/1] transition-[opacity,visibility] duration-700 ease-out",
              i === index ? "z-10 opacity-100" : "invisible z-0 opacity-0",
            )}
          >
            {s.content}
          </div>
        ))}
      </div>

      {n > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pb-4 sm:px-6 sm:pb-5">
            <div className="pointer-events-auto flex flex-1 gap-2 sm:gap-3" role="tablist" aria-label={tr("Choose a poster")}>
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  aria-label={tr(s.tab)}
                  onClick={() => go(i)}
                  className="group/tab flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col justify-center gap-2 py-2 text-left sm:min-h-0 sm:max-w-44"
                >
                  <span className="relative block h-0.5 w-full overflow-hidden bg-white/20 transition-colors group-hover/tab:bg-white/35">
                    {i === index &&
                      (autoplay ? (
                        <span
                          key={turn}
                          className="hero-progress absolute inset-0 origin-left bg-white"
                          style={{ animationDuration: `${interval}ms`, animationPlayState: holding ? "paused" : "running" }}
                          onAnimationEnd={next}
                        />
                      ) : (
                        <span className="absolute inset-0 bg-white" />
                      ))}
                    
                  </span>
                  <span
                    className={cx(
                      "hidden truncate text-xs font-semibold transition-colors md:block",
                      i === index ? "text-white" : "text-white/50 group-hover/tab:text-white/80",
                    )}
                  >
                    {tr(s.tab)}
                  </span>
                </button>
              ))}
            </div>
            <div className="pointer-events-auto flex items-center gap-1.5">
              {!reduce && (
                <CtrlButton label={tr(stopped ? "Play" : "Pause")} onClick={() => setStopped((v) => !v)}>
                  {stopped ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                </CtrlButton>
              )}
              <CtrlButton label={tr("Previous")} onClick={prev} className="hidden sm:grid">
                <ChevronLeft className="size-4" />
              </CtrlButton>
              <CtrlButton label={tr("Next")} onClick={next} className="hidden sm:grid">
                <ChevronRight className="size-4" />
              </CtrlButton>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function CtrlButton({ label, onClick, className, children }: { label: string; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        "grid size-9 cursor-pointer place-items-center rounded-md text-white/80 ring-1 ring-white/20 transition-colors hover:bg-white/10 hover:text-white",
        className,
      )}
    >
      {children}
    </button>
  );
}
