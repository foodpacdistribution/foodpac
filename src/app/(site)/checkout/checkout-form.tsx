"use client";

import { Building2, CalendarDays, CreditCard, Landmark, Receipt } from "lucide-react";
import { useState } from "react";
import { checkout } from "@/app/actions/shop";
import { FormError, SubmitButton, KeptForm, useKeptForm } from "@/components/client-ui";
import { cx } from "@/components/ui";
import { prettyDate } from "@/lib/dates";
import type { PaymentMethod, PaymentTerms } from "@/lib/db/schema";
import { aud, PAYMENT_METHOD_LABEL, PAYMENT_TERMS_LABEL } from "@/lib/money";
import { Tx, useT } from "@/components/i18n";
import { AddressInput } from "@/components/address-input";

type Address = { id: string; label: string; recipient: string; phone: string | null; address: string; instructions: string | null };

const input =
  "h-11 w-full rounded-xl border border-leaf-950/15 bg-white px-3.5 text-sm placeholder:text-leaf-900/40 focus:border-leaf-600 focus:ring-2 focus:ring-leaf-600/20 focus:outline-none";
const METHOD_ICON = { card: CreditCard, bank_transfer: Landmark, invoice: Receipt };

export function CheckoutForm(props: {
  idempotencyKey: string;
  lines: { id: string; name: string; sku: string; qty: number; unit: string; lineCents: number }[];
  quote: { subtotalCents: number; deliveryFeeCents: number; gstCents: number; totalCents: number };
  dates: string[];
  methods: PaymentMethod[];
  terms: PaymentTerms;
  creditLeftCents: number | null;
  bankDetails: string;
  addresses: Address[];
  defaults: { recipient: string; phone: string; address: string };
}) {
  const tr = useT();
  const [state, form] = useKeptForm(checkout);
  const [addr, setAddr] = useState<Address | null>(props.addresses[0] ?? null);
  const [method, setMethod] = useState<PaymentMethod>(props.methods[0]);
  const fill = addr ?? { recipient: props.defaults.recipient, phone: props.defaults.phone, address: props.defaults.address, instructions: "" };


  const overCredit = method === "invoice" && props.creditLeftCents !== null && props.quote.totalCents > props.creditLeftCents;

  return (
    <KeptForm form={form} className="mt-5 grid gap-6 lg:grid-cols-[1fr_360px]">
      <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
      <div className="space-y-4">
        <Step n={1} title={tr("Delivery address")} icon={Building2}>
          {props.addresses.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {props.addresses.map((a) => (
                <button key={a.id} type="button" onClick={() => setAddr(a)} className={chip(addr?.id === a.id)}>
                  {a.label || a.address.split(",")[0]}
                </button>
              ))}
              <button type="button" onClick={() => setAddr(null)} className={chip(addr === null)}>
                {tr("New address")}</button>
            </div>
          )}
          {/* key re-mounts the fields with the chosen address's values */}
          <div key={addr?.id ?? "new"} className="grid gap-3 sm:grid-cols-2">
            <Label text={tr("Receiver")}>
              <input name="recipient" required defaultValue={fill.recipient} className={input} />
            </Label>
            <Label text={tr("Phone")}>
              <input name="phone" type="tel" defaultValue={fill.phone ?? ""} className={input} />
            </Label>
            <Label text={tr("Delivery address")} className="sm:col-span-2">
              <AddressInput name="address" required defaultValue={fill.address} placeholder={tr("Street, suburb, state, postcode")} inputClassName={input} />
            </Label>
            <Label text={tr("Delivery instructions (optional)")} className="sm:col-span-2">
              <input name="instructions" defaultValue={fill.instructions ?? ""} placeholder={tr("e.g. Rear loading dock, ring the bell")} className={input} />
            </Label>
            {!addr && (
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="saveAddress" className="size-4 accent-leaf-700" /> {" "}{tr("Save this address")}</label>
                <input name="addressLabel" placeholder={tr("Label, e.g. Main store")} className={cx(input, "h-9 max-w-52")} />
              </div>
            )}
          </div>
        </Step>

        <Step n={2} title={tr("Delivery day")} icon={CalendarDays}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {props.dates.map((d, i) => (
              <label key={d} className="cursor-pointer">
                <input type="radio" name="deliveryDate" value={d} defaultChecked={i === 0} className="peer sr-only" />
                <span className="block rounded-xl border border-leaf-950/15 bg-white px-3 py-2.5 text-center text-sm peer-checked:border-leaf-700 peer-checked:bg-leaf-50 peer-checked:font-semibold peer-focus-visible:ring-2 peer-focus-visible:ring-leaf-600">
                  {<Tx>{prettyDate(d, { weekday: "short", day: "numeric", month: "short" })}</Tx>}
                </span>
              </label>
            ))}
          </div>
          <div className="mt-4 grid max-w-sm grid-cols-2 gap-3">
            <Label text={tr("Receive from (optional)")}>
              <input name="windowStart" type="time" className={input} />
            </Label>
            <Label text={tr("Until (optional)")}>
              <input name="windowEnd" type="time" className={input} />
            </Label>
          </div>
          <p className="mt-2 text-xs text-leaf-900/55">{tr("We plan our run around your window. Leave it blank if any time suits.")}</p>
        </Step>

        <Step n={3} title={tr("Payment")} icon={CreditCard}>
          <div className="space-y-2">
            {props.methods.map((m) => {
              const Icon = METHOD_ICON[m];
              return (
                <label key={m} className={cx("flex cursor-pointer items-center gap-3 rounded-xl border bg-white px-4 py-3", method === m ? "border-leaf-700 bg-leaf-50" : "border-leaf-950/15")}>
                  <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="accent-leaf-700" />
                  <Icon className="size-4 text-leaf-700" />
                  <span className="flex-1 text-sm">
                    <span className="font-semibold">{PAYMENT_METHOD_LABEL[m]}</span>
                    <span className="block text-xs text-leaf-900/60">
                      {m === "card"
                        ? tr("Pay securely with Stripe. Your order is confirmed once payment goes through.")
                        : m === "bank_transfer"
                          ? tr("Confirmed now; please pay by bank transfer using your order number.")
                          : `${PAYMENT_TERMS_LABEL[props.terms]} from delivery.${props.creditLeftCents !== null ? ` Credit available ${aud(Math.max(0, props.creditLeftCents))}.` : ""}`}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {method === "bank_transfer" && props.bankDetails && <p className="mt-3 rounded-xl bg-[#f5f1e8] p-3 text-xs whitespace-pre-wrap">{props.bankDetails}</p>}
          {overCredit && <p className="mt-3 text-sm text-red-700">{tr("This order is over your available credit. Choose another payment method.")}</p>}
        </Step>

        <Step n={4} title={tr("Order notes")} icon={Receipt}>
          <textarea name="notes" rows={2} placeholder={tr("Anything we should know (optional)")} className={cx(input, "h-auto py-3")} />
        </Step>
      </div>

      <aside className="h-fit rounded-3xl border border-leaf-950/10 bg-white p-5 lg:sticky lg:top-36">
        <h2 className="font-semibold">{tr("Order summary")}</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {props.lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate">{l.name}</span>
                <span className="text-xs text-leaf-900/50">
                  {l.qty} × {l.unit}
                </span>
              </span>
              <span className="tabular-nums">{aud(l.lineCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1.5 border-t border-leaf-950/10 pt-3 text-sm text-leaf-900/75">
          <div className="flex justify-between">
            <dt>{tr("Subtotal (ex GST)")}</dt>
            <dd className="tabular-nums">{aud(props.quote.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{tr("Delivery")}</dt>
            <dd className="tabular-nums">{props.quote.deliveryFeeCents ? aud(props.quote.deliveryFeeCents) : tr("Free")}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{tr("GST")}</dt>
            <dd className="tabular-nums">{aud(props.quote.gstCents)}</dd>
          </div>
          <div className="flex justify-between border-t border-leaf-950/10 pt-2 font-display text-lg font-semibold text-leaf-950">
            <dt>{tr("Total")}</dt>
            <dd className="tabular-nums">{aud(props.quote.totalCents)}</dd>
          </div>
        </dl>
        <div className="mt-4">
          <FormError message={state && !state.ok ? state.error : null} />
        </div>
        <SubmitButton size="lg" disabled={overCredit} pendingText={tr("Placing order…")} className="mt-3 w-full rounded-full bg-tomato hover:bg-tomato-dark">
          {method === "card" ? tr("Continue to payment") : tr("Place order")}
        </SubmitButton>
        <p className="mt-2 text-center text-[11px] text-leaf-900/50">{tr("Prices, stock and totals are checked again when you place the order.")}</p>
      </aside>
    </KeptForm>
  );
}

const chip = (on: boolean) => cx("rounded-full border px-3.5 py-1.5 text-sm", on ? "border-leaf-700 bg-leaf-50 font-semibold" : "border-leaf-950/15 bg-white");

function Step({ n, title, icon: Icon, children }: { n: number; title: string; icon: typeof Building2; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-leaf-950/10 bg-white p-5">
      <h2 className="mb-4 flex items-center gap-2.5 font-semibold">
        <span className="grid size-7 place-items-center rounded-full bg-leaf-700 text-xs text-white">{n}</span>
        {<Tx>{title}</Tx>}
        <Icon className="ml-auto size-4 text-leaf-900/35" />
      </h2>
      {children}
    </section>
  );
}

function Label({ text, children, className }: { text: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-xs font-semibold text-leaf-900/75">{<Tx>{text}</Tx>}</span>
      {children}
    </label>
  );
}
