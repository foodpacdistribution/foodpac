"use client";

import { ImageOff, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState, useTransition } from "react";
import { useT } from "@/components/i18n";
import { cx, inputCls, Spinner } from "@/components/ui";

type Candidate = { id: string; name: string; packSize: string; hasImage: boolean };

/**
 * Which products the page shows (on screen only, not printed): the best sellers to start with,
 * or the ones that suit this kind of store. The choice is kept in the address, so a bookmark or
 * a second print gives the same page.
 */
export function ProductPicker({ candidates, shown, max, store }: { candidates: Candidate[]; shown: string[]; max: number; store: string | null }) {
  const tr = useT();
  const router = useRouter();
  const [picked, setPicked] = useState(shown);
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim().toLowerCase());
  const [pending, start] = useTransition();

  const apply = (ids: string[]) => {
    setPicked(ids);
    const params = new URLSearchParams();
    if (store) params.set("store", store);
    if (ids.length) params.set("p", ids.join(","));
    start(() => router.replace(`/admin/leave-behind?${params}`, { scroll: false }));
  };
  const toggle = (id: string) => apply(picked.includes(id) ? picked.filter((x) => x !== id) : picked.length < max ? [...picked, id] : picked);
  const list = candidates.filter((c) => !query || c.name.toLowerCase().includes(query));

  return (
    <details className="rounded-xl bg-white ring-1 ring-leaf-950/10">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-leaf-950">
        <span>{tr("Products on the page ({n} of {max})", { n: picked.length, max })}</span>
        {pending && <Spinner className="text-leaf-700" />}
      </summary>
      <div className="border-t border-leaf-950/10 p-3">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search products")} className={cx(inputCls, "pl-9")} />
        </div>
        <ul className="max-h-72 overflow-y-auto">
          {list.map((c) => {
            const on = picked.includes(c.id);
            return (
              <li key={c.id}>
                <label className={cx("flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-slate-50", !on && picked.length >= max && "opacity-50")}>
                  <input type="checkbox" checked={on} onChange={() => toggle(c.id)} disabled={!on && picked.length >= max} />
                  <span className="min-w-0 flex-1 truncate">
                    {c.name}
                    {c.packSize && <span className="text-slate-400"> · {c.packSize}</span>}
                  </span>
                  {!c.hasImage && <ImageOff className="size-3.5 shrink-0 text-slate-300" aria-label={tr("No photo")} />}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
