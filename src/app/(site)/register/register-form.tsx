"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { registerCustomer } from "@/app/actions/shop";
import { FormError, SubmitButton } from "@/components/client-ui";
import { cx } from "@/components/ui";

const input =
  "h-11 w-full rounded-xl border border-leaf-950/15 bg-white px-3.5 text-sm placeholder:text-leaf-900/40 focus:border-leaf-600 focus:ring-2 focus:ring-leaf-600/20 focus:outline-none";

function Label({ text, children, className }: { text: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-xs font-semibold text-leaf-900/75">{text}</span>
      {children}
    </label>
  );
}

export function RegisterForm() {
  const [state, action] = useActionState(registerCustomer, undefined);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.push("/portal");
  }, [state, router]);
  return (
    <form action={action} className="grid gap-4 rounded-3xl border border-leaf-950/10 bg-white p-6 sm:grid-cols-2">
      <Label text="Business name" className="sm:col-span-2">
        <input name="business" required autoComplete="organization" className={input} />
      </Label>
      <Label text="ABN (optional)">
        <input name="abn" inputMode="numeric" className={input} />
      </Label>
      <Label text="Phone">
        <input name="phone" type="tel" autoComplete="tel" className={input} />
      </Label>
      <Label text="Delivery address" className="sm:col-span-2">
        <input name="address" autoComplete="street-address" className={input} />
      </Label>
      <Label text="Your name">
        <input name="name" required autoComplete="name" className={input} />
      </Label>
      <Label text="Email (your login)">
        <input name="email" type="email" required autoComplete="email" className={input} />
      </Label>
      <Label text="Password (8+ characters)" className="sm:col-span-2">
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className={input} />
      </Label>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] size-px opacity-0" />
      <div className="sm:col-span-2">
        <FormError message={state && !state.ok ? state.error : null} />
      </div>
      <SubmitButton size="lg" pendingText="Creating account…" className="rounded-full bg-leaf-700 hover:bg-leaf-800 sm:col-span-2">
        Create account
      </SubmitButton>
      <p className="text-center text-sm text-leaf-900/60 sm:col-span-2">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-leaf-700 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
