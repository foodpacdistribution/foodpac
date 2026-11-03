"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { resetPassword } from "@/app/actions/auth";
import { FormError, SubmitButton } from "@/components/client-ui";
import { useT } from "@/components/i18n";

export function ResetForm({ token }: { token: string }) {
  const tr = useT();
  const [state, action] = useActionState(resetPassword, undefined);
  const [show, setShow] = useState(false);
  const error = state && !state.ok ? state.error : null;
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="token" value={token} />
      <span className="relative block">
        <input
          name="password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          minLength={8}
          required
          autoFocus
          placeholder={tr("At least 8 characters")}
          aria-label={tr("New password")}
          className="h-12 w-full rounded-xl border border-leaf-950/15 bg-white pr-11 pl-3.5 text-[15px] placeholder:text-leaf-900/35 focus:border-leaf-600 focus:ring-2 focus:ring-leaf-600/20 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={tr(show ? "Hide password" : "Show password")}
          className="absolute top-1/2 right-1.5 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-leaf-900/45 hover:bg-leaf-950/5"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </span>
      <FormError message={error} />
      {error && (
        <Link href="/forgot-password" className="block text-sm font-medium text-leaf-700 underline">
          {tr("Send me a new link")}
        </Link>
      )}
      <SubmitButton size="lg" pendingText={tr("Saving…")} className="w-full rounded-xl bg-leaf-700 hover:bg-leaf-800">
        {tr("Save and sign in")}
      </SubmitButton>
    </form>
  );
}
