import { ArrowLeft, Building2, ShieldCheck, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand";
import { databaseUrl } from "@/lib/db/url";
import { LoginBody, LoginBodyFromUrl } from "./login-body";

export const metadata: Metadata = { title: "Sign in" };

// Static: nothing here depends on the request, so the page is served straight from the edge.
export default function LoginPage() {
  const demo = !databaseUrl();

  return (
    <main className="grid min-h-dvh bg-cream text-leaf-950 lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-leaf-900 p-12 text-cream lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="relative z-10 flex items-center gap-2.5">
          <Logo badge className="h-14" priority />
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-cream/70">Distribution System</span>
        </Link>
        <div className="relative z-10 max-w-md">
          <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight">From the order to the signature, in one place.</h1>
          <ul className="mt-8 space-y-4 text-sm text-cream/80">
            <Point icon={Building2} title="Customers" text="Your prices, re-order in a click, invoices and statements." />
            <Point icon={Truck} title="Deliveries" text="Follow the van live and see the photo and signature at your door." />
            <Point icon={ShieldCheck} title="Staff & drivers" text="Sales, stock, routes and proof of delivery behind the same login." />
          </ul>
        </div>
        <svg className="absolute -right-24 bottom-0 h-[70%] opacity-25" viewBox="0 0 400 400" fill="none" aria-hidden>
          <path d="M40 360 C 120 300, 80 220, 170 200 S 300 160, 260 80 S 330 20, 380 40" stroke="#faf6ee" strokeWidth="4" strokeDasharray="2 10" strokeLinecap="round" />
          <path d="M20 250 C 90 240, 140 300, 210 280 S 320 300, 380 220" stroke="#e0620c" strokeWidth="4" strokeDasharray="2 10" strokeLinecap="round" />
          {[[40, 360], [170, 200], [260, 80], [380, 40], [20, 250], [210, 280], [380, 220]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="9" fill="#113a27" stroke="white" strokeWidth="3" />
          ))}
        </svg>
        <p className="relative z-10 text-xs text-cream/40">© {new Date().getFullYear()} Foodpac Distribution</p>
      </section>

      <section className="flex flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-leaf-900/60 hover:text-leaf-900">
            <ArrowLeft className="size-4" /> Back to the shop
          </Link>
          <Link href="/" className="lg:hidden" aria-label="Foodpac Distribution home">
            <Logo className="h-9" />
          </Link>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h2 className="font-display text-3xl font-semibold tracking-tight">Welcome back</h2>
          <Suspense fallback={<LoginBody demo={demo} />}>
            <LoginBodyFromUrl demo={demo} />
          </Suspense>
        </div>
        <p className="text-center text-xs text-leaf-900/45">Staff and drivers use the login they were given by Foodpac.</p>
      </section>
    </main>
  );
}

function Point({ icon: Icon, title, text }: { icon: typeof Truck; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10">
        <Icon className="size-4 text-tomato" />
      </span>
      <span>
        <span className="block font-semibold text-cream">{title}</span>
        {text}
      </span>
    </li>
  );
}
