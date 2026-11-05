"use client";

import Link from "@/components/link";
import { useSearchParams } from "next/navigation";
import { LoginForm } from "./login-form";
import { useT } from "@/components/i18n";

const DEMO = [
  ["customer@demo.local", "Customer"],
  ["admin@demo.local", "Admin"],
  ["dispatch@demo.local", "Dispatcher"],
  ["sales@demo.local", "Salesperson"],
  ["john@demo.local", "Driver"],
];

/** Reads ?next= and ?email= in the browser, so the sign-in page itself can be static (served from the edge). */
export function LoginBodyFromUrl({ demo }: { demo: boolean }) {
  const sp = useSearchParams();
  return <LoginBody demo={demo} next={sp.get("next") ?? undefined} email={sp.get("email") ?? undefined} />;
}

export function LoginBody({ demo, next, email }: { demo: boolean; next?: string; email?: string }) {
  const tr = useT();
  const toCheckout = next?.startsWith("/cart") || next?.startsWith("/checkout");
  return (
    <>
      <p className="mt-2 text-leaf-900/65">{toCheckout ? tr("Sign in to finish your order.") : tr("Sign in to your Foodpac account.")}</p>
      <LoginForm key={email ?? ""} next={next} defaultEmail={email} />

      <div className="mt-8 rounded-2xl border border-leaf-950/10 bg-white p-4">
        <p className="text-sm font-semibold">{tr("New to Foodpac?")}</p>
        <p className="mt-0.5 text-sm text-leaf-900/65">{tr("Open a trade account to see your prices and order online.")}</p>
        <Link href="/register" className="mt-3 inline-flex h-10 items-center rounded-full border border-leaf-950/15 px-4 text-sm font-semibold transition-colors hover:border-leaf-700/40 active:scale-[0.97]">
          {tr("Open an account")}</Link>
      </div>

      {demo && (
        <div className="mt-4 rounded-2xl border border-dashed border-leaf-950/20 p-4 text-xs text-leaf-900/70">
          <p className="font-semibold text-leaf-950">{tr("Demo accounts · password demo1234")}</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {DEMO.map(([e, role]) => (
              <Link
                key={e}
                href={`/login?email=${encodeURIComponent(e)}${next ? `&next=${encodeURIComponent(next)}` : ""}`}
                className="rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-leaf-950/10 hover:ring-leaf-700/40"
              >
                <span className="block font-semibold text-leaf-950">{tr(role)}</span>
                <span className="block truncate font-mono text-[11px]">{e}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
