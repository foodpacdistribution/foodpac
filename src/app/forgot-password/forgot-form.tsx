"use client";

import { MailCheck } from "lucide-react";
import { useActionState } from "react";
import { requestPasswordReset } from "@/app/actions/auth";
import { FormError, SubmitButton } from "@/components/client-ui";
import { useT } from "@/components/i18n";

export function ForgotForm() {
  const tr = useT();
  const [state, action] = useActionState(requestPasswordReset, undefined);
  if (state?.ok) {
    return (
      <div className="mt-6 rounded-2xl bg-white p-5 text-sm text-leaf-900/80 shadow-sm ring-1 ring-leaf-950/10">
        <MailCheck className="size-6 text-leaf-700" />
        <p className="mt-2 font-semibold text-leaf-950">{tr("Check your email")}</p>
        <p className="mt-1">{tr("We've sent an email to that address. If you have a login, it has a link to choose a new password (it works once, for the next hour). Nothing after a few minutes? Check your spam folder.")}</p>
      </div>
    );
  }
  return (
    <form action={action} className="mt-6 space-y-4">
      <p className="text-sm text-leaf-900/70">{tr("Enter the email you sign in with and we'll send you a link to choose a new password.")}</p>
      <input
        name="email"
        type="email"
        autoComplete="email"
        required
        autoFocus
        placeholder={tr("you@business.com.au")}
        aria-label={tr("Email")}
        className="h-12 w-full rounded-xl border border-leaf-950/15 bg-white px-3.5 text-[15px] placeholder:text-leaf-900/35 focus:border-leaf-600 focus:ring-2 focus:ring-leaf-600/20 focus:outline-none"
      />
      <FormError message={state && !state.ok ? state.error : null} />
      <SubmitButton size="lg" pendingText={tr("Sending…")} className="w-full rounded-xl bg-leaf-700 hover:bg-leaf-800">
        {tr("Email me a reset link")}
      </SubmitButton>
    </form>
  );
}
