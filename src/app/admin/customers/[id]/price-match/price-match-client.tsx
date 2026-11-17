"use client";

import { Check, CircleAlert, CircleCheck, Scale, Search, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { decidePriceMatch, savePriceMatch, withdrawPriceMatch } from "@/app/actions/price-match";
import { FormError, Toast, type ToastMessage } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import { Badge, btn, Card, CardHeader, cx, EmptyState, Field, inputCls, Spinner } from "@/components/ui";
import { aud, GST_RATE } from "@/lib/money";
import type { MatchProduct } from "@/lib/price-match";
import { marginPctOf, needsApproval, savings, suggestedPrice } from "@/lib/price-match-rules";

export type MatchView = {
  id: string;
  productId: string;
  name: string;
  sku: string;
  unit: string;
  packSize: string;
  competitorCents: number;
  competitor: string | null;
  priceCents: number;
  listCents: number;
  /** Office only. */
  costCents: number | null;
  monthlyQty: number | null;
  note: string | null;
  status: "approved" | "pending" | "rejected";
  /** Asked for by the person looking. */
  mine: boolean;
  by: string | null;
  when: string;
  /** On the office's list of matches waiting: whose. */
  customer?: { id: string; name: string; code: string };
};

const toCents = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const dollars = (c: number) => (c / 100).toFixed(2);

export function PriceMatchClient(p: {
  customerId: string;
  office: boolean;
  meId: string;
  beatPct: number;
  minMarginPct: number;
  products: MatchProduct[];
  matches: MatchView[];
}) {
  const tr = useT();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [product, setProduct] = useState<MatchProduct | null>(null);
  const [theirs, setTheirs] = useState("");
  const [incGst, setIncGst] = useState(false);
  const [competitor, setCompetitor] = useState("");
  const [price, setPrice] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [monthly, setMonthly] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  // What they pay, ex GST like all our prices.
  const typed = toCents(theirs);
  const theirCents = typed !== null && incGst && product?.gst ? Math.round(typed / (1 + GST_RATE)) : typed;
  const suggestion = product && theirCents ? suggestedPrice(theirCents, product.listCents, p.beatPct) : null;
  const shownPrice = priceTouched ? price : suggestion !== null ? dollars(suggestion) : "";
  const offerCents = toCents(shownPrice);
  const waits = product && offerCents ? needsApproval({ office: p.office, priceCents: offerCents, listCents: product.listCents, floorCents: product.floorCents }) : false;
  const save = theirCents && offerCents ? savings(theirCents, offerCents, Number(monthly) > 0 ? Math.round(Number(monthly)) : null) : null;
  const margin = product && offerCents && product.costCents !== null ? marginPctOf(offerCents, product.costCents) : null;

  const pick = (x: MatchProduct) => {
    setProduct(x);
    setPrice("");
    setPriceTouched(false);
    setError(null);
  };
  const reset = () => {
    setProduct(null);
    setTheirs("");
    setPrice("");
    setPriceTouched(false);
    setMonthly("");
    setNote("");
    setError(null);
    // The supplier and "inc GST" usually stay the same for the next product.
    queueMicrotask(() => searchRef.current?.focus());
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return setError("Choose a product.");
    if (!theirCents) return setError("Enter what they pay now, e.g. 21.50.");
    start(async () => {
      const r = await savePriceMatch({
        customerId: p.customerId,
        productId: product.id,
        competitorPrice: dollars(theirCents),
        competitor,
        price: shownPrice,
        monthlyQty: monthly,
        note,
      });
      if (!r.ok) return setError(r.error);
      setToast({ id: Date.now(), text: r.message ?? "Saved", tone: r.data?.pending ? "warn" : "ok" });
      reset();
    });
  };

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <Card className="xl:sticky xl:top-4">
        <CardHeader title={<span className="flex items-center gap-2"><Scale className="size-4 text-blue-600" /> {tr("New price match")}</span>} />
        <form onSubmit={submit} className="space-y-4 p-4">
          {product ? (
            <div className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
              <div className="min-w-0 text-sm">
                <p className="font-medium text-slate-900">{product.name}</p>
                <p className="text-xs text-slate-500">{[product.sku, product.packSize].filter(Boolean).join(" · ")}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {tr("List {price}", { price: aud(product.listCents) })}
                  {product.ownCents !== null && <> · {tr("their price now {price}", { price: aud(product.ownCents) })}</>}
                  {p.office && product.costCents !== null && <> · {tr("cost {price}", { price: aud(product.costCents) })}</>}
                </p>
              </div>
              <button type="button" onClick={reset} className={btn("ghost", "icon-sm")} aria-label={tr("Choose another product")}>
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <ProductSearch products={p.products} onPick={pick} inputRef={searchRef} />
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={product ? tr("They pay now, per {unit}", { unit: tr(product.unit) }) : "They pay now"}>
              <Money value={theirs} onChange={setTheirs} placeholder="21.50" />
            </Field>
            <Field label="Their supplier" hint="Optional">
              <input value={competitor} onChange={(e) => setCompetitor(e.target.value)} maxLength={120} className={inputCls} />
            </Field>
          </div>
          {(!product || product.gst) && (
            <label className="-mt-2 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={incGst} onChange={(e) => setIncGst(e.target.checked)} />
              {tr("Their price includes GST")}
              {incGst && typed !== null && theirCents !== null && <span className="text-slate-400">{tr("= {price} ex GST", { price: aud(theirCents) })}</span>}
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Our price (ex GST)"
              hint={
                suggestion === null || priceTouched
                  ? undefined
                  : product && suggestion >= product.listCents && product.listCents < (theirCents ?? 0)
                    ? tr("Our list price is already cheaper")
                    : p.beatPct > 0
                      ? tr("{pct}% under theirs", { pct: p.beatPct })
                      : tr("Matches theirs")
              }
            >
              <Money
                value={shownPrice}
                onChange={(v) => {
                  setPrice(v);
                  setPriceTouched(true);
                }}
                placeholder={product ? dollars(product.listCents) : "20.90"}
              />
            </Field>
            <Field label="Used a month" hint="Optional, for the savings">
              <input value={monthly} onChange={(e) => setMonthly(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="20" className={inputCls} />
            </Field>
          </div>

          {product && theirCents && offerCents ? (
            <Preview
              save={save!}
              waits={waits}
              office={p.office}
              floor={product.floorCents}
              noCost={product.floorCents === null && product.costCents === null}
              margin={margin}
              minMargin={p.minMarginPct}
              atList={offerCents >= product.listCents}
            />
          ) : null}

          <Field label="Note" hint="Optional: anything the office should know.">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={inputCls} />
          </Field>

          <FormError message={error} />
          <button disabled={pending || !product || !theirCents || !offerCents} className={btn(waits ? "secondary" : "primary", "lg", "w-full")}>
            {pending ? <Spinner /> : waits ? <CircleAlert className="size-4 text-amber-600" /> : <Check className="size-4" />}
            {waits ? tr("Send to the office to approve") : tr("Give them this price")}
          </button>
        </form>
      </Card>

      <MatchList matches={p.matches} office={p.office} onToast={setToast} title="Price matches" summary />
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function Money({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-2 left-3 text-sm text-slate-400">$</span>
      <input value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder={placeholder} className={cx(inputCls, "h-11 pl-6 text-base tabular-nums")} />
    </div>
  );
}

function Preview(o: {
  save: ReturnType<typeof savings>;
  waits: boolean;
  office: boolean;
  floor: number | null;
  noCost: boolean;
  margin: number | null;
  minMargin: number;
  atList: boolean;
}) {
  const tr = useT();
  const cheaper = o.save.perUnitCents > 0;
  return (
    <div className="space-y-2 rounded-lg border border-line p-3 text-sm">
      {cheaper ? (
        <p className="font-medium text-emerald-700">
          {tr("They save {amount} each ({pct}%)", { amount: aud(o.save.perUnitCents), pct: o.save.pct })}
          {o.save.monthlyCents !== null && <span className="block text-base">{tr("{amount} a month", { amount: aud(o.save.monthlyCents) })}</span>}
        </p>
      ) : o.save.perUnitCents === 0 ? (
        <p className="font-medium text-slate-700">{tr("Same price as they pay now.")}</p>
      ) : (
        <p className="font-medium text-amber-700">{tr("Dearer than what they pay now.")}</p>
      )}
      {o.margin !== null && (
        <p className={cx("text-xs", o.margin < o.minMargin ? "text-red-600" : "text-slate-500")}>{tr("Margin {pct}%", { pct: o.margin })}</p>
      )}
      {o.waits ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-800">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          {o.noCost
            ? tr("We don't know what this product costs us, so the office approves prices under list.")
            : tr("Below the lowest price you can give on your own ({price}). The office approves it first.", { price: aud(o.floor) })}
        </p>
      ) : (
        <p className="flex items-start gap-1.5 text-xs text-emerald-700">
          <CircleCheck className="mt-px size-3.5 shrink-0" />
          {o.atList ? tr("Our list price: nothing to approve.") : tr("Their price straight away.")}
        </p>
      )}
    </div>
  );
}

function ProductSearch({ products, onPick, inputRef }: { products: MatchProduct[]; onPick: (p: MatchProduct) => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const tr = useT();
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return products.filter((p) => words.every((w) => p.name.toLowerCase().includes(w) || p.sku.toLowerCase().includes(w))).slice(0, 8);
  }, [products, q]);
  return (
    <div>
      <Field label="Product">
        <div className="relative">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-slate-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shown[0]) {
                e.preventDefault();
                onPick(shown[0]);
              }
            }}
            placeholder={tr("Search name or SKU")}
            autoComplete="off"
            className={cx(inputCls, "h-11 pl-9 text-base")}
          />
        </div>
      </Field>
      {shown.length > 0 && (
        <ul className="mt-1.5 divide-y divide-line overflow-hidden rounded-lg border border-line">
          {shown.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onPick(p)} className="flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{p.name}</span>
                  <span className="block text-xs text-slate-500">{[p.sku, p.packSize].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-600 tabular-nums">
                  {aud(p.ownCents ?? p.listCents)} / {tr(p.unit)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim() && !shown.length && <p className="mt-1.5 text-xs text-slate-500">{tr("No product matches “{q}”.", { q: q.trim() })}</p>}
    </div>
  );
}

const STATUS = {
  approved: { label: "Their price", tone: "green" },
  pending: { label: "Waiting for the office", tone: "amber" },
  rejected: { label: "Turned down", tone: "red" },
} as const;

/** Price matches with their savings; the office approves or turns down the ones waiting. */
export function MatchList({
  matches,
  office,
  onToast,
  title,
  summary = false,
}: {
  matches: MatchView[];
  office: boolean;
  onToast: (t: ToastMessage) => void;
  title: string;
  /** Show what the store saves a month at our prices (one customer's matches). */
  summary?: boolean;
}) {
  const tr = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const run = (id: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    setBusy(id);
    start(async () => {
      const r = await fn();
      setBusy(null);
      onToast({ id: Date.now(), text: r.ok ? (r.message ?? "Saved") : (r.error ?? "Something went wrong"), tone: r.ok ? "ok" : "warn" });
    });
  };
  const approved = matches.filter((m) => m.status === "approved");
  // The latest approved match per product counts towards the monthly saving.
  const seen = new Set<string>();
  const monthly = approved.reduce((t, m) => {
    if (seen.has(m.productId) || !m.monthlyQty) return t;
    seen.add(m.productId);
    return t + Math.max(0, m.competitorCents - m.priceCents) * m.monthlyQty;
  }, 0);

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={
          summary && monthly > 0
            ? tr("{n} products at our price · they save about {amount} a month", { n: seen.size, amount: aud(monthly) })
            : undefined
        }
      />
      {!matches.length ? (
        <EmptyState icon={Scale} title={summary ? "No price matches yet" : "Nothing waiting"}>
          {summary ? "Find a product they buy, type what they pay now, and offer your price." : undefined}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {matches.map((m) => {
            const s = savings(m.competitorCents, m.priceCents, m.monthlyQty);
            const margin = m.costCents !== null ? marginPctOf(m.priceCents, m.costCents) : null;
            return (
              <li key={m.id} className={cx("px-4 py-3", m.status === "rejected" && "opacity-60")}>
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    {m.customer && (
                      <a href={`/admin/customers/${m.customer.id}/price-match`} className="text-xs font-semibold text-blue-700 hover:underline">
                        {m.customer.name} <span className="font-normal text-slate-400">{m.customer.code}</span>
                      </a>
                    )}
                    <p className="font-medium text-slate-900">{m.name}</p>
                    <p className="text-xs text-slate-500">{[m.sku, m.packSize].filter(Boolean).join(" · ")}</p>
                  </div>
                  <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm tabular-nums">
                  <span className="text-slate-500">
                    {tr("They pay {price}", { price: aud(m.competitorCents) })}
                    {m.competitor && <> ({m.competitor})</>}
                  </span>
                  <span className="font-semibold text-slate-900">{tr("Ours {price}", { price: aud(m.priceCents) })}</span>
                  {s.perUnitCents > 0 && <span className="text-emerald-700">−{s.pct}%</span>}
                  {s.monthlyCents !== null && s.monthlyCents > 0 && <span className="text-emerald-700">{tr("{amount} a month", { amount: aud(s.monthlyCents) })}</span>}
                  <span className="text-xs text-slate-500">{tr("List {price}", { price: aud(m.listCents) })}</span>
                  {office && margin !== null && <span className={cx("text-xs", margin < 0 ? "font-medium text-red-600" : "text-slate-500")}>{tr("Margin {pct}%", { pct: margin })}</span>}
                  {office && m.costCents === null && <span className="text-xs text-slate-400">{tr("Cost not known")}</span>}
                </div>
                {m.note && <p className="mt-1 text-xs text-slate-600 italic">{m.note}</p>}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-400">{[m.by, m.when].filter(Boolean).join(" · ")}</p>
                  {m.status === "pending" && (
                    <div className="flex gap-2">
                      {m.mine && !office && (
                        <button disabled={busy === m.id} onClick={() => run(m.id, () => withdrawPriceMatch(m.id))} className={btn("ghost", "sm")}>
                          <Trash2 className="size-3.5" /> {tr("Withdraw")}
                        </button>
                      )}
                      {office && (
                        <>
                          <button disabled={busy === m.id} onClick={() => run(m.id, () => decidePriceMatch(m.id, false))} className={btn("danger", "sm")}>
                            <X className="size-3.5" /> {tr("Turn down")}
                          </button>
                          <button disabled={busy === m.id} onClick={() => run(m.id, () => decidePriceMatch(m.id, true))} className={btn("success", "sm")}>
                            {busy === m.id ? <Spinner /> : <Check className="size-3.5" />} {tr("Approve")}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
