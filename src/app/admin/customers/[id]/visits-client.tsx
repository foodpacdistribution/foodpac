"use client";

import { ClipboardPen, MapPin, Phone, Store, Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { deleteVisit } from "@/app/actions/visits";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import { Badge, btn, Card, cx, EmptyState } from "@/components/ui";
import { useVisitLogger, type VisitTarget } from "@/components/visit-logger";
import type { VisitOutcome } from "@/lib/db/schema";
import { OUTCOMES } from "@/lib/visits";

type Say = (r: { ok: true; message?: string } | { ok: false; error: string }) => void;

function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const say: Say = (r) => setToast((t) => ({ id: (t?.id ?? 0) + 1, text: r.ok ? (r.message ?? "Saved") : r.error, tone: r.ok ? "ok" : "warn" }));
  return { say, toast: <Toast toast={toast} onDone={() => setToast(null)} /> };
}

/** "Log visit" on the customer page. Opens by itself for a link ending in ?visit=1 (from the map). */
export function VisitButton({ customer, today }: { customer: VisitTarget; today: string }) {
  const tr = useT();
  const { say, toast } = useToast();
  const visits = useVisitLogger({ today, say, onSaved: () => say({ ok: true, message: "Saving…" }) });
  const { open } = visits;
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("visit") !== "1") return;
    url.searchParams.delete("visit");
    history.replaceState(null, "", url);
    open(customer);
  }, [open, customer]);
  return (
    <>
      <button type="button" className={btn("primary")} onClick={() => open(customer)}>
        <ClipboardPen className="size-4" /> {tr("Log visit")}
      </button>
      {visits.dialog}
      {toast}
    </>
  );
}

export type VisitView = {
  id: string;
  when: string;
  channel: "visit" | "call";
  outcome: VisitOutcome;
  note: string | null;
  by: string | null;
  located: boolean;
  photoIds: string[];
  canDelete: boolean;
};

/** The customer's visits and calls, newest first, with their photos. */
export function VisitList({ visits, customer, today, canLog }: { visits: VisitView[]; customer: VisitTarget; today: string; canLog: boolean }) {
  const tr = useT();
  const { say, toast } = useToast();
  const logger = useVisitLogger({ today, say, onSaved: () => say({ ok: true, message: "Saving…" }) });
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [, start] = useTransition();
  const shown = visits.filter((v) => !gone.has(v.id));
  const remove = (v: VisitView) => {
    if (!confirm(tr("Delete this visit?"))) return;
    setGone((g) => new Set(g).add(v.id));
    start(async () => {
      const r = await deleteVisit(v.id);
      say(r);
      if (!r.ok)
        setGone((g) => {
          const n = new Set(g);
          n.delete(v.id);
          return n;
        });
    });
  };

  return (
    <>
      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardPen} title={tr("No visits yet")}>
            {tr("Log each visit or call: how it went, what was said, photos. The next reminder is set for you.")}
          </EmptyState>
          {canLog && (
            <div className="flex justify-center pb-5">
              <button type="button" className={btn("primary")} onClick={() => logger.open(customer)}>
                <ClipboardPen className="size-4" /> {tr("Log visit")}
              </button>
            </div>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {shown.map((v) => (
              <li key={v.id} className="flex gap-3 px-4 py-3">
                <span className={cx("grid size-8 shrink-0 place-items-center rounded-full", v.channel === "call" ? "bg-violet-50 text-violet-600" : "bg-blue-50 text-blue-600")}>
                  {v.channel === "call" ? <Phone className="size-4" /> : <Store className="size-4" />}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone={OUTCOMES[v.outcome].tone}>{tr(OUTCOMES[v.outcome].label)}</Badge>
                    <span className="text-xs text-slate-500">
                      {v.when}
                      {v.by && <> · {v.by}</>}
                    </span>
                    {v.located && <MapPin className="size-3 text-slate-400" aria-label={tr("Location added")} />}
                    {v.canDelete && (
                      <button type="button" onClick={() => remove(v)} className={btn("ghost", "icon-sm", "ml-auto text-slate-400 hover:text-red-600")} aria-label={tr("Delete this visit?")}>
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                  {v.note && <p className="mt-1 whitespace-pre-line text-slate-700">{v.note}</p>}
                  {v.photoIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {v.photoIds.map((p) => (
                        <a key={p} href={`/api/visit-photos/${p}`} target="_blank" rel="noreferrer" className="block size-20 overflow-hidden rounded-lg border border-line bg-slate-50">
                          {/* eslint-disable-next-line @next/next/no-img-element -- private photo behind a login, not for the image optimiser */}
                          <img src={`/api/visit-photos/${p}`} alt="" loading="lazy" className="size-full object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {logger.dialog}
      {toast}
    </>
  );
}
