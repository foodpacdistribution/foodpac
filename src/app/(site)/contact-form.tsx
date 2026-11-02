"use client";

import { CheckCircle2 } from "lucide-react";
import { useActionState } from "react";
import { submitEnquiry } from "@/app/actions/enquiries";
import { FormError, SubmitButton } from "@/components/client-ui";
import { cx } from "@/components/ui";

const input =
  "h-11 w-full rounded-xl border border-leaf-950/15 bg-white px-3.5 text-sm text-leaf-950 placeholder:text-leaf-900/40 focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600/20";

function Label({ text, optional, children, className }: { text: string; optional?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-xs font-semibold text-leaf-900/80">
        {text} {optional && <span className="font-normal text-leaf-900/50">(optional)</span>}
      </span>
      {children}
    </label>
  );
}

export function ContactForm() {
  const [state, action] = useActionState(submitEnquiry, undefined);

  if (state?.ok) {
    return (
      <div className="flex animate-pop flex-col items-center justify-center rounded-[2rem] bg-cream p-10 text-center">
        <CheckCircle2 className="size-12 animate-check text-leaf-600" />
        <h3 className="mt-4 font-display text-2xl font-semibold">Thanks, we&apos;ve got your message.</h3>
        <p className="mt-2 max-w-sm text-leaf-900/70">Someone from our team will be in touch within one business day.</p>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4 rounded-[2rem] bg-cream p-6 sm:grid-cols-2 sm:p-8">
      <Label text="Your name">
        <input name="name" required autoComplete="name" className={input} />
      </Label>
      <Label text="Business name" optional>
        <input name="business" autoComplete="organization" className={input} />
      </Label>
      <Label text="Email">
        <input name="email" type="email" required autoComplete="email" className={input} />
      </Label>
      <Label text="Phone" optional>
        <input name="phone" type="tel" autoComplete="tel" className={input} />
      </Label>
      <Label text="Suburb" optional className="sm:col-span-2">
        <input name="suburb" autoComplete="address-level2" className={input} />
      </Label>
      <Label text="How can we help?" className="sm:col-span-2">
        <textarea
          name="message"
          required
          rows={4}
          placeholder="e.g. We're a café going through about 500 coffee cups and 200 takeaway boxes a week."
          className={cx(input, "h-auto py-3")}
        />
      </Label>
      {/* Hidden from people; bots that fill every field get ignored. */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] size-px opacity-0" />
      {state && !state.ok && (
        <div className="sm:col-span-2">
          <FormError message={state.error} />
        </div>
      )}
      <SubmitButton size="lg" pendingText="Sending…" className="rounded-full bg-tomato hover:bg-tomato-dark sm:col-span-2">
        Send message
      </SubmitButton>
    </form>
  );
}
