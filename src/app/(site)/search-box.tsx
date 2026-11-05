"use client";

import { ArrowRight, Search } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cx, Spinner } from "@/components/ui";
import { productImageUrl } from "@/lib/product-image";
import { matchProducts, type SearchEntry } from "@/lib/search-match";
import { useT } from "@/components/i18n";

type Hit = { id: string; sku: string; name: string; category: string; packSize: string; hasImage: boolean; updatedAt: string };
type Catalog = { products: SearchEntry[]; complete: boolean };

// The catalogue's searchable fields, fetched once (from the CDN) and shared by every search box,
// so suggestions are worked out in the browser as you type. A failed download is retried next focus.
let catalogLoad: Promise<Catalog | null> | undefined;
function loadCatalog() {
  catalogLoad ??= fetch("/api/search/catalog")
    .then((r) => (r.ok ? (r.json() as Promise<Catalog>) : null))
    .catch(() => null)
    .then((c) => {
      if (!c) catalogLoad = undefined;
      return c;
    });
  return catalogLoad;
}

/** Shop search with suggestions as you type (instant from the catalogue, else debounced server search; keyboard friendly). */
export function SearchBox({ className, size = "md", autoFocus }: { className?: string; size?: "md" | "lg"; autoFocus?: boolean }) {
  const tr = useT();
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  const [serverHits, setServerHits] = useState<Hit[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLFormElement>(null);
  const prepare = () => void loadCatalog().then((c) => c && setCatalog(c));

  const term = q.trim();
  // Matches in the browser; when there are none the server also looks in descriptions.
  const localHits = useMemo(() => (catalog?.complete && term.length >= 2 ? matchProducts(catalog.products, term) : []), [catalog, term]);
  const local = localHits.length > 0;
  const hits: Hit[] = local ? localHits : serverHits;

  useEffect(() => {
    if (term.length < 2 || local) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const data = (await res.json()) as { results: Hit[] };
        setServerHits(data.results);
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
  }, [term, local]);

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
  const showList = open && term.length >= 2;
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
          setActive(-1);
          if (e.target.value.trim().length < 2) setServerHits([]);
        }}
        onFocus={() => {
          setOpen(true);
          prepare();
        }}
        onPointerEnter={prepare}
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
        placeholder={tr(lg ? "Search by product, SKU or barcode" : "Search products, SKU or barcode")}
        className={cx(
          "w-full rounded-md bg-white text-leaf-950 placeholder:text-leaf-900/40 focus:outline-none",
          lg ? "h-13 pr-32 pl-12 text-base focus:ring-4 focus:ring-tomato/30" : "h-10 border border-leaf-950/20 pr-9 pl-10 text-sm focus:border-leaf-600 focus:ring-2 focus:ring-leaf-600/20",
        )}
      />
      {loading && !local && !lg && <Spinner className="absolute right-3.5 size-3.5 text-leaf-900/40" />}
      {lg && <button className="absolute right-1.5 h-10 rounded bg-tomato px-5 text-sm font-semibold text-white transition-colors hover:bg-tomato-dark active:scale-[0.97]">{tr("Search")}</button>}

      {showList && (
        <div id={listId} role="listbox" className="absolute top-full right-0 left-0 z-50 mt-2 animate-pop overflow-hidden rounded-2xl border border-leaf-950/10 bg-white text-left text-leaf-950 shadow-pop">
          {hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-leaf-900/55">{loading ? tr("Searching…") : `No products match “${q.trim()}”.`}</p>
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
            {tr("See all results for “")}{q.trim()}” <ArrowRight className="size-4" />
          </button>
        </div>
      )}
    </form>
  );
}
