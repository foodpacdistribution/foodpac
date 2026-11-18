"use client";

import { Check, Coins, CreditCard, Landmark, MapPin, Pencil, Receipt } from "lucide-react";
import { useState } from "react";
import { checkout } from "@/app/actions/shop";
import { FormError, KeptForm, SubmitButton, useKeptForm } from "@/components/client-ui";
import { AddressInput } from "@/components/address-input";
import { Tx, useT } from "@/components/i18n";
import { cx } from "@/components/ui";
import type { PaymentMethod, PaymentTerms } from "@/lib/db/schema";
import { aud, PAYMENT_METHOD_LABEL, PAYMENT_TERMS_LABEL } from "@/lib/money";
import { LegalConsent } from "../legal-consent";
import { ProductImage } from "../shop-ui";

type Address = { id: string; label: string; recipient: string; phone: string | null; address: string; instructions: string | null };

const input =
  "h-12 w-full rounded-lg border border-leaf-950/15 bg-white px-4 text-[15px] transition-[border-color,box-shadow] placeholder:text-leaf-900/35 focus:border-leaf-700 focus:ring-4 focus:ring-leaf-700/10 focus:outline-none";
const METHOD_ICON = { card: CreditCard, bank_transfer: Landmark, invoice: Receipt };

export function CheckoutForm(props: {
  idempotencyKey: string;
  /** `units`: what a carton line comes to in packs ("16 packet"). */
  lines: {
    id: string;
    name: string;
    sku: string;
    qty: number;
    unit: string;
    units: string | null;
    lineCents: number;
    photo: { id: string; name: string; category: string; hasImage: boolean; imageAt: string };
  }[];
  quote: { subtotalCents: number; deliveryFeeCents: number; gstCents: number; totalCents: number };
  methods: PaymentMethod[];
  terms: PaymentTerms;
  creditLeftCents: number | null;
  /** The customer's store credit; they can put it towards this order. */
  storeCreditCents: number;
  /** A first-order offer this order qualifies for, taken off before store credit. */
  offerCents: number;
  bankDetails: string;
  addresses: Address[];
  defaults: { recipient: string; phone: string; address: string };
}) {
  const tr = useT();
  const [state, form] = useKeptForm(checkout);
  const [addr, setAddr] = useState<Address | null>(props.addresses[0] ?? null);
  const [method, setMethod] = useState<PaymentMethod>(props.methods[0]);
  const fill = addr ?? { recipient: props.defaults.recipient, phone: props.defaults.phone, address: props.defaults.address, instructions: "" };
  // A repeat customer with everything on file sees one line ("Deliver to …  Change"), not a form.
  const [editing, setEditing] = useState(!(fill.recipient && fill.address));
  const [timed, setTimed] = useState(false);
  const [noting, setNoting] = useState(false);

  const [useCredit, setUseCredit] = useState(props.storeCreditCents > 0);
  const creditCents = useCredit ? Math.min(props.storeCreditCents, props.quote.totalCents - props.offerCents) : 0;
  const toPayCents = props.quote.totalCents - props.offerCents - creditCents;
  // The offer and store credit cover it all: nothing to choose, nothing to pay.
  const covered = creditCents + props.offerCents > 0 && toPayCents === 0;
  const overCredit = !covered && method === "invoice" && props.creditLeftCents !== null && toPayCents > props.creditLeftCents;
  const placeLabel = method === "card" && !covered ? tr("Continue to payment") : tr("Place order");

  return (
    <KeptForm form={form} className="mt-6 grid gap-10 lg:grid-cols-[1fr_380px] lg:gap-14">
      <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
      <div>
        <Section n={1} title={tr("Delivery")}>
          {!editing && (
            <div className="flex items-start gap-4 rounded-xl bg-white/70 px-5 py-4 ring-1 ring-leaf-950/8">
              <MapPin className="mt-0.5 size-4 shrink-0 text-leaf-700" />
              <div className="min-w-0 flex-1 text-sm leading-relaxed">
                <p className="font-semibold">{fill.recipient}</p>
                {fill.phone && <p className="text-leaf-900/60">{fill.phone}</p>}
                <p className="text-leaf-900/75">{fill.address}</p>
                {fill.instructions && <p className="mt-1 text-xs text-leaf-900/55">{fill.instructions}</p>}
              </div>
              <button type="button" onClick={() => setEditing(true)} className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-leaf-800 transition-colors hover:text-leaf-950">
                <Pencil className="size-3.5" /> {tr("Change")}
              </button>
            </div>
          )}
          {/* The fields are always in the form (sent with it); folded away while not being changed. */}
          <Expand open={editing}>
            {props.addresses.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {props.addresses.map((a) => (
                  <button key={a.id} type="button" onClick={() => setAddr(a)} className={chip(addr?.id === a.id)}>
                    {a.label || a.address.split(",")[0]}
                  </button>
                ))}
                <button type="button" onClick={() => setAddr(null)} className={chip(addr === null)}>
                  {tr("New address")}
                </button>
              </div>
            )}
            {/* key re-mounts the fields with the chosen address's values */}
            <div key={addr?.id ?? "new"} className="grid gap-4 sm:grid-cols-2">
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
                    <input type="checkbox" name="saveAddress" className="size-4 accent-leaf-700" /> {tr("Save this address")}
                  </label>
                  <input name="addressLabel" placeholder={tr("Label, e.g. Main store")} className={cx(input, "h-10 max-w-52 text-sm")} />
                </div>
              )}
            </div>
          </Expand>
        </Section>

        {/* No day to pick: the order goes on our next delivery run (the server picks the day). */}
        <Section n={2} title={tr("Delivery time")}>
          <div role="radiogroup" aria-label={tr("Delivery time")} className="inline-flex rounded-lg bg-leaf-950/[0.05] p-1 text-sm">
            {[false, true].map((t) => (
              <button
                key={String(t)}
                type="button"
                role="radio"
                aria-checked={timed === t}
                onClick={() => setTimed(t)}
                className={cx("rounded-md px-4 py-2 font-medium transition-[background-color,color,box-shadow] duration-200", timed === t ? "bg-white text-leaf-950 shadow-sm" : "text-leaf-900/60 hover:text-leaf-950")}
              >
                {t ? tr("Set a time window") : tr("Any time")}
              </button>
            ))}
          </div>
          <Expand open={timed}>
            <div className="grid max-w-sm grid-cols-2 gap-4 pt-4">
              <Label text={tr("From")}>
                <input name={timed ? "windowStart" : undefined} type="time" className={input} />
              </Label>
              <Label text={tr("Until")}>
                <input name={timed ? "windowEnd" : undefined} type="time" className={input} />
              </Label>
            </div>
            <p className="mt-2 text-xs text-leaf-900/55">{tr("We plan our run around your window.")}</p>
          </Expand>
        </Section>

        <Section n={3} title={tr("Payment")}>
          {props.storeCreditCents > 0 && (
            <label className={cx("mb-3 flex cursor-pointer items-center gap-3 rounded-xl px-5 py-4 transition-[background-color,box-shadow] duration-200", useCredit ? "bg-white ring-2 ring-leaf-700" : "bg-white/70 ring-1 ring-leaf-950/10 hover:ring-leaf-950/25")}>
              <input type="checkbox" name="useCredit" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} className="size-4 accent-leaf-700" />
              <Coins className="size-4 text-leaf-700" />
              <span className="flex-1 text-sm">
                <span className="font-semibold">{tr("Use my store credit")}</span>
                <span className="block text-xs text-leaf-900/60">
                  {tr("{amount} available", { amount: aud(props.storeCreditCents) })}
                  {useCredit && creditCents > 0 && ` · ${tr(covered ? "covers the rest of this order" : "{amount} comes off this order", { amount: aud(creditCents) })}`}
                </span>
              </span>
            </label>
          )}
          {covered ? (
            <>
              {/* Fully paid with credit: a method still goes with the form, but there's nothing to choose. */}
              <input type="hidden" name="method" value={props.methods.includes("bank_transfer") ? "bank_transfer" : props.methods[0]} />
              <p className="rounded-xl bg-leaf-50 px-5 py-4 text-sm text-leaf-900">
                {tr(creditCents > 0 ? "Your store credit pays for this order. There's nothing more to pay." : "Your first-order offer pays for this order. There's nothing more to pay.")}
              </p>
            </>
          ) : (
            <div className="space-y-2.5">
              {props.methods.map((m) => {
                const Icon = METHOD_ICON[m];
                const on = method === m;
                return (
                  <label
                    key={m}
                    className={cx(
                      "flex cursor-pointer items-start gap-4 rounded-xl px-5 py-4 transition-[background-color,box-shadow] duration-200",
                      on ? "bg-white ring-2 ring-leaf-700" : "bg-white/60 ring-1 ring-leaf-950/10 hover:bg-white hover:ring-leaf-950/25",
                    )}
                  >
                    <input type="radio" name="method" value={m} checked={on} onChange={() => setMethod(m)} className="sr-only" />
                    <span className={cx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full transition-colors duration-200", on ? "bg-leaf-700 text-white" : "ring-1 ring-leaf-950/25")}>
                      {on && <Check className="size-3 animate-pop" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="flex items-center gap-2 font-semibold">
                        <Icon className="size-4 text-leaf-700" /> {PAYMENT_METHOD_LABEL[m]}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-leaf-900/60">
                        {m === "card"
                          ? tr("Pay securely with Stripe. Your order is confirmed once payment goes through.")
                          : m === "bank_transfer"
                            ? tr("Confirmed now; please pay by bank transfer using your order number.")
                            : `${PAYMENT_TERMS_LABEL[props.terms]} from delivery.${props.creditLeftCents !== null ? ` Credit available ${aud(Math.max(0, props.creditLeftCents))}.` : ""}`}
                      </span>
                      {m === "bank_transfer" && props.bankDetails && (
                        <Expand open={on}>
                          <span className="mt-3 block rounded-lg bg-[#f5f1e8] p-3 text-xs whitespace-pre-wrap text-leaf-900/80">{props.bankDetails}</span>
                        </Expand>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {overCredit && <p className="mt-3 text-sm text-red-700">{tr("This order is over your available credit. Choose another payment method.")}</p>}
        </Section>

        <Section n={4} title={tr("Notes")}>
          {!noting && (
            <button type="button" onClick={() => setNoting(true)} className="text-sm font-semibold text-leaf-800 underline decoration-leaf-800/30 underline-offset-4 transition-colors hover:decoration-leaf-800">
              {tr("Add a note for us (optional)")}
            </button>
          )}
          <Expand open={noting}>
            <textarea name="notes" rows={3} placeholder={tr("Anything we should know (optional)")} className={cx(input, "h-auto py-3")} />
          </Expand>
        </Section>
      </div>

      <aside className="stagger h-fit rounded-2xl bg-white/70 p-6 ring-1 ring-leaf-950/8 lg:sticky lg:top-32" style={{ "--i": 2 } as React.CSSProperties}>
        <h2 className="font-display text-lg font-semibold tracking-tight">{tr("Order summary")}</h2>
        <ul className="mt-4 space-y-3.5">
          {props.lines.map((l) => (
            <li key={l.id} className="flex items-center gap-3.5 text-sm">
              <span className="relative shrink-0">
                <span className="block overflow-hidden rounded-lg">
                  <ProductImage p={{ ...l.photo, imageAt: new Date(l.photo.imageAt) }} sizes="48px" className="size-12" />
                </span>
                <span className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-leaf-950 px-1 text-[11px] font-semibold text-white tabular-nums">{l.qty}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 leading-snug">{l.name}</span>
                <span className="text-xs text-leaf-900/50">
                  {l.qty} × {tr(l.unit)}
                  {l.units && ` (${l.units})`}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{aud(l.lineCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-5 space-y-2 border-t border-leaf-950/10 pt-4 text-sm text-leaf-900/70">
          <Row label={tr("Subtotal (ex GST)")} value={aud(props.quote.subtotalCents)} />
          <Row label={tr("Delivery")} value={props.quote.deliveryFeeCents ? aud(props.quote.deliveryFeeCents) : tr("Free")} />
          <Row label={tr("GST")} value={aud(props.quote.gstCents)} />
          <div className="flex items-baseline justify-between border-t border-leaf-950/10 pt-3 text-leaf-950">
            <dt className="font-semibold">{tr("Total")}</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{aud(props.quote.totalCents)}</dd>
          </div>
          {props.offerCents > 0 && <Row label={tr("First-order offer")} value={`−${aud(props.offerCents)}`} accent />}
          {creditCents > 0 && <Row label={tr("Store credit")} value={`−${aud(creditCents)}`} accent />}
          {creditCents + props.offerCents > 0 && (
            <div className="flex justify-between font-semibold text-leaf-950">
              <dt>{tr("To pay")}</dt>
              <dd className="tabular-nums">{aud(toPayCents)}</dd>
            </div>
          )}
        </dl>
        <div className="mt-4">
          <FormError message={state && !state.ok ? state.error : null} />
        </div>
        <SubmitButton size="lg" disabled={overCredit} pendingText={tr("Placing order…")} className="mt-3 w-full rounded-lg bg-tomato text-base hover:bg-tomato-dark max-lg:hidden">
          {placeLabel}
        </SubmitButton>
        <p className="mt-3 text-center text-[11px] text-leaf-900/50">{tr("Prices, stock and totals are checked again when you place the order.")}</p>
        <LegalConsent lead="By placing this order, you agree to our:" className="mt-2 text-center text-[11px] leading-relaxed text-leaf-900/60" />
      </aside>

      {/* Phones: what's to pay and the button to place the order, always in reach. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-leaf-950/10 bg-cream/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-xs text-leaf-900/60">{tr(creditCents + props.offerCents > 0 ? "To pay" : "Total incl. GST")}</p>
            <p className="font-display text-xl font-semibold tabular-nums">{aud(toPayCents)}</p>
          </div>
          <SubmitButton size="lg" disabled={overCredit} pendingText={tr("Placing order…")} className="rounded-lg bg-tomato px-6 hover:bg-tomato-dark">
            {placeLabel}
          </SubmitButton>
        </div>
      </div>
      <div aria-hidden className="h-16 lg:hidden" />
    </KeptForm>
  );
}

const chip = (on: boolean) =>
  cx("rounded-lg px-3.5 py-2 text-sm transition-[background-color,box-shadow] duration-200", on ? "bg-white font-semibold ring-2 ring-leaf-700" : "bg-white/60 ring-1 ring-leaf-950/12 hover:ring-leaf-950/30");

/** One part of the form: a number, a heading, a thin rule above; they ease in one after another. */
function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="stagger border-t border-leaf-950/10 py-7 first:border-t-0 first:pt-0" style={{ "--i": n - 1 } as React.CSSProperties}>
      <h2 className="flex items-baseline gap-3">
        <span className="font-mono text-xs text-leaf-900/40 tabular-nums">{String(n).padStart(2, "0")}</span>
        <span className="font-display text-lg font-semibold tracking-tight">
          <Tx>{title}</Tx>
        </span>
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Opens and closes by sliding its height (only what's inside is ever shown). */
function Expand({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={cx("grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")} inert={!open}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cx("flex justify-between gap-3", accent && "text-leaf-700")}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Label({ text, children, className }: { text: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-xs font-medium text-leaf-900/65">{<Tx>{text}</Tx>}</span>
      {children}
    </label>
  );
}
