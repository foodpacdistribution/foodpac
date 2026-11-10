import type { Metadata } from "next";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { canSeePrices, listCatalog, usualItems } from "@/lib/shop";
import { OrderSheet } from "./order-sheet";
import { QuickOrderForm } from "./quick-order-form";
import { T } from "@/components/i18n";

export const metadata: Metadata = { title: "Quick order" };

export default async function QuickOrderPage() {
  const viewer = await getCurrentCustomer();
  if (!viewer) return null;
  if (!canSeePrices(viewer.customer)) {
    return (
      <>
        <h1 className="font-display text-2xl font-semibold tracking-tight"><T>{"Quick order"}</T></h1>
        <p className="mt-4 text-sm text-leaf-900/60"><T>{"Prices and ordering open as soon as your account is approved."}</T></p>
      </>
    );
  }
  const db = await getDb();
  const [usual, catalog] = await Promise.all([usualItems(db, viewer.customer), listCatalog(db, viewer.customer, { sort: "name", limit: 2000 })]);
  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight"><T>{"Quick order"}</T></h1>
      <p className="mt-1 text-sm text-leaf-900/60">
        <T>{"Fill in quantities for what you need this time, add anything else by name or code, then add it all to your cart."}</T>
      </p>
      {/* Descriptions aren't searched or shown here: leaving them out keeps a big range light. */}
      <OrderSheet usual={usual} catalog={catalog.map((p) => ({ ...p, description: "" }))} />
      <details className="group mt-8">
        <summary className="cursor-pointer text-sm font-semibold text-leaf-800 hover:text-leaf-950">
          <T>{"Or paste product codes and quantities"}</T>
        </summary>
        <p className="mt-2 text-sm text-leaf-900/60"><T>{"One SKU and quantity per line."}</T></p>
        <QuickOrderForm />
      </details>
    </>
  );
}
