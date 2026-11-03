"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Toast, type ToastMessage } from "./client-ui";
import { useT } from "./i18n";

// Keeps a screen up to date without reloading by hand. Every few seconds (only while the tab is
// visible) it asks /api/live for a small fingerprint of what this screen shows, and re-renders
// the page only when that fingerprint changes. Client state such as open dialogs and typed text
// survives the refresh. Screens with unsaved edits can hold refreshing (useHoldLiveRefresh).

let holds = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** While `active`, live data isn't applied automatically (e.g. the planner has unsaved moves). */
export function useHoldLiveRefresh(active: boolean) {
  useEffect(() => {
    if (!active) return;
    holds += 1;
    emit();
    return () => {
      holds -= 1;
      emit();
    };
  }, [active]);
}

type Live = { v: string; sales: number; stops: number; enquiries: number };

export function LiveRefresh({ scope, intervalMs = 12_000, notify }: { scope: "admin" | "tracking" | "driver" | "customer"; intervalMs?: number; notify?: "staff" | "driver" }) {
  const router = useRouter();
  const tr = useT();
  const held = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => holds > 0,
    () => false,
  );
  const [waiting, setWaiting] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const last = useRef<Live | null>(null);
  const heldRef = useRef(held);
  useEffect(() => {
    heldRef.current = held;
  }, [held]);

  useEffect(() => {
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      clearTimeout(timer);
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/live?scope=${scope}`, { cache: "no-store" });
        if (res.status === 401) return; // signed out: nothing to keep fresh
        const now = (await res.json()) as Live;
        failures = 0;
        const prev = last.current;
        last.current = now;
        if (prev && prev.v !== now.v) {
          if (notify === "staff" && now.sales > prev.sales) setToast({ id: Date.now(), tone: "ok", text: now.sales - prev.sales > 1 ? `${now.sales - prev.sales} new online orders` : "New online order" });
          else if (notify === "staff" && now.enquiries > prev.enquiries) setToast({ id: Date.now(), tone: "ok", text: "New website enquiry" });
          if (notify === "driver" && now.stops > prev.stops) {
            setToast({ id: Date.now(), tone: "ok", text: `${now.stops - prev.stops} new stop(s) added · route re-ordered for the fastest drive` });
            navigator.vibrate?.([120, 60, 120]);
          }
          if (heldRef.current) setWaiting(true);
          else startTransition(() => router.refresh());
        }
      } catch {
        failures += 1;
      }
      // Back off after repeated failures (offline); the next focus or reconnect restarts it.
      if (!stopped && failures < 5) timer = setTimeout(check, intervalMs);
    };

    const wake = () => {
      failures = 0;
      check();
    };
    check();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [scope, intervalMs, notify, router]);

  return (
    <>
      {waiting && !held && (
        <WaitingApplier
          onApply={() => {
            setWaiting(false);
            startTransition(() => router.refresh());
          }}
        />
      )}
      {waiting && held && (
        <button
          onClick={() => {
            setWaiting(false);
            startTransition(() => router.refresh());
          }}
          className="no-print fixed right-4 bottom-20 z-50 flex animate-pop items-center gap-2 rounded-full bg-navy-900 px-4 py-2.5 text-sm font-medium text-white shadow-pop lg:bottom-6"
        >
          <RefreshCw className="size-4" /> {tr("New changes · Refresh")}
        </button>
      )}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}

/** Applies a refresh that was held back, as soon as the hold is released. */
function WaitingApplier({ onApply }: { onApply: () => void }) {
  useEffect(() => onApply(), [onApply]);
  return null;
}
