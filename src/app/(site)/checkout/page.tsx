import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customerAddresses } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { allowedMethods, canSeePrices, deliveryDates, getCart, openBalance, quote } from "@/lib/shop";
import { stripeEnabled } from "@/lib/stripe";
import { CheckoutForm } from "./checkout-form";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const viewer = await getCurrentCustomer();
  if (!viewer) redirect("/login?next=%2Fcart");
  const { customer: c, user } = viewer;
  const db = await getDb();
  const [lines, s, addresses, balance] = await Promise.all([
    getCart(db, c),
    getSettings(db),
    db.select().from(customerAddresses).where(eq(customerAddresses.customerId, c.id)).orderBy(asc(customerAddresses.createdAt)),
    openBalance(db, c.id),
  ]);
  if (!lines.length || lines.some((l) => l.issue) || !canSeePrices(c)) redirect("/cart");
  const q = quote(lines, s);
  if (q.belowMinimum) redirect("/cart");

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Checkout</h1>
      <CheckoutForm
        idempotencyKey={crypto.randomUUID()}
        lines={lines.map((l) => ({ id: l.id, name: l.name, sku: l.sku, qty: l.qty, unit: l.unit, lineCents: l.lineCents }))}
        quote={q}
        dates={deliveryDates(s)}
        methods={allowedMethods(c, stripeEnabled())}
        terms={c.paymentTerms}
        creditLeftCents={c.creditLimitCents === null ? null : c.creditLimitCents - balance}
        bankDetails={s.bankDetails}
        addresses={addresses.map((a) => ({ id: a.id, label: a.label, recipient: a.recipient, phone: a.phone, address: a.address, instructions: a.instructions }))}
        defaults={{ recipient: user.name, phone: c.phone ?? "", address: c.address ?? "" }}
      />
    </main>
  );
}
