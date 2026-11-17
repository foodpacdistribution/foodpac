"use client";

import { CloudOff, LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { dropQueuedVisit, QUEUE_EVENT, type QueuedVisit, queuedVisits, sendQueuedVisits } from "@/lib/visit-queue";
import { Toast, type ToastMessage } from "./client-ui";
import { useT } from "./i18n";
import { btn, cx } from "./ui";

/**
 * Sends visits saved with no signal, and shows them while they wait. Lives in the back office's
 * layout, so it keeps going from page to page: it tries when the app opens, when the signal comes
 * back, when the app comes back to the front, and every 30 seconds while anything is waiting.
 */
export function VisitQueueStatus() {
  const tr = useT();
  const router = useRouter();
  const [items, setItems] = useState<QueuedVisit[]>([]);
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const reload = useCallback(() => {
    queuedVisits()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  const send = useCallback(() => {
    if (!navigator.onLine) return;
    setSending(true);
    sendQueuedVisits()
      .then(({ sent }) => {
        if (!sent) return;
        setToast((t) => ({ id: (t?.id ?? 0) + 1, text: sent === 1 ? "1 visit sent" : `${sent} visits sent`, tone: "ok" }));
        router.refresh();
      })
      .catch(() => {})
      .finally(() => setSending(false));
  }, [router]);

  useEffect(() => {
    reload();
    // First try once the page is up.
    queueMicrotask(send);
    const onVisible = () => document.visibilityState === "visible" && send();
    window.addEventListener(QUEUE_EVENT, reload);
    window.addEventListener("online", send);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(QUEUE_EVENT, reload);
      window.removeEventListener("online", send);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload, send]);

  // While anything is waiting, try again now and then (a weak signal doesn't always fire "online").
  const waiting = items.filter((v) => !v.error).length;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(send, 30_000);
    return () => clearInterval(t);
  }, [waiting, send]);

  const turnedDown = items.filter((v) => v.error);
  return (
    <>
      {items.length > 0 && (
        // Above where toasts appear, so a message and the waiting list never cover each other.
        <div className="no-print fixed bottom-[calc(max(env(safe-area-inset-bottom),1rem)+4rem)] left-4 z-40 max-w-[calc(100vw-2rem)] animate-rise lg:left-[17.25rem]">
          <div className="glass rounded-2xl text-sm text-slate-700">
            <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left" aria-expanded={open}>
              {sending ? <LoaderCircle className="size-4 shrink-0 animate-spin text-blue-600" /> : <CloudOff className={cx("size-4 shrink-0", turnedDown.length ? "text-red-600" : "text-amber-600")} />}
              <span className="min-w-0 flex-1">
                {waiting > 0 && tr(waiting === 1 ? "1 visit waiting to send" : "{n} visits waiting to send", { n: waiting })}
                {waiting > 0 && turnedDown.length > 0 && " · "}
                {turnedDown.length > 0 && <span className="text-red-700">{tr(turnedDown.length === 1 ? "1 couldn't be saved" : "{n} couldn't be saved", { n: turnedDown.length })}</span>}
              </span>
              {waiting > 0 && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    send();
                  }}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  className={btn("secondary", "sm", "shrink-0")}
                >
                  {tr("Send now")}
                </span>
              )}
            </button>
            {open && (
              <ul className="max-h-60 divide-y divide-slate-900/[0.06] overflow-y-auto border-t border-slate-900/[0.06] px-3.5">
                {items.map((v) => (
                  <li key={v.id} className="flex items-start gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{v.name}</p>
                      <p className={cx("text-xs", v.error ? "text-red-700" : "text-slate-500")}>
                        {v.error ? tr(v.error) : new Date(v.fields.at ?? v.queuedAt).toLocaleString()}
                      </p>
                    </div>
                    {v.error && (
                      <button type="button" onClick={() => dropQueuedVisit(v.id)} className={btn("ghost", "icon-sm", "text-slate-400 hover:text-red-600")} aria-label={tr("Discard")}>
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}
