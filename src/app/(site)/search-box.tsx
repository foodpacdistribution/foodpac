"use client";

import { ArrowRight, Search } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { cx, Spinner } from "@/components/ui";
import { productImageUrl } from "@/lib/product-image";

type Hit = { id: string; sku: string; name: string; category: string; packSize: string; hasImage: boolean; updatedAt: string };

/** Shop search with suggestions as you type (debounced, cancels stale requests, keyboard friendly). */
export function SearchBox({ className, size = "md", autoFocus }: { className?: string; size?: "md" | "lg"; autoFocus?: boolean }) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const data = (await res.json()) as { results: Hit[] };
        setHits(data.results);
        setActive(-1);
      } catch {
        // Aborted by a newer keystroke, or offline: keep the last suggestions.
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 140);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const showList = open && q.trim().length >= 2;
  const lg = size === "lg";

  return (
    <form
      ref={box}
      role="search"
      action="/products"
      onSubmit={(e) => {
        e.preventDefault();
        if (active >= 0 && hits[active]) return go(`/products/${encodeURIComponent(hits[active].sku)}`);
        if (q.trim()) go(`/products?q=${encodeURIComponent(q.trim())}`);
      }}
      className={cx("relative items-center", className)}
    >
      <Search className={cx("pointer-events-none absolute text-leaf-900/40", lg ? "left-4 size-5" : "left-3.5 size-4")} />
      <input
        name="q"
        type="search"
        value={q}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (e.target.value.trim().length < 2) setHits([]);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, -1));
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={lg ? "Search by product, SKU or barcode" : "Search products, SKU or barcode"}
        className={cx(
          "w-full rounded-full bg-white text-leaf-950 placeholder:text-leaf-900/40 focus:outline-none",
          lg ? "h-13 pr-32 pl-12 text-base focus:ring-4 focus:ring-tomato/30" : "h-10 border border-leaf-950/15 pr-9 pl-10 text-sm focus:border-leaf-600 focus:ring-2 focus:ring-leaf-600/20",
        )}
      />
      {loading && !lg && <Spinner className="absolute right-3.5 size-3.5 text-leaf-900/40" />}
      {lg && <button className="absolute right-1.5 h-10 rounded-full bg-tomato px-5 text-sm font-semibold text-white transition-colors hover:bg-tomato-dark active:scale-[0.97]">Search</button>}

      {showList && (
        <div id={listId} role="listbox" className="absolute top-full right-0 left-0 z-50 mt-2 animate-pop overflow-hidden rounded-2xl border border-leaf-950/10 bg-white text-left text-leaf-950 shadow-pop">
          {hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-leaf-900/55">{loading ? "Searching…" : `No products match “${q.trim()}”.`}</p>
          ) : (
            hits.map((h, i) => (
              <button
                key={h.id}
                id={`${listId}-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(`/products/${encodeURIComponent(h.sku)}`)}
                className={cx("flex w-full items-center gap-3 px-3 py-2 text-left transition-colors", i === active ? "bg-leaf-50" : "hover:bg-leaf-50/60")}
              >
                <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-leaf-50 text-xs font-semibold text-leaf-700/60">
                  {h.hasImage ? <Image src={productImageUrl(h)} alt="" fill sizes="40px" className="object-cover" /> : h.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{h.name}</span>
                  <span className="block truncate text-xs text-leaf-900/55">
                    {h.sku} · {h.packSize || h.category}
                  </span>
                </span>
              </button>
            ))
          )}
          <button
            type="button"
            onClick={() => go(`/products?q=${encodeURIComponent(q.trim())}`)}
            className="flex w-full items-center justify-between border-t border-leaf-950/10 px-4 py-2.5 text-sm font-semibold text-leaf-700 hover:bg-leaf-50"
          >
            See all results for “{q.trim()}” <ArrowRight className="size-4" />
          </button>
        </div>
      )}
    </form>
  );
}
