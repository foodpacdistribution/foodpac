"use client";

import { Check, CheckCircle2, Copy, Dices, Gift, Heart, KeyRound, Scale, Store, Wallet } from "lucide-react";
import { useState } from "react";
import { type OpenedAccount, openCustomerAccount } from "@/app/actions/pipeline";
import { AddressInput } from "@/components/address-input";
import { FormError, KeptForm, SubmitButton, useKeptForm } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { btn, cx, Field, inputCls } from "@/components/ui";
import type { PaymentTerms } from "@/lib/db/schema";
import { aud, PAYMENT_TERMS_LABEL } from "@/lib/money";

/** What's already known about the store, from the pipeline or the customer list. */
export type AccountStart = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  abn: string | null;
  paymentTerms: PaymentTerms;
  creditLimitCents: number | null;
  login: { email: string; name: string } | null;
  /** Products already on their list (price matched, or added by hand). */
  listCount?: number;
};

const TERMS = Object.keys(PAYMENT_TERMS_LABEL) as PaymentTerms[];

/** A password that's easy to read out or type from a phone: no 0/O, 1/l/I. */
function newPassword() {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

/**
 * A store has signed: everything to get it ordering, in one form. Its details, a portal login
 * (with a password to hand over), how it pays, and store credit to start with. Ends on a summary
 * of what to tell the customer.
 */
export function OpenAccountForm({ start, onClose }: { start: AccountStart | null; onClose: (message?: string) => void }) {
  const tr = useT();
  const [state, form] = useKeptForm(openCustomerAccount);
  const [terms, setTerms] = useState<PaymentTerms>(start?.paymentTerms ?? "prepay");
  const [contactEmail, setContactEmail] = useState(start?.email ?? "");
  // The login email follows the contact email until someone types a different one.
  const [loginEmail, setLoginEmail] = useState<string | null>(null);
  const [password, setPassword] = useState(newPassword);
  const [credit, setCredit] = useState("");
  const login = start?.login ?? null;
  const shownLoginEmail = loginEmail ?? contactEmail;

  if (state?.ok && state.data) return <Opened account={state.data} terms={terms} onClose={() => onClose(state.message)} />;

  return (
    <KeptForm form={form} className="space-y-5">
      {start && <input type="hidden" name="id" value={start.id} />}

      <Section icon={Store} title={tr("The store")}>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Business name">
            <input name="name" required defaultValue={start?.name} autoFocus={!start} className={inputCls} />
          </Field>
          <Field label="ABN">
            <input name="abn" defaultValue={start?.abn ?? ""} inputMode="numeric" className={inputCls} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone">
            <input name="phone" type="tel" defaultValue={start?.phone ?? ""} className={inputCls} />
          </Field>
          <Field label="Contact email">
            <input name="email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="Delivery address">
          <AddressInput name="address" defaultValue={start?.address ?? ""} inputClassName={inputCls} />
        </Field>
      </Section>

      <Section icon={KeyRound} title={tr("Login to order online")}>
        {login ? (
          <>
            {/* Kept as they are; the password stays the one they have. */}
            <input type="hidden" name="loginEmail" value={login.email} />
            <input type="hidden" name="loginName" value={login.name} />
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {tr("Already signs in as {email}.", { email: login.email })}
            </p>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Login email" hint="Leave blank if they'll only order through you.">
                <input name="loginEmail" type="email" autoComplete="off" value={shownLoginEmail} onChange={(e) => setLoginEmail(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Contact name">
                <input name="loginName" autoComplete="off" placeholder={tr("e.g. Amy (owner)")} className={inputCls} />
              </Field>
            </div>
            <Field label="Password" hint="At least 8 characters. You'll see it again at the end to pass on.">
              <div className="flex gap-2">
                <input name="password" autoComplete="off" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)} className={cx(inputCls, "font-mono")} />
                <button type="button" className={btn("secondary", "md", "shrink-0")} onClick={() => setPassword(newPassword())} title={tr("Make a new password")}>
                  <Dices className="size-4" /> <span className="max-sm:sr-only">{tr("New")}</span>
                </button>
              </div>
            </Field>
          </>
        )}
        {(login || shownLoginEmail) && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="notify" defaultChecked /> {tr("Email them that their account is ready to order")}
          </label>
        )}
      </Section>

      <Section icon={Wallet} title={tr("How they pay")}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TERMS.map((t) => (
            <label
              key={t}
              className="flex cursor-pointer items-center justify-center rounded-lg border border-line px-2 py-2 text-center text-sm has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 has-[:checked]:font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500/30"
            >
              <input type="radio" name="paymentTerms" value={t} checked={terms === t} onChange={() => setTerms(t)} className="sr-only" />
              {tr(PAYMENT_TERMS_LABEL[t])}
            </label>
          ))}
        </div>
        {terms === "prepay" ? (
          <p className="text-xs text-slate-500">{tr("They pay by card or bank transfer when they order.")}</p>
        ) : (
          <Field label="Credit limit ($)" hint="The most they can owe on unpaid invoices. Blank means no limit.">
            <input
              name="creditLimit"
              inputMode="decimal"
              defaultValue={start?.creditLimitCents != null ? String(start.creditLimitCents / 100) : ""}
              placeholder={tr("e.g. 3000")}
              className={inputCls}
            />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <Field label="Store credit to start ($)" hint="Optional. They spend it at checkout.">
            <input name="startingCredit" inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="0" className={inputCls} />
          </Field>
          {credit.trim() !== "" && credit.trim() !== "0" && (
            <Field label="Why" hint="Kept with the credit, for the office.">
              <input name="creditReason" placeholder={tr("e.g. Welcome credit for first order")} maxLength={300} className={inputCls} />
            </Field>
          )}
        </div>
      </Section>

      <Section icon={Gift} title={tr("First-order offer (optional)")}>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
          <span className="relative w-24">
            <span className="pointer-events-none absolute top-2 left-2.5 text-slate-400">$</span>
            <input name="offerOff" inputMode="decimal" aria-label={tr("Amount off")} placeholder="30" className={cx(inputCls, "pl-6")} />
          </span>
          {tr("off their first order of")}
          <span className="relative w-28">
            <span className="pointer-events-none absolute top-2 left-2.5 text-slate-400">$</span>
            <input name="offerMin" inputMode="decimal" aria-label={tr("Minimum first order")} placeholder="200" className={cx(inputCls, "pl-6")} />
          </span>
          {tr("or more")}
        </div>
        <p className="text-xs text-slate-500">{tr("Gets them to place a first order. Taken off automatically, online or when you take the order; before GST, up to $500.")}</p>
      </Section>

      <Section icon={Heart} title={tr("Their list")}>
        {start?.listCount ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {tr(start.listCount === 1 ? "1 product is on their list." : "{n} products are on their list.", { n: start.listCount })}{" "}
            {tr("They'll see them at their prices under My list when they sign in, ready to order.")}
          </p>
        ) : (
          <p className="text-xs text-slate-500">{tr("Nothing on their list yet. Next you can add the products they'll order, so it's ready when they first sign in.")}</p>
        )}
      </Section>

      <FormError message={state && !state.ok ? state.error : null} />
      <SubmitButton className="w-full" pendingText={tr("Opening account…")}>
        <CheckCircle2 className="size-4" /> {tr("Open account")}
      </SubmitButton>
      <p className="text-center text-xs text-slate-500">{tr("The account is approved straight away and marked Won.")}</p>
    </KeptForm>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Store; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Icon className="size-4 text-slate-400" /> {title}
      </legend>
      {children}
    </fieldset>
  );
}

/** Done: what the customer needs to know, with the password ready to copy. */
function Opened({ account, terms, onClose }: { account: OpenedAccount; terms: PaymentTerms; onClose: () => void }) {
  const tr = useT();
  const [copied, setCopied] = useState(false);
  const handover = account.login
    ? [`${tr("Login")}: ${account.login.email}`, ...(account.login.password ? [`${tr("Password")}: ${account.login.password}`] : [])].join("\n")
    : "";
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
        <div>
          <p className="font-semibold">{tr("{name} can order now", { name: account.name })}</p>
          <p className="text-sm text-emerald-800">{tr("The account is approved and marked Won.")}</p>
        </div>
      </div>
      <dl className="divide-y divide-line rounded-xl border border-line text-sm">
        <Row label={tr("Login")}>{account.login ? account.login.email : <span className="text-slate-500">{tr("None: they order through you")}</span>}</Row>
        {account.login && (
          <Row label={tr("Password")}>
            {account.login.password ? <span className="font-mono">{account.login.password}</span> : <span className="text-slate-500">{tr("Unchanged")}</span>}
          </Row>
        )}
        <Row label={tr("Payment terms")}>{tr(PAYMENT_TERMS_LABEL[terms])}</Row>
        {account.creditBalance !== null && <Row label={tr("Store credit")}>{aud(Math.round(account.creditBalance * 100))}</Row>}
        {account.offer && <Row label={tr("First-order offer")}>{tr("{off} off {min}+", { off: aud(account.offer.offCents), min: aud(account.offer.minCents) })}</Row>}
      </dl>
      {handover && (
        <button
          type="button"
          className={btn("secondary", "md", "w-full")}
          onClick={async () => {
            await navigator.clipboard?.writeText(handover).catch(() => {});
            setCopied(true);
          }}
        >
          {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />} {copied ? tr("Copied") : tr("Copy login details")}
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Link href={`/admin/customers/${account.customerId}/list`} className={btn("secondary")}>
          <Heart className="size-4" /> {tr("Set up their list")}
        </Link>
        <Link href={`/admin/customers/${account.customerId}/price-match`} className={btn("secondary")}>
          <Scale className="size-4" /> {tr("Price match")}
        </Link>
        <Link href={`/admin/customers/${account.customerId}`} className={btn("secondary")}>
          {tr("View customer")}
        </Link>
        <button type="button" className={btn("primary")} onClick={onClose}>
          {tr("Done")}
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-all text-slate-900">{children}</dd>
    </div>
  );
}
