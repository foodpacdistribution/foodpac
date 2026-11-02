import type { Metadata } from "next";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { recentlyBought } from "@/lib/shop";
import { ProductCard } from "@/app/(site)/shop-ui";
import { QuickOrderForm } from "./quick-order-form";
import { T } from "@/components/i18n";

export const metadata: Metadata = { title: "Quick order" };

export default async function QuickOrderPage() {
  const viewer = await getCurrentCustomer();
  if (!viewer) return null;
  const recent = await recentlyBought(await getDb(), viewer.customer, 8);
  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight"><T>{"Quick order"}</T></h1>
      <p className="mt-1 text-sm text-leaf-900/60"><T>{"Know your codes? Add everything in one go — one SKU and quantity per line."}</T></p>
      <QuickOrderForm />
      {recent.length > 0 && (
        <>
          <h2 className="mt-10 text-xs font-semibold uppercase tracking-[0.14em] text-leaf-900/50"><T>{"Bought before"}</T></h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recent.map((p) => (
              <ProductCard key={p.id} p={p} signedIn />
            ))}
          </div>
        </>
      )}
    </>
  );
}
