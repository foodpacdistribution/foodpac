"use client";

import { AlertTriangle, ArrowLeft, Check, FileText, Minus, Plus, Search, Trash2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createOrderForCustomer, type StaffOrderPayload, updateOrderForCustomer } from "@/app/actions/sales";
import { AddressInput } from "@/components/address-input";
import { FormError } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn, Card, CardHeader, cx, Field, inputCls } from "@/components/ui";
import type { PaymentMethod, PaymentTerms } from "@/lib/db/schema";
import { aud, PAYMENT_TERMS_LABEL } from "@/lib/money";
import { defaultDeliveryFee, orderTotals, waitingFor } from "@/lib/order-totals";
import { minutesToInput } from "@/lib/time";

export type FormCustomer = { id: string; code: string; name: string; phone: string | null; email: string | null; address: string | null; paymentTerms: PaymentTerms; approved: boolean };
export type FormProduct = { id: string; sku: string; name: string; packSize: string; unit: string; priceCents: number; gst: boolean; stock: number; minQty: number; active: boolean; waiting: number };

type Line = { key: string; productId: string; qty: string; price: string; priceTouched: boolean };

export type OrderFormProps = {
  mode: "new" | "edit";
  customers: FormCustomer[];
  products: FormProduct[];
  /** customerId → productId → their own price. */
  prices: Record<string, Record<string, number>>;
  /** customerId → store credit they can spend, in cents. */
  credits: Record<string, number>;
  /** New order: start with this customer chosen. */
  initialCustomerId?: string;
  /** New order: replacement goods for this customer return (its credit is used). */
  exchangeReturnId?: string;
  /** New order: made from this accepted quote (its customer, lines, prices and delivery fee). */
  quote?: { id: string; number: string; customerId: string; deliveryFeeCents: number; lines: { productId: string; qty: number; unitPriceCents: number }[] };
  fees: { deliveryFeeCents: number; freeDeliveryOverCents: number };
  today: string;
  idempotencyKey?: string;
  /** Edit: the order as it is now. `reserved` is stock this order already holds, per product. */
  order?: {
    id: string;
    number: string;
    customerId: string;
    deliveryDate: string;
    recipient: string;
    phone: string | null;
    address: string;
    instructions: string | null;
    windowStartMin: number | null;
    windowEndMin: number | null;
    notes: string | null;
    deliveryFeeCents: number;
    lines: { productId: string; qty: number; unitPriceCents: number }[];
    reserved: Record<string, number>;
  };
  defaultDate: string;
};

const dollars = (c: number) => (c / 100).toFixed(2);
const toCents = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
let seq = 0;
const nextKey = () => `l${++seq}`;

export function OrderForm(p: OrderFormProps) {
  const tr = useT();
  const router = useRouter();
  const o = p.order;
  const fromQuote = !o ? p.quote : undefined;
  // Opened for a given customer (an exchange from a customer return, or an accepted quote): start with them chosen.
  const startId = fromQuote?.customerId ?? p.initialCustomerId;
  const start0 = !o && startId ? (p.customers.find((x) => x.id === startId) ?? null) : null;
  const [customerId, setCustomerId] = useState(o?.customerId ?? start0?.id ?? "");
  const customer = p.customers.find((c) => c.id === customerId) ?? null;
  const priceFor = (cid: string, productId: string) => p.prices[cid]?.[productId] ?? p.products.find((x) => x.id === productId)?.priceCents ?? 0;

  const [lines, setLines] = useState<Line[]>(
    () =>
      (o ?? fromQuote)?.lines
        .filter((l) => p.products.some((x) => x.id === l.productId))
        .map((l) => ({ key: nextKey(), productId: l.productId, qty: String(l.qty), price: dollars(l.unitPriceCents), priceTouched: true })) ?? [],
  );
  const [delivery, setDelivery] = useState({
    deliveryDate: o?.deliveryDate ?? p.defaultDate,
    recipient: o?.recipient ?? start0?.name ?? "",
    phone: o?.phone ?? start0?.phone ?? "",
    address: o?.address ?? start0?.address ?? "",
    instructions: o?.instructions ?? "",
    windowStart: minutesToInput(o?.windowStartMin ?? null),
    windowEnd: minutesToInput(o?.windowEndMin ?? null),
    notes: o?.notes ?? (fromQuote ? `From quote ${fromQuote.number}` : ""),
  });
  const [method, setMethod] = useState<PaymentMethod>(start0?.paymentTerms === "prepay" ? "bank_transfer" : "invoice");
  const [fee, setFee] = useState<string | null>(o ? dollars(o.deliveryFeeCents) : fromQuote ? dollars(fromQuote.deliveryFeeCents) : null);
  const [emailCustomer, setEmailCustomer] = useState(true);
  // Store credit towards a new order: on by default for an exchange.
  const [useCredit, setUseCredit] = useState(!!p.exchangeReturnId);
  const [creditInput, setCreditInput] = useState<string | null>(null);
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
  const creditAvailable = p.mode === "new" && customerId ? (p.credits[customerId] ?? 0) : 0;
  const creditMax = Math.min(creditAvailable, totals.totalCents);
  const creditCents = useCredit && creditMax > 0 ? Math.min(creditMax, creditInput === null ? creditMax : (toCents(creditInput) ?? 0)) : 0;
  const waitingLines = parsed.filter((l) => waitingFor(l.q, l.p.stock + (o?.reserved[l.productId] ?? 0)) > 0);

  const pickCustomer = (c: FormCustomer) => {
    setCustomerId(c.id);
    setCreditInput(null);
    setDelivery((d) => ({ ...d, recipient: c.name, phone: c.phone ?? "", address: c.address ?? "" }));
    setMethod(c.paymentTerms === "prepay" ? "bank_transfer" : "invoice");
    setEmailCustomer(!!c.email);
    // Lines not priced by hand follow the new customer's prices.
    setLines((ls) => ls.map((l) => (l.priceTouched ? l : { ...l, price: dollars(priceFor(c.id, l.productId)) })));
  };
  const addProduct = (fp: FormProduct) => {
    setLines((ls) => {
      const have = ls.find((l) => l.productId === fp.id);
      if (have) return ls.map((l) => (l === have ? { ...l, qty: String((Number(l.qty) || 0) + Math.max(1, fp.minQty)) } : l));
      return [...ls, { key: nextKey(), productId: fp.id, qty: String(Math.max(1, fp.minQty)), price: dollars(priceFor(customerId, fp.id)), priceTouched: false }];
    });
  };
  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = () => {
    setError(null);
    if (!customerId) return setError(tr("Choose a customer."));
    if (!parsed.length) return setError(tr("Add at least one product."));
    if (parsed.some((l) => l.cents === null)) return setError(tr("Prices must be $0 or more."));
    const payload: StaffOrderPayload = {
      customerId,
      method,
      ...delivery,
      deliveryFee: dollars(feeCents),
      lines: parsed.map((l) => ({ productId: l.productId, qty: l.q, unitPrice: l.price })),
      emailCustomer: p.mode === "new" && emailCustomer,
      idempotencyKey: p.idempotencyKey ?? "",
      creditCents,
      exchangeReturnId: p.exchangeReturnId,
      quoteId: fromQuote?.id,
    };
    start(async () => {
      if (p.mode === "new") {
        const r = await createOrderForCustomer(payload);
        if (r.ok && r.data) router.push(`/admin/sales/${r.data.id}`);
        else if (!r.ok) setError(r.error);
      } else {
        const r = await updateOrderForCustomer(o!.id, payload);
        if (r.ok) router.push(`/admin/sales/${o!.id}`);
        else setError(r.error);
      }
    });
  };

  const back = o ? `/admin/sales/${o.id}` : "/admin/sales";
  return (
    <>
      <Link href={back} className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> {o ? tr("Order {number}", { number: o.number }) : tr("Sales orders")}
      </Link>
      <h1 className="mb-5 text-xl font-semibold tracking-tight text-slate-900">{o ? tr("Edit order {number}", { number: o.number }) : tr("New order")}</h1>
      {fromQuote && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900 ring-1 ring-blue-200">
          <FileText className="mt-0.5 size-4 shrink-0" />
          {tr("From quote {number}: the quoted products and prices are filled in. Choose the delivery date, check stock, then place the order. The quote is marked accepted.", { number: fromQuote.number })}
        </p>
      )}

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
                    {!customer.approved && <Badge tone="amber" className="mt-1.5">{tr("Not yet approved for the shop")}</Badge>}
                  </div>
                  {p.mode === "new" && !fromQuote && (
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
            <CardHeader title={tr("Products")} subtitle={tr("Out-of-stock products can still be ordered: they wait for stock, and the Products page shows who's waiting.")} />
            <div className="p-4">
              <ProductPicker products={p.products} onPick={addProduct} />
            </div>
            {parsed.length > 0 && (
              <ul className="divide-y divide-line border-t border-line">
                {parsed.map((l) => {
                  const avail = l.p.stock + (o?.reserved[l.productId] ?? 0);
                  const wait = waitingFor(l.q, avail);
                  return (
                    <li key={l.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_8.5rem_6.5rem_5.5rem_2rem]">
                      <div className="col-span-2 min-w-0 sm:col-span-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {l.p.name}
                          {!l.p.active && <Badge className="ml-1.5">{tr("Hidden in shop")}</Badge>}
                        </p>
                        <p className="text-xs text-slate-500">
                          {l.p.sku} · {l.p.packSize || l.p.unit}
                        </p>
                        <p className={cx("mt-0.5 flex items-center gap-1 text-xs", wait ? (avail <= 0 ? "text-red-600" : "text-amber-700") : "text-slate-500")}>
                          {wait > 0 && <AlertTriangle className="size-3 shrink-0" />}
                          {wait === 0
                            ? tr("{n} in stock", { n: avail })
                            : avail <= 0
                              ? tr("Out of stock: all {n} will wait for stock", { n: wait })
                              : tr("{a} in stock: {n} will wait for stock", { a: avail, n: wait })}
                          {l.p.waiting > 0 && <span className="text-slate-400"> · {tr("{n} already waiting", { n: l.p.waiting })}</span>}
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
            <CardHeader title={tr("Delivery")} />
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-3 gap-2">
                <Field label={tr("Delivery date")} className="col-span-3 sm:col-span-1 lg:col-span-3">
                  <input type="date" min={o && o.deliveryDate < p.today ? o.deliveryDate : p.today} value={delivery.deliveryDate} onChange={(e) => setDelivery({ ...delivery, deliveryDate: e.target.value })} className={inputCls} />
                </Field>
                <Field label={tr("From (optional)")} className="col-span-3 sm:col-span-1 lg:col-span-3 xl:col-span-1 2xl:col-span-1">
                  <input type="time" value={delivery.windowStart} onChange={(e) => setDelivery({ ...delivery, windowStart: e.target.value })} className={inputCls} />
                </Field>
                <Field label={tr("Until (optional)")} className="col-span-3 sm:col-span-1 lg:col-span-3 xl:col-span-1">
                  <input type="time" value={delivery.windowEnd} onChange={(e) => setDelivery({ ...delivery, windowEnd: e.target.value })} className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={tr("Receiver")}>
                  <input value={delivery.recipient} onChange={(e) => setDelivery({ ...delivery, recipient: e.target.value })} className={inputCls} />
                </Field>
                <Field label={tr("Phone")}>
                  <input type="tel" value={delivery.phone} onChange={(e) => setDelivery({ ...delivery, phone: e.target.value })} className={inputCls} />
                </Field>
              </div>
              <Field label={tr("Delivery address")}>
                <AddressInput value={delivery.address} onChange={(address) => setDelivery((d) => ({ ...d, address }))} inputClassName={inputCls} />
              </Field>
              <Field label={tr("Delivery instructions (optional)")}>
                <input value={delivery.instructions} onChange={(e) => setDelivery({ ...delivery, instructions: e.target.value })} placeholder={tr("e.g. Back door, before 10am")} className={inputCls} />
              </Field>
              <Field label={tr("Office note (optional)")} hint={tr("Only staff see this.")}>
                <textarea rows={2} value={delivery.notes} onChange={(e) => setDelivery({ ...delivery, notes: e.target.value })} placeholder={tr("e.g. Ordered by phone with Mei")} className={cx(inputCls, "h-auto py-2")} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title={tr("Payment & total")} />
            <div className="space-y-3 p-4">
              {p.mode === "new" && (
                <div className="grid grid-cols-2 gap-2">
                  {(["invoice", "bank_transfer"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      aria-pressed={method === m}
                      className={cx("rounded-lg border px-3 py-2 text-sm", method === m ? "border-blue-500 bg-blue-50 font-medium text-blue-800" : "border-line hover:border-slate-300")}
                    >
                      {tr(m === "invoice" ? "On account (invoice)" : "Bank transfer")}
                    </button>
                  ))}
                </div>
              )}
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
                {creditAvailable > 0 && (
                  <div className="rounded-lg bg-emerald-50 p-2.5 ring-1 ring-emerald-200">
                    <label className="flex items-center justify-between gap-2 text-sm text-emerald-900">
                      <span className="flex items-center gap-2">
                        <input type="checkbox" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} /> {tr("Use store credit")}
                      </span>
                      <span className="text-xs">{tr("{amount} available", { amount: aud(creditAvailable) })}</span>
                    </label>
                    {useCredit && (
                      <div className="mt-2 flex items-center justify-between gap-3 text-sm text-emerald-900">
                        <span>{tr("Credit used")}</span>
                        <span className="relative w-28">
                          <span className="pointer-events-none absolute top-1.5 left-2 text-sm text-slate-400">−$</span>
                          <input inputMode="decimal" aria-label={tr("Credit used")} value={creditInput ?? dollars(creditMax)} onChange={(e) => setCreditInput(e.target.value)} onBlur={() => setCreditInput(dollars(creditCents))} className={cx(inputCls, "h-8 pl-6 text-right tabular-nums")} />
                        </span>
                      </div>
                    )}
                    {useCredit && (
                      <p className="mt-1.5 flex justify-between text-xs text-emerald-800">
                        <span>{tr("Credit left after this order")}</span>
                        <span className="tabular-nums">{aud(creditAvailable - creditCents)}</span>
                      </p>
                    )}
                  </div>
                )}
                {creditCents > 0 && (
                  <div className="flex justify-between text-base font-semibold text-slate-900">
                    <dt>{tr("To pay")}</dt>
                    <dd className="tabular-nums">{aud(totals.totalCents - creditCents)}</dd>
                  </div>
                )}
              </dl>
              {waitingLines.length > 0 && (
                <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {tr("{n} product(s) short. The order is saved with those waiting for stock; goods received go to it first.", { n: waitingLines.length })}
                </p>
              )}
              {p.mode === "new" && customer?.email && (
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={emailCustomer} onChange={(e) => setEmailCustomer(e.target.checked)} /> {tr("Email {email} a confirmation", { email: customer.email })}
                </label>
              )}
              <FormError message={error} />
              <button className={btn("primary", "lg", "w-full")} disabled={pending} onClick={submit}>
                <Check className="size-4" /> {pending ? tr("Saving…") : p.mode === "new" ? tr("Place order") : tr("Save changes")}
              </button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

export function CustomerPicker({ customers, onPick }: { customers: FormCustomer[]; onPick: (c: FormCustomer) => void }) {
  const tr = useT();
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? customers.filter((c) => [c.code, c.name, c.phone, c.email].some((v) => v?.toLowerCase().includes(s))) : customers).slice(0, 8);
  }, [customers, q]);
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search customers by code, name, phone or email")} className={cx(inputCls, "pl-9")} />
      </div>
      <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
        {shown.length === 0 && <li className="px-3 py-2.5 text-sm text-slate-500">{tr("No customers match. Add them on the Customers page first.")}</li>}
        {shown.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onPick(c)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50">
              <UserRound className="size-4 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">
                  {c.name} <span className="font-mono text-xs font-normal text-slate-400">{c.code}</span>
                </span>
                <span className="block truncate text-xs text-slate-500">{[c.phone, c.address].filter(Boolean).join(" · ")}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProductPicker({ products, onPick }: { products: FormProduct[]; onPick: (p: FormProduct) => void }) {
  const tr = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return products.filter((p) => [p.name, p.sku].some((v) => v.toLowerCase().includes(s))).slice(0, 10);
  }, [products, q]);
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && shown[0]) {
            e.preventDefault();
            onPick(shown[0]);
            setQ("");
          }
        }}
        placeholder={tr("Add a product: type its name or SKU")}
        className={cx(inputCls, "pl-9")}
      />
      {open && shown.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-white shadow-lg">
          {shown.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(p);
                  setQ("");
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{p.name}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {p.sku} · {p.packSize || p.unit} · {aud(p.priceCents)}
                  </span>
                </span>
                <span className={cx("shrink-0 text-xs font-medium tabular-nums", p.stock <= 0 ? "text-red-600" : "text-slate-500")}>
                  {p.stock <= 0 ? tr("Out of stock") : tr("{n} in stock", { n: p.stock })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
