"use client";

import { ArrowLeft, Check, Minus, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type QuotePayload, saveQuote } from "@/app/actions/quotes";
import { CustomerPicker, type FormCustomer, type FormProduct, ProductPicker } from "@/app/admin/sales/order-form";
import { FormError } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn, Card, CardHeader, cx, Field, inputCls } from "@/components/ui";
import { aud, PAYMENT_TERMS_LABEL } from "@/lib/money";
import { defaultDeliveryFee, orderTotals } from "@/lib/order-totals";

type Line = { key: string; productId: string; qty: string; price: string; priceTouched: boolean };

export type QuoteFormProps = {
  customers: FormCustomer[];
  products: FormProduct[];
  /** customerId → productId → their own price. */
  prices: Record<string, Record<string, number>>;
  fees: { deliveryFeeCents: number; freeDeliveryOverCents: number };
  today: string;
  defaultValidUntil: string;
  initialCustomerId?: string;
  /** Edit: the quote as it is now. */
  quote?: {
    id: string;
    number: string;
    customerId: string;
    validUntil: string;
    deliveryFeeCents: number;
    notes: string | null;
    internalNote: string | null;
    lines: { productId: string; qty: number; unitPriceCents: number }[];
  };
};

const dollars = (c: number) => (c / 100).toFixed(2);
const toCents = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
let seq = 0;
const nextKey = () => `q${++seq}`;

/** New quote or changes to one: customer, products with the prices offered, valid until, notes. */
export function QuoteForm(p: QuoteFormProps) {
  const tr = useT();
  const router = useRouter();
  const q = p.quote;
  const [customerId, setCustomerId] = useState(q?.customerId ?? (p.customers.some((c) => c.id === p.initialCustomerId) ? p.initialCustomerId! : ""));
  const customer = p.customers.find((c) => c.id === customerId) ?? null;
  const priceFor = (cid: string, productId: string) => p.prices[cid]?.[productId] ?? p.products.find((x) => x.id === productId)?.priceCents ?? 0;
  const [lines, setLines] = useState<Line[]>(
    () => q?.lines.filter((l) => p.products.some((x) => x.id === l.productId)).map((l) => ({ key: nextKey(), productId: l.productId, qty: String(l.qty), price: dollars(l.unitPriceCents), priceTouched: true })) ?? [],
  );
  const [validUntil, setValidUntil] = useState(q?.validUntil ?? p.defaultValidUntil);
  const [fee, setFee] = useState<string | null>(q ? dollars(q.deliveryFeeCents) : null);
  const [notes, setNotes] = useState(q?.notes ?? "");
  const [internalNote, setInternalNote] = useState(q?.internalNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const product = (id: string) => p.products.find((x) => x.id === id)!;
  const parsed = lines.map((l) => ({ ...l, p: product(l.productId), q: Math.max(0, Math.round(Number(l.qty) || 0)), cents: toCents(l.price) }));
  const subtotal = parsed.reduce((t, l) => t + l.q * (l.cents ?? 0), 0);
  const autoFee = defaultDeliveryFee(subtotal, p.fees);
  const feeCents = fee === null ? autoFee : (toCents(fee) ?? 0);
  const totals = orderTotals(
    parsed.map((l) => ({ qty: l.q, unitPriceCents: l.cents ?? 0, gst: l.p.gst })),
    feeCents,
  );

  const pickCustomer = (c: FormCustomer) => {
    setCustomerId(c.id);
    // Lines not priced by hand follow the customer's own prices.
    setLines((ls) => ls.map((l) => (l.priceTouched ? l : { ...l, price: dollars(priceFor(c.id, l.productId)) })));
  };
  const addProduct = (fp: FormProduct) =>
    setLines((ls) => {
      const have = ls.find((l) => l.productId === fp.id);
      if (have) return ls.map((l) => (l === have ? { ...l, qty: String((Number(l.qty) || 0) + Math.max(1, fp.minQty)) } : l));
      return [...ls, { key: nextKey(), productId: fp.id, qty: String(Math.max(1, fp.minQty)), price: dollars(priceFor(customerId, fp.id)), priceTouched: false }];
    });
  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = () => {
    setError(null);
    if (!customerId) return setError(tr("Choose a customer."));
    if (!parsed.length) return setError(tr("Add at least one product."));
    if (parsed.some((l) => l.cents === null)) return setError(tr("Prices must be $0 or more."));
    const payload: QuotePayload = {
      customerId,
      validUntil,
      deliveryFee: dollars(feeCents),
      notes,
      internalNote,
      lines: parsed.map((l) => ({ productId: l.productId, qty: l.q, unitPrice: l.price })),
    };
    start(async () => {
      const r = await saveQuote(q?.id ?? null, payload);
      if (r.ok && r.data) router.push(`/admin/quotes/${r.data.id}`);
      else if (!r.ok) setError(r.error);
    });
  };

  return (
    <>
      <Link href={q ? `/admin/quotes/${q.id}` : "/admin/quotes"} className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> {q ? tr("Quote {number}", { number: q.number }) : tr("Quotations")}
      </Link>
      <h1 className="mb-5 text-xl font-semibold tracking-tight text-slate-900">{q ? tr("Edit quote {number}", { number: q.number }) : tr("New quote")}</h1>

      <div className="grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={tr("Customer")} />
            <div className="p-4">
              {customer ? (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">
                      {customer.name} <span className="font-mono text-xs font-normal text-slate-500">{customer.code}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {[customer.phone, customer.email].filter(Boolean).join(" · ") || tr("No contact details")} · {tr(PAYMENT_TERMS_LABEL[customer.paymentTerms])}
                    </p>
                    {!customer.email && <Badge tone="amber" className="mt-1.5">{tr("No email: print the quote or add an email to send it")}</Badge>}
                  </div>
                  {!q && (
                    <button className={btn("ghost", "sm")} onClick={() => setCustomerId("")}>
                      {tr("Change")}
                    </button>
                  )}
                </div>
              ) : (
                <CustomerPicker customers={p.customers} onPick={pickCustomer} />
              )}
            </div>
          </Card>

          <Card className="overflow-visible">
            <CardHeader title={tr("Products")} subtitle={tr("Prices start at the customer's own price (or the list price). Change any price to what you're offering.")} />
            <div className="p-4">
              <ProductPicker products={p.products} onPick={addProduct} />
            </div>
            {parsed.length > 0 && (
              <ul className="divide-y divide-line border-t border-line">
                {parsed.map((l) => {
                  const list = priceFor(customerId, l.productId);
                  return (
                    <li key={l.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_8.5rem_6.5rem_5.5rem_2rem]">
                      <div className="col-span-2 min-w-0 sm:col-span-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {l.p.name}
                          {!l.p.active && <Badge className="ml-1.5">{tr("Hidden in shop")}</Badge>}
                        </p>
                        <p className="text-xs text-slate-500">
                          {l.p.sku} · {l.p.packSize || l.p.unit} · {l.p.stock > 0 ? tr("{n} in stock", { n: l.p.stock }) : tr("Out of stock")}
                          {l.cents !== null && l.cents !== list && <span className="text-slate-400"> · {tr("usually {price}", { price: aud(list) })}</span>}
                        </p>
                      </div>
                      <div className="flex h-9 items-center rounded-lg border border-line bg-white">
                        <button type="button" aria-label={tr("Less")} className="grid size-8 place-items-center text-slate-500" onClick={() => setLine(l.key, { qty: String(Math.max(1, l.q - 1)) })}>
                          <Minus className="size-3.5" />
                        </button>
                        <input
                          aria-label={tr("Quantity")}
                          inputMode="numeric"
                          value={l.qty}
                          onChange={(e) => setLine(l.key, { qty: e.target.value.replace(/\D/g, "") })}
                          className="w-full min-w-0 bg-transparent text-center text-sm font-semibold tabular-nums outline-none"
                        />
                        <button type="button" aria-label={tr("More")} className="grid size-8 place-items-center text-slate-500" onClick={() => setLine(l.key, { qty: String(l.q + 1) })}>
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                      <label className="relative">
                        <span className="sr-only">{tr("Unit price")}</span>
                        <span className="pointer-events-none absolute top-2 left-2.5 text-sm text-slate-400">$</span>
                        <input
                          inputMode="decimal"
                          value={l.price}
                          onChange={(e) => setLine(l.key, { price: e.target.value, priceTouched: true })}
                          className={cx(inputCls, "pl-6 text-right tabular-nums", l.cents === null && "border-red-400")}
                        />
                      </label>
                      <p className="text-right text-sm font-medium tabular-nums text-slate-900 max-sm:col-start-1 max-sm:text-left">{aud(l.q * (l.cents ?? 0))}</p>
                      <button type="button" aria-label={tr("Remove")} className={btn("ghost", "icon", "text-slate-400 hover:text-red-600")} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-4">
          <Card>
            <CardHeader title={tr("Quote details")} />
            <div className="space-y-3 p-4">
              <Field label={tr("Valid until")}>
                <input type="date" min={q && q.validUntil < p.today ? q.validUntil : p.today} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputCls} />
              </Field>
              <Field label={tr("Notes on the quote (optional)")} hint={tr("Printed on the quote and in the email: terms, lead times, minimums.")}>
                <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tr("e.g. Prices held for orders placed by the valid-until date. Delivery Mon–Fri.")} className={cx(inputCls, "h-auto py-2")} />
              </Field>
              <Field label={tr("Office note (optional)")} hint={tr("Only staff see this.")}>
                <textarea rows={2} value={internalNote} onChange={(e) => setInternalNote(e.target.value)} className={cx(inputCls, "h-auto py-2")} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title={tr("Total")} />
            <div className="space-y-3 p-4">
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between text-slate-600">
                  <dt>{tr("Subtotal")}</dt>
                  <dd className="tabular-nums">{aud(totals.subtotalCents)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 text-slate-600">
                  <dt>
                    {tr("Delivery")}
                    {fee !== null && (
                      <button type="button" className="ml-2 text-xs text-blue-600 hover:underline" onClick={() => setFee(null)}>
                        {tr("Use the shop's fee")}
                      </button>
                    )}
                  </dt>
                  <dd className="relative w-24">
                    <span className="pointer-events-none absolute top-1.5 left-2 text-sm text-slate-400">$</span>
                    <input inputMode="decimal" aria-label={tr("Delivery fee")} value={fee ?? dollars(autoFee)} onChange={(e) => setFee(e.target.value)} className={cx(inputCls, "h-8 pl-5 text-right tabular-nums")} />
                  </dd>
                </div>
                <div className="flex justify-between text-slate-600">
                  <dt>{tr("GST")}</dt>
                  <dd className="tabular-nums">{aud(totals.gstCents)}</dd>
                </div>
                <div className="flex justify-between border-t border-line pt-2 text-base font-semibold text-slate-900">
                  <dt>{tr("Total")}</dt>
                  <dd className="tabular-nums">{aud(totals.totalCents)}</dd>
                </div>
              </dl>
              <p className="text-xs text-slate-500">{tr("Nothing is reserved or delivered until the quote becomes a sales order.")}</p>
              <FormError message={error} />
              <button className={btn("primary", "lg", "w-full")} disabled={pending} onClick={submit}>
                <Check className="size-4" /> {pending ? tr("Saving…") : q ? tr("Save changes") : tr("Save quote")}
              </button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
