"use client";

import { Percent, RotateCcw, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { setCustomerDiscount, setCustomerPrice } from "@/app/actions/products";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { btn, Card, cx, EmptyState, inputCls, Spinner } from "@/components/ui";
import { aud } from "@/lib/money";
import { useT } from "@/components/i18n";

type Row = { id: string; sku: string; name: string; category: string; priceCents: number; unit: string; ownCents: number | null };
type ActionResult = { ok: boolean; message?: string; error?: string };

const toastFor = (r: ActionResult, prefix = ""): ToastMessage => ({
  id: Date.now(),
  text: r.ok ? `${prefix}${r.message ?? "Saved"}` : (r.error ?? "Something went wrong"),
  tone: r.ok ? "ok" : "warn",
});

export function PriceList({ customerId, rows }: { customerId: string; rows: Row[] }) {
  const tr = useT();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [onlySpecial, setOnlySpecial] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [percent, setPercent] = useState("");
  const [pending, start] = useTransition();
  const deferredQ = useDeferredValue(q);

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort(), [rows]);
  const shown = useMemo(() => {
    const s = deferredQ.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!category || r.category === category) &&
        (!onlySpecial || r.ownCents !== null) &&
        (!s || r.name.toLowerCase().includes(s) || r.sku.toLowerCase().includes(s)),
    );
  }, [rows, deferredQ, category, onlySpecial]);
  const ids = shown.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allShown = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const specials = rows.filter((r) => r.ownCents !== null).length;
  const pct = Number(percent);
  const pctOk = Number.isFinite(pct) && pct > 0 && pct < 100;

  const toggle = (id: string) => setSelected((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const run = (value: number | null) =>
    start(async () => {
      const r = await setCustomerDiscount(customerId, ids, value);
      setToast(toastFor(r));
      if (r.ok) {
        setSelected(new Set());
        setPercent("");
      }
    });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search name or SKU")} className={cx(inputCls, "pl-9")} />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={cx(inputCls, "w-auto")} aria-label={tr("Category")}>
          <option value="">{tr("All categories")}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {tr(c)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlySpecial} onChange={(e) => setOnlySpecial(e.target.checked)} />
          {tr("Only special prices")} <span className="text-slate-400">{specials}</span>
        </label>
      </div>

      <div className="sticky top-28 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/95 px-3 py-2 shadow-sm backdrop-blur lg:top-2">
        <label className="flex items-center gap-2 text-xs font-semibold text-blue-900">
          <input type="checkbox" checked={allShown} onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((r) => r.id)) : new Set())} />
          {ids.length ? tr("{n} selected", { n: ids.length }) : tr("Select all")}
        </label>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (ids.length && pctOk) run(pct);
          }}
        >
          <div className="relative w-20">
            <input
              value={percent}
              onChange={(e) => setPercent(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder="10"
              aria-label={tr("Discount percent")}
              className={cx(inputCls, "h-8 max-w-20 pr-6")}
            />
            <span className="pointer-events-none absolute top-1.5 right-2 text-sm text-slate-400">%</span>
          </div>
          <button disabled={pending || !ids.length || !pctOk} className={btn("primary", "sm")}>
            {pending ? <Spinner /> : <Percent className="size-3.5" />} {tr("Discount selected")}
          </button>
        </form>
        <button disabled={pending || !ids.length} onClick={() => run(null)} className={btn("secondary", "sm")}>
          <RotateCcw className="size-3.5" /> {tr("Back to list price")}
        </button>
        {ids.length > 0 && pctOk && (
          <span className="text-xs text-blue-900/70">
            {tr("e.g. {name}: {from} → {to}", {
              name: shown.find((r) => r.id === ids[0])!.name,
              from: aud(shown.find((r) => r.id === ids[0])!.priceCents),
              to: aud(Math.round(shown.find((r) => r.id === ids[0])!.priceCents * (1 - pct / 100))),
            })}
          </span>
        )}
      </div>

      <Card>
        {shown.length === 0 ? (
          <EmptyState icon={Search} title={tr("No products match")}>{tr("Try another search or filter.")}</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            <li className="hidden grid-cols-[2rem_1fr_8rem_14rem] gap-2 bg-slate-50 px-4 py-2.5 text-xs font-medium text-slate-500 sm:grid">
              <span />
              <span>{tr("Product")}</span>
              <span className="text-right">{tr("List price")}</span>
              <span>{tr("Customer price")}</span>
            </li>
            {shown.map((r) => (
              // Keyed by the saved price so a bulk change re-seeds the input.
              <PriceRow key={`${r.id}:${r.ownCents}`} customerId={customerId} row={r} checked={selected.has(r.id)} onToggle={() => toggle(r.id)} onResult={setToast} />
            ))}
          </ul>
        )}
      </Card>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}

function PriceRow({
  customerId,
  row: r,
  checked,
  onToggle,
  onResult,
}: {
  customerId: string;
  row: Row;
  checked: boolean;
  onToggle: () => void;
  onResult: (t: ToastMessage) => void;
}) {
  const tr = useT();
  const initial = r.ownCents !== null ? (r.ownCents / 100).toFixed(2) : "";
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const save = () => {
    if (v === saved) return;
    start(async () => {
      const res = await setCustomerPrice(customerId, r.id, v);
      onResult(toastFor(res, `${r.name}: `));
      if (res.ok) setSaved(v);
    });
  };
  const own = saved ? Math.round(Number(saved) * 100) : null;
  return (
    <li className={cx("grid grid-cols-[2rem_1fr] items-center gap-x-2 gap-y-1.5 px-4 py-2.5 sm:grid-cols-[2rem_1fr_8rem_14rem]", checked && "bg-blue-50/50")}>
      <input type="checkbox" aria-label={`Select ${r.name}`} checked={checked} onChange={onToggle} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{r.name}</p>
        <p className="text-xs text-slate-500">
          {r.sku} · {tr(r.category)}
          <span className="sm:hidden">
            {" "}
            · {aud(r.priceCents)} / {tr(r.unit)}
          </span>
        </p>
      </div>
      <p className="hidden text-right text-sm tabular-nums text-slate-600 sm:block">
        {aud(r.priceCents)} <span className="text-xs text-slate-400">/ {tr(r.unit)}</span>
      </p>
      <div className="col-start-2 flex items-center gap-2 sm:col-start-auto">
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          placeholder={tr("List price")}
          inputMode="decimal"
          aria-label={tr("Customer price")}
          className={cx(inputCls, "h-9 max-w-28")}
        />
        {pending && <Spinner className="text-slate-400" />}
        {own !== null && !pending && (
          <span className={cx("text-xs font-medium", own < r.priceCents ? "text-emerald-700" : "text-slate-500")}>
            {own < r.priceCents ? tr("{pct}% off", { pct: Math.round((1 - own / r.priceCents) * 100) }) : own > r.priceCents ? tr("above list") : ""}
          </span>
        )}
      </div>
    </li>
  );
}
