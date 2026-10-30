"use client";

import { useActionState } from "react";
import { login } from "@/app/actions/auth";
import { FormError, SubmitButton } from "@/components/client-ui";
import { Field, inputCls } from "@/components/ui";

export function LoginForm() {
  const [state, action] = useActionState(login, undefined);
  return (
    <form action={action} className="mt-6 space-y-4">
      <Field label="Email">
        <input name="email" type="email" autoComplete="email" required className={inputCls} />
      </Field>
      <Field label="Password">
        <input name="password" type="password" autoComplete="current-password" required className={inputCls} />
      </Field>
      <FormError message={state?.error} />
      <SubmitButton className="w-full" size="lg" pendingText="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
