"use client";

import { Settings2 } from "lucide-react";
import { useState, useTransition } from "react";
import { savePriceMatchRules } from "@/app/actions/price-match";
import { MatchList, type MatchView } from "@/app/admin/customers/[id]/price-match/price-match-client";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import { btn, Card, CardHeader, cx, Field, inputCls, Spinner } from "@/components/ui";

export function PriceMatchesClient({ matches, isAdmin, rules }: { matches: MatchView[]; isAdmin: boolean; rules: { minMarginPct: number; beatPct: number } }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <MatchList matches={matches} office onToast={setToast} title="Waiting for approval" />
      <Rules rules={rules} isAdmin={isAdmin} onToast={setToast} />
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function Rules({ rules, isAdmin, onToast }: { rules: { minMarginPct: number; beatPct: number }; isAdmin: boolean; onToast: (t: ToastMessage) => void }) {
  const tr = useT();
  const [margin, setMargin] = useState(String(rules.minMarginPct));
  const [beat, setBeat] = useState(String(rules.beatPct));
  const [pending, start] = useTransition();
  const changed = margin !== String(rules.minMarginPct) || beat !== String(rules.beatPct);
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Settings2 className="size-4 text-slate-400" /> {tr("Price match rules")}</span>} />
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await savePriceMatchRules(Number(margin), Number(beat));
            onToast({ id: Date.now(), text: r.ok ? (r.message ?? "Saved") : r.error, tone: r.ok ? "ok" : "warn" });
          });
        }}
      >
        <Field label="Lowest margin sales staff can give (%)" hint="Gross margin over what the product costs us. Lower prices wait here for approval.">
          <Pct value={margin} onChange={setMargin} disabled={!isAdmin} />
        </Field>
        <Field label="Suggest a price under theirs by (%)" hint="0 = match what they pay now. Never above our list price.">
          <Pct value={beat} onChange={setBeat} disabled={!isAdmin} />
        </Field>
        {isAdmin ? (
          <button disabled={pending || !changed} className={btn("primary", "md", "w-full")}>
            {pending && <Spinner />} {tr("Save")}
          </button>
        ) : (
          <p className="text-xs text-slate-500">{tr("Only an admin can change these.")}</p>
        )}
      </form>
    </Card>
  );
}

function Pct({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div className="relative w-28">
      <input value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" disabled={disabled} className={cx(inputCls, "pr-7 tabular-nums")} />
      <span className="pointer-events-none absolute top-2 right-3 text-sm text-slate-400">%</span>
    </div>
  );
}
