import { and, eq } from "drizzle-orm";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { salesOrders } from "@/lib/db/schema";
import { aud } from "@/lib/money";
import { confirmCardReturn } from "@/lib/payments";

export const metadata: Metadata = { title: "Order placed" };

export default async function DonePage({ searchParams }: { searchParams: Promise<{ order?: string; session_id?: string; cancelled?: string }> }) {
  const sp = await searchParams;
  const viewer = await getCurrentCustomer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(`/checkout/done?order=${sp.order ?? ""}`)}`);
  if (!sp.order || !/^[0-9a-f-]{36}$/i.test(sp.order)) redirect("/portal/orders");
  const db = await getDb();
  if (sp.session_id) await confirmCardReturn(sp.order, sp.session_id).catch((e) => console.error(e));
  const [so] = await db
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.id, sp.order), eq(salesOrders.customerId, viewer.customer.id)))
    .limit(1);
  if (!so) redirect("/portal/orders");

  const paidOrConfirmed = so.status === "confirmed";
  const waitingCard = so.paymentMethod === "card" && so.paymentStatus !== "paid" && so.status === "pending";
  const Icon = paidOrConfirmed ? CheckCircle2 : waitingCard && !sp.cancelled ? Clock : XCircle;

  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
      <Icon className={`mx-auto size-14 ${paidOrConfirmed ? "animate-check text-leaf-600" : waitingCard && !sp.cancelled ? "text-amber-500" : "text-red-500"}`} />
      <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">
        {paidOrConfirmed ? "Thanks — your order is in" : sp.cancelled ? "Payment not completed" : waitingCard ? "Waiting for payment" : "Order cancelled"}
      </h1>
      <p className="mt-2 text-leaf-900/70">
        Order <span className="font-semibold">{so.number}</span> · {aud(so.totalCents)} · delivery {prettyDate(so.deliveryDate)}
      </p>
      <p className="mt-3 text-sm text-leaf-900/60">
        {paidOrConfirmed
          ? so.paymentMethod === "card"
            ? "Payment received. You can follow packing and delivery from your account."
            : so.paymentMethod === "bank_transfer"
              ? "Please pay by bank transfer using your order number as the reference."
              : "We'll invoice your account. You can follow packing and delivery from your account."
          : sp.cancelled
            ? "Your items are held for 30 minutes. Go back to your order to try paying again, or choose another payment method."
            : waitingCard
              ? "We're confirming your payment with the bank. This page updates when you refresh."
              : "This order was cancelled and the stock released."}
      </p>
      <div className="mt-8 flex justify-center gap-2">
        <Link href={`/portal/orders/${so.id}`} className="inline-flex h-11 items-center rounded-full bg-leaf-700 px-5 text-sm font-semibold text-white">
          View order
        </Link>
        <Link href="/products" className="inline-flex h-11 items-center rounded-full border border-leaf-950/15 bg-white px-5 text-sm font-semibold">
          Keep shopping
        </Link>
      </div>
    </main>
  );
}
