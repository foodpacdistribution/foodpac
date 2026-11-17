"use client";

import Link from "@/components/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { registerCustomer } from "@/app/actions/shop";
import { FormError, SubmitButton, KeptForm, useKeptForm } from "@/components/client-ui";
import { cx } from "@/components/ui";
import { Tx, useT } from "@/components/i18n";

const input =
  "h-11 w-full rounded-xl border border-leaf-950/15 bg-white px-3.5 text-sm placeholder:text-leaf-900/40 focus:border-leaf-600 focus:ring-2 focus:ring-leaf-600/20 focus:outline-none";

function Label({ text, children, className }: { text: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-xs font-semibold text-leaf-900/75">{<Tx>{text}</Tx>}</span>
      {children}
    </label>
  );
}

/** `invite`: from a salesperson's leave-behind; `store` is the business it was printed for. */
export function RegisterForm({ invite = null }: { invite?: { ref: string; rep: string; store: string | null } | null }) {
  const tr = useT();
  const [state, form] = useKeptForm(registerCustomer);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.push("/portal");
  }, [state, router]);
  return (
    <KeptForm form={form} className="grid gap-4 rounded-3xl border border-leaf-950/10 bg-white p-6 sm:grid-cols-2">
      {invite && (
        <>
          <input type="hidden" name="ref" value={invite.ref} />
          <p className="rounded-xl bg-leaf-50 px-3.5 py-2.5 text-sm text-leaf-900 sm:col-span-2">{tr("{name} from Foodpac will look after your account.", { name: invite.rep })}</p>
        </>
      )}
      <Label text={tr("Business name")} className="sm:col-span-2">
        <input name="business" required autoComplete="organization" defaultValue={invite?.store ?? undefined} readOnly={!!invite?.store} className={cx(input, invite?.store && "bg-leaf-50/60")} />
      </Label>
      <Label text={tr("ABN (optional)")}>
        <input name="abn" inputMode="numeric" className={input} />
      </Label>
      <Label text={tr("Phone")}>
        <input name="phone" type="tel" autoComplete="tel" className={input} />
      </Label>
      <Label text={tr("Delivery address")} className="sm:col-span-2">
        <input name="address" autoComplete="street-address" className={input} />
      </Label>
      <Label text={tr("Your name")}>
        <input name="name" required autoComplete="name" className={input} />
      </Label>
      <Label text={tr("Email (your login)")}>
        <input name="email" type="email" required autoComplete="email" className={input} />
      </Label>
      <Label text={tr("Password (8+ characters)")} className="sm:col-span-2">
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className={input} />
      </Label>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] size-px opacity-0" />
      <div className="sm:col-span-2">
        <FormError message={state && !state.ok ? state.error : null} />
      </div>
      <SubmitButton size="lg" pendingText={tr("Creating account…")} className="rounded-md bg-leaf-700 hover:bg-leaf-800 sm:col-span-2">
        {tr("Create account")}</SubmitButton>
      <p className="text-center text-sm text-leaf-900/60 sm:col-span-2">
        {tr("Already have an account?")}{" "}
        <Link href="/login" className="font-semibold text-leaf-700 hover:underline">
          {tr("Sign in")}</Link>
      </p>
    </KeptForm>
  );
}
