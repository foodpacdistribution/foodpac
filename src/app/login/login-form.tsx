"use client";

import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { login } from "@/app/actions/auth";
import { FormError, SubmitButton } from "@/components/client-ui";

const input =
  "h-12 w-full rounded-xl border border-leaf-950/15 bg-white pr-3.5 pl-10 text-[15px] text-leaf-950 placeholder:text-leaf-900/35 focus:border-leaf-600 focus:ring-2 focus:ring-leaf-600/20 focus:outline-none";

export function LoginForm({ next, defaultEmail }: { next?: string; defaultEmail?: string }) {
  const [state, action] = useActionState(login, undefined);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="mt-8 space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-leaf-900/80">Email</span>
        <span className="relative block">
          <Mail className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-leaf-900/35" />
          <input name="email" type="email" autoComplete="email" required autoFocus defaultValue={defaultEmail} placeholder="you@business.com.au" className={input} />
        </span>
      </label>
      <label className="block">
        <span className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-leaf-900/80">
          Password
          <Link href="/#contact" className="text-xs font-normal text-leaf-700 hover:underline">
            Forgot password?
          </Link>
        </span>
        <span className="relative block">
          <Lock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-leaf-900/35" />
          <input name="password" type={show ? "text" : "password"} autoComplete="current-password" required className={`${input} pr-11`} />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute top-1/2 right-1.5 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-leaf-900/45 hover:bg-leaf-950/5 hover:text-leaf-900"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </span>
      </label>
      <FormError message={state?.error} />
      <SubmitButton size="lg" pendingText="Signing in…" className="w-full rounded-xl bg-leaf-700 hover:bg-leaf-800">
        Sign in
      </SubmitButton>
    </form>
  );
}
