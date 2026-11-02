import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/dal";
import { homeFor } from "@/lib/auth/session";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Open a trade account" };

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));
  return (
    <main className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-tomato">Trade account</p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Open a Foodpac account</h1>
        <p className="mt-3 text-leaf-900/70">For cafés, restaurants, takeaways, caterers and food businesses. Once we approve your account you&apos;ll see your prices and can order online.</p>
        <ul className="mt-6 space-y-2 text-sm text-leaf-900/80">
          <li>• Your own price list</li>
          <li>• Order by the carton, re-order in one click</li>
          <li>• Live delivery tracking with photo and signature proof</li>
          <li>• Invoice terms for approved accounts</li>
        </ul>
      </div>
      <RegisterForm />
    </main>
  );
}
