"use client";

import { Building2, ClipboardList, CornerDownLeft, Package, Search, ShoppingBag, Truck, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchHit } from "@/app/api/admin/search/route";
import { useT } from "@/components/i18n";
import { Spinner, cx } from "@/components/ui";
import type { Role } from "@/lib/db/schema";
import { navFor } from "./side-nav";

type Result = { key: string; title: string; detail: string; href: string; icon: LucideIcon };

const KIND_ICON: Record<SearchHit["kind"], LucideIcon> = { sale: ShoppingBag, delivery: Truck, customer: Building2, product: Package, purchase: ClipboardList };

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * One search box for the whole back office (⌘K / Ctrl+K, or "/"): jump to a page by name, or
 * find an order, customer, product or purchase order by number, name, phone, SKU or barcode.
 */
export function AdminSearch({ role, variant }: { role: Role; variant: "sidebar" | "icon" }) {
  const tr = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const staff = role !== "sales";

  // Keyboard shortcut from anywhere in the back office.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The layout renders one box for wide screens (sidebar) and one for phones (header);
      // only the one on screen answers, or a hidden dialog would block the page.
      if ((variant === "sidebar") !== window.matchMedia("(min-width: 1024px)").matches) return;
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      input.current?.select();
    }
    if (!open && d.open) d.close();
  }, [open]);

  // Data results, a moment after typing stops.
  useEffect(() => {
    const term = q.trim();
    if (!staff || term.length < 2) {
      queueMicrotask(() => {
        setHits([]);
        setLoading(false);
      });
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal });
        const body = res.ok ? ((await res.json()) as { hits: SearchHit[] }) : { hits: [] };
        setHits(body.hits);
        setActive(0);
      } catch {
        // Aborted by the next keystroke, or offline: keep what's shown.
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, staff]);

  const pages = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all = navFor(role).flatMap((s) => s.items.map((i) => ({ ...i, section: s.title })));
    const match = (i: (typeof all)[number]) => !term || i.label.toLowerCase().includes(term) || tr(i.label).toLowerCase().includes(term);
    return all.filter(match).slice(0, term ? 5 : 8);
  }, [q, role, tr]);

  const results: Result[] = [
    ...pages.map((p) => ({ key: `page:${p.href}`, title: tr(p.label), detail: tr(p.section), href: p.href, icon: p.icon })),
    ...hits.map((h) => ({ key: `${h.kind}:${h.href}`, title: h.title, detail: h.detail, href: h.href, icon: KIND_ICON[h.kind] })),
  ];

  const go = (r: Result | undefined) => {
    if (!r) return;
    setOpen(false);
    router.push(r.href);
  };

  const shortcut = isMac() ? "⌘K" : "Ctrl K";

  return (
    <>
      {variant === "sidebar" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mx-3 mb-1 flex h-9 items-center gap-2 rounded-lg bg-white/[0.06] px-2.5 text-sm text-slate-400 ring-1 ring-white/10 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Search className="size-4" />
          <span className="flex-1 text-left">{tr("Search…")}</span>
          <kbd className="rounded bg-white/10 px-1.5 font-sans text-[10px] text-slate-300" suppressHydrationWarning>
            {shortcut}
          </kbd>
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} aria-label={tr("Search")} className="grid size-10 place-items-center rounded-lg text-slate-300 hover:bg-white/10">
          <Search className="size-5" />
        </button>
      )}

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === dialog.current && setOpen(false)}
        className="mx-auto mt-[10vh] w-[calc(100%-2rem)] max-w-xl animate-pop overflow-hidden rounded-2xl border border-line bg-white p-0 text-slate-900 shadow-pop backdrop:bg-black/40"
      >
        {open && (
          <div
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(results[active]);
              }
            }}
          >
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search className="size-4 shrink-0 text-slate-400" />
              <input
                ref={input}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                placeholder={tr(staff ? "Order number, customer, phone, product or page…" : "Go to a page…")}
                aria-label={tr("Search")}
                className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400"
                autoComplete="off"
                autoFocus
              />
              {loading && <Spinner className="size-4 text-slate-400" />}
            </div>
            <ul className="max-h-[60vh] overflow-y-auto p-2" role="listbox">
              {results.map((r, i) => (
                <li key={r.key} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(r)}
                    className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left", i === active ? "bg-blue-50" : "hover:bg-slate-50")}
                  >
                    <r.icon className={cx("size-4 shrink-0", i === active ? "text-blue-600" : "text-slate-400")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{r.title}</span>
                      <span className="block truncate text-xs text-slate-500">{r.detail}</span>
                    </span>
                    {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-slate-400" />}
                  </button>
                </li>
              ))}
              {results.length === 0 && !loading && (
                <li className="px-3 py-8 text-center text-sm text-slate-500">{q.trim().length < 2 ? tr("Type at least 2 letters.") : tr("Nothing found.")}</li>
              )}
            </ul>
            <p className="border-t border-line bg-slate-50 px-4 py-2 text-[11px] text-slate-500">{tr("↑ ↓ to move · Enter to open · Esc to close")}</p>
          </div>
        )}
      </dialog>
    </>
  );
}
