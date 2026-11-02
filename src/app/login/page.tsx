import { ArrowLeft, Building2, ShieldCheck, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const DEMO = [
  ["customer@demo.local", "Customer"],
  ["admin@demo.local", "Admin"],
  ["dispatch@demo.local", "Dispatcher"],
  ["john@demo.local", "Driver"],
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const { next, email } = await searchParams;
  const demo = !process.env.DATABASE_URL;
  const toCheckout = next?.startsWith("/cart") || next?.startsWith("/checkout");

  return (
    <main className="grid min-h-dvh bg-cream text-leaf-950 lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-leaf-900 p-12 text-cream lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="relative z-10 flex items-center gap-2.5">
          <BrandMark className="size-10" />
          <span className="leading-tight">
            <span className="block font-display text-lg font-semibold">Foodpac Distribution</span>
            <span className="block text-xs text-cream/60">System</span>
          </span>
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
          <path d="M20 250 C 90 240, 140 300, 210 280 S 320 300, 380 220" stroke="#e4572e" strokeWidth="4" strokeDasharray="2 10" strokeLinecap="round" />
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
          <Link href="/" className="lg:hidden">
            <BrandMark className="size-9" />
          </Link>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h2 className="font-display text-3xl font-semibold tracking-tight">Welcome back</h2>
          <p className="mt-2 text-leaf-900/65">{toCheckout ? "Sign in to finish your order." : "Sign in to your Foodpac account."}</p>
          <LoginForm key={email ?? ""} next={next} defaultEmail={email} />

          <div className="mt-8 rounded-2xl border border-leaf-950/10 bg-white p-4">
            <p className="text-sm font-semibold">New to Foodpac?</p>
            <p className="mt-0.5 text-sm text-leaf-900/65">Open a trade account to see your prices and order online.</p>
            <Link href="/register" className="mt-3 inline-flex h-10 items-center rounded-full border border-leaf-950/15 px-4 text-sm font-semibold hover:border-leaf-700/40">
              Open an account
            </Link>
          </div>

          {demo && (
            <div className="mt-4 rounded-2xl border border-dashed border-leaf-950/20 p-4 text-xs text-leaf-900/70">
              <p className="font-semibold text-leaf-950">Demo accounts · password demo1234</p>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {DEMO.map(([e, role]) => (
                  <Link
                    key={e}
                    href={`/login?email=${encodeURIComponent(e)}${next ? `&next=${encodeURIComponent(next)}` : ""}`}
                    className="rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-leaf-950/10 hover:ring-leaf-700/40"
                  >
                    <span className="block font-semibold text-leaf-950">{role}</span>
                    <span className="block truncate font-mono text-[11px]">{e}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
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
