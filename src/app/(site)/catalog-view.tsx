"use client";

import { ChevronDown, LayoutGrid, List } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, use, useState } from "react";
import { useT } from "@/components/i18n";
import { cx } from "@/components/ui";

import { type CatalogLayout, VIEW_COOKIE } from "./catalog-layout";

const ViewContext = createContext<{ view: CatalogLayout; setView: (v: CatalogLayout) => void }>({ view: "grid", setView: () => {} });

/** Holds the grid/list choice for the toolbar switch and the product grid below it. */
export function CatalogView({ initial, children }: { initial: CatalogLayout; children: React.ReactNode }) {
  const [view, setViewState] = useState(initial);
  const setView = (v: CatalogLayout) => {
    setViewState(v);
    document.cookie = `${VIEW_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
  };
  return <ViewContext value={{ view, setView }}>{children}</ViewContext>;
}

/** Photos in a grid, or compact rows with a small photo (faster for customers who know what they want). */
export function ViewToggle() {
  const tr = useT();
  const { view, setView } = use(ViewContext);
  return (
    <div role="radiogroup" aria-label={tr("Layout")} className="inline-flex h-9 shrink-0 items-center rounded-md bg-white p-0.5 ring-1 ring-leaf-950/15">
      {(
        [
          ["grid", LayoutGrid, "Grid"],
          ["list", List, "List"],
        ] as const
      ).map(([v, Icon, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          aria-label={tr(label)}
          title={tr(label)}
          onClick={() => setView(v)}
          className={cx("grid h-8 w-9 place-items-center rounded transition-colors active:scale-90", view === v ? "bg-leaf-950 text-white" : "text-leaf-900/60 hover:text-leaf-950")}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}

/** The products, as cards in a grid or as rows (ProductCard reads `data-view`). */
export function ProductGrid({ children }: { children: React.ReactNode }) {
  const { view } = use(ViewContext);
  return (
    <div data-view={view} className={cx("group/view mt-4 grid", view === "list" ? "grid-cols-1 gap-2 lg:grid-cols-2" : "grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3")}>
      {children}
    </div>
  );
}

/** Sort order as one compact menu (phones), going to the matching link. */
export function SortSelect({ value, options }: { value: string; options: { value: string; label: string; href: string }[] }) {
  const tr = useT();
  const router = useRouter();
  return (
    <label className="relative inline-flex h-9 w-full min-w-0 items-center rounded-md bg-white ring-1 ring-leaf-950/15">
      <span className="sr-only">{tr("Sort")}</span>
      <select
        value={value}
        onChange={(e) => {
          const o = options.find((x) => x.value === e.target.value);
          if (o) router.push(o.href, { scroll: false });
        }}
        className="h-full w-full min-w-0 appearance-none truncate bg-transparent pr-8 pl-3 text-sm font-medium text-leaf-950 outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {tr(o.label)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-leaf-900/50" />
    </label>
  );
}
