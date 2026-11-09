import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/dal";
import { homeFor } from "@/lib/auth/session";
import { RegisterForm } from "./register-form";
import { T } from "@/components/i18n";

const registerDescription =
  "Open a free trade account for your café, restaurant or takeaway: your own trade prices, order online any time, and planned weekday delivery across South East Queensland.";
export const metadata: Metadata = {
  title: "Open a trade account",
  description: registerDescription,
  alternates: { canonical: "/register" },
  openGraph: { title: "Open a trade account · Foodpac Distribution", description: registerDescription, url: "/register" },
};

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));
  return (
    <main className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-tomato"><T>{"Trade account"}</T></p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight"><T>{"Open a Foodpac account"}</T></h1>
        <p className="mt-3 text-leaf-900/70"><T>{"For cafés, restaurants, takeaways, caterers and food businesses. Once we approve your account you'll see your prices and can order online."}</T></p>
        <ul className="mt-6 space-y-2 text-sm text-leaf-900/80">
          <li><T>{"• Your own price list"}</T></li>
          <li><T>{"• Order by the carton, re-order in one click"}</T></li>
          <li><T>{"• Live delivery tracking with photo and signature proof"}</T></li>
          <li><T>{"• Invoice terms for approved accounts"}</T></li>
        </ul>
      </div>
      <RegisterForm />
    </main>
  );
}
