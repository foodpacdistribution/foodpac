"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { quickOrder } from "@/app/actions/shop";
import { FormError, SubmitButton, KeptForm, useKeptForm } from "@/components/client-ui";
import { useT } from "@/components/i18n";

export function QuickOrderForm() {
  const tr = useT();
  const [state, form] = useKeptForm(quickOrder);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.push("/cart");
  }, [state, router]);
  return (
    <KeptForm form={form} className="mt-5 space-y-3 rounded-3xl border border-leaf-950/10 bg-white p-5">
      <textarea
        name="lines"
        rows={7}
        required
        placeholder={"FP-1001 10\nFP-2003 4\nFP-3002 2"}
        className="w-full rounded-xl border border-leaf-950/15 bg-white px-3.5 py-3 font-mono text-sm placeholder:text-leaf-900/35 focus:border-leaf-600 focus:ring-2 focus:ring-leaf-600/20 focus:outline-none"
      />
      <FormError message={state && !state.ok ? state.error : null} />
      <SubmitButton pendingText={tr("Adding…")} className="rounded-full bg-leaf-700 hover:bg-leaf-800">
        {tr("Add to cart")}</SubmitButton>
    </KeptForm>
  );
}
