"use client";

import { CheckCircle2 } from "lucide-react";
import { useActionState } from "react";
import { changePassword, updateMyName } from "@/app/actions/auth";
import { FormError, SubmitButton } from "./client-ui";
import { cx } from "./ui";

export const profileInput =
  "h-11 w-full rounded-xl border border-leaf-950/15 bg-white px-3.5 text-sm text-leaf-950 placeholder:text-leaf-900/35 focus:border-leaf-600 focus:ring-2 focus:ring-leaf-600/20 focus:outline-none disabled:bg-leaf-950/[0.03] disabled:text-leaf-900/60";

export function ProfileLabel({ text, hint, children, className }: { text: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-xs font-semibold text-leaf-900/75">{text}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-leaf-900/50">{hint}</span>}
    </label>
  );
}

export function Saved({ state }: { state: { ok: boolean; message?: string; error?: string } | undefined }) {
  if (!state) return null;
  if (!state.ok) return <FormError message={state.error} />;
  return (
    <p className="flex items-center gap-1.5 text-sm text-leaf-700">
      <CheckCircle2 className="size-4" /> {state.message}
    </p>
  );
}

export function ProfileCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-leaf-950/10 bg-white p-5 sm:p-6">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-leaf-900/60">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function NameForm({ name, email }: { name: string; email: string }) {
  const [state, action] = useActionState(updateMyName, undefined);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <ProfileLabel text="Your name">
        <input name="name" required defaultValue={name} autoComplete="name" className={profileInput} />
      </ProfileLabel>
      <ProfileLabel text="Login email" hint="Ask Foodpac to change the email you sign in with.">
        <input value={email} disabled className={profileInput} />
      </ProfileLabel>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <SubmitButton pendingText="Saving…" className="rounded-full bg-leaf-700 px-5 hover:bg-leaf-800">
          Save
        </SubmitButton>
        <Saved state={state} />
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(changePassword, undefined);
  return (
    <form action={action} key={state?.ok ? "done" : "form"} className="grid gap-4 sm:grid-cols-3">
      <ProfileLabel text="Current password">
        <input name="current" type="password" required autoComplete="current-password" className={profileInput} />
      </ProfileLabel>
      <ProfileLabel text="New password" hint="At least 8 characters.">
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className={profileInput} />
      </ProfileLabel>
      <ProfileLabel text="Repeat new password">
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={profileInput} />
      </ProfileLabel>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <SubmitButton pendingText="Updating…" className="rounded-full bg-leaf-700 px-5 hover:bg-leaf-800">
          Change password
        </SubmitButton>
        <Saved state={state} />
      </div>
    </form>
  );
}
