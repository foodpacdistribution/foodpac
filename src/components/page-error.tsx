"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { useEffect, useTransition } from "react";
import { useT } from "./i18n";
import { btn, Spinner } from "./ui";

/**
 * What a page shows when it fails to load (network blip, server hiccup, a bug), instead of a frozen
 * or blank screen: a short message, Try again (re-runs just this page) and Reload.
 */
export function PageError({ error, retry, tone = "staff" }: { error: unknown; retry: () => void; tone?: "staff" | "shop" }) {
  const tr = useT();
  const [pending, start] = useTransition();
  useEffect(() => {
    console.error(error);
  }, [error]);
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
