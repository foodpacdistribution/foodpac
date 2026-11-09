"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useT } from "./i18n";
import { btn, Spinner } from "./ui";

/** Quiet automatic retries before the error is shown: most failures are a dropped connection that the next request fixes. */
const RETRY_DELAYS_MS = [1_000, 3_000, 6_000];
/** Automatic retries across all error screens in the last minute, so a page that is really broken can't loop. */
/** A hiccup that recovers this fast shows nothing at all; only a longer wait says "Reconnecting…". */
const QUIET_MS = 3_000;
let recentRetries: number[] = [];

/**
 * What a page shows when it fails to load (network blip, server hiccup, a bug), instead of a frozen
 * or blank screen. It first retries by itself a few times, showing only "Reconnecting…": the live
 * refresh re-renders open pages in the background, so one failed request would otherwise replace a
 * working screen with an error nobody caused. If it still fails: a short message, Try again (re-runs
 * just this page) and Reload.
 */
export function PageError({ error, retry, tone = "staff" }: { error: unknown; retry: () => void; tone?: "staff" | "shop" }) {
  const tr = useT();
  const [pending, start] = useTransition();
  const [auto, setAuto] = useState(true);
  const [showWait, setShowWait] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowWait(true), QUIET_MS);
    return () => clearTimeout(t);
  }, []);
  const retryRef = useRef(retry);
  useEffect(() => {
    retryRef.current = retry;
  }, [retry]);
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Retries until the page renders (this component then unmounts) or the attempts run out.
  useEffect(() => {
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const now = Date.now();
      recentRetries = recentRetries.filter((t) => now - t < 60_000);
      if (attempt >= RETRY_DELAYS_MS.length || recentRetries.length >= RETRY_DELAYS_MS.length * 2) return setAuto(false);
      timer = setTimeout(() => {
        // Offline: wait for the connection instead of using up attempts.
        if (!navigator.onLine) return schedule();
        attempt += 1;
        recentRetries.push(Date.now());
        start(() => retryRef.current());
        schedule();
      }, RETRY_DELAYS_MS[attempt]);
    };
    schedule();
    // Back online after the attempts ran out: try once more without waiting for a click.
    const online = () => start(() => retryRef.current());
    window.addEventListener("online", online);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", online);
    };
  }, []);

  if (auto)
    return (
      <div role="status" aria-busy className="mx-auto my-16 flex min-h-5 items-center justify-center gap-2 text-sm text-slate-500">
        {showWait && (
          <>
            <Spinner className="size-4" /> {tr("Reconnecting…")}
          </>
        )}
      </div>
    );

  const digest = (error as { digest?: string } | null)?.digest;
  return (
    <div role="alert" className="mx-auto my-10 max-w-md rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-sm">
      <span className="mx-auto grid size-11 place-items-center rounded-full bg-amber-50 text-amber-600">
        <AlertTriangle className="size-5" />
      </span>
      <h2 className="mt-3 text-base font-semibold text-slate-900">{tr("This page didn't load")}</h2>
      <p className="mt-1 text-sm text-slate-600">{tr("It may be a brief connection problem. Nothing you saved has been lost.")}</p>
      <div className="mt-4 flex justify-center gap-2">
        <button type="button" disabled={pending} onClick={() => start(() => retry())} className={btn(tone === "shop" ? "secondary" : "primary")}>
          {pending ? <Spinner className="size-4" /> : <RotateCw className="size-4" />} {tr("Try again")}
        </button>
        <button type="button" onClick={() => window.location.reload()} className={btn("ghost")}>
          {tr("Reload page")}
        </button>
      </div>
      {digest && <p className="mt-4 text-[11px] text-slate-400">{tr("Reference")}: {digest}</p>}
    </div>
  );
}
