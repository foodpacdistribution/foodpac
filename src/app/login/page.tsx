import { Route as RouteIcon } from "lucide-react";
import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  const demo = !process.env.DATABASE_URL;
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-blue-600">
            <RouteIcon className="size-5" />
          </span>
          <span className="font-semibold tracking-tight">AI Delivery Planner</span>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            Turn today&apos;s orders into routes your drivers can run.
          </h1>
          <p className="mt-4 text-slate-300">
            Import orders, verify addresses, optimise multi-driver routes with real road times, and dispatch to phones — in minutes.
          </p>
        </div>
        <svg className="absolute -right-24 bottom-0 h-[70%] opacity-30" viewBox="0 0 400 400" fill="none" aria-hidden>
          <path d="M40 360 C 120 300, 80 220, 170 200 S 300 160, 260 80 S 330 20, 380 40" stroke="#60a5fa" strokeWidth="4" strokeDasharray="2 10" strokeLinecap="round" />
          <path d="M20 250 C 90 240, 140 300, 210 280 S 320 300, 380 220" stroke="#f472b6" strokeWidth="4" strokeDasharray="2 10" strokeLinecap="round" />
          {[[40, 360], [170, 200], [260, 80], [380, 40], [20, 250], [210, 280], [380, 220]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="9" fill="#0d1b30" stroke="white" strokeWidth="3" />
          ))}
        </svg>
        <p className="relative z-10 text-xs text-slate-400">Routing © OpenStreetMap contributors · OSRM</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Dispatchers and drivers use the same login.</p>
          <LoginForm />
          {demo && (
            <div className="mt-6 rounded-lg border border-dashed border-line bg-white p-3 text-xs text-slate-600">
              <p className="font-medium text-slate-800">Local demo accounts (password demo1234)</p>
              <ul className="mt-1.5 space-y-0.5 font-mono">
                <li>admin@demo.local — admin</li>
                <li>dispatch@demo.local — dispatcher</li>
                <li>john@demo.local — driver</li>
              </ul>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
