import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { quoteWithItems } from "@/lib/quotes";
import { orderFormData } from "../form-data";
import { OrderForm } from "../order-form";

export const metadata: Metadata = { title: "New Order" };

/**
 * ?customer= preselects who it's for; ?exchange= is a customer return whose credit pays for
 * replacement goods; ?quote= is an accepted quote whose lines and prices become the order.
 */
export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ customer?: string; exchange?: string; quote?: string }> }) {
  await requireUser(STAFF);
  const sp = await searchParams;
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const db = await getDb();
  const quoteId = uuid(sp.quote);
  const found = quoteId ? await quoteWithItems(db, quoteId) : null;
  // The quote's customer is offered even if they've since been made inactive.
  const data = await orderFormData(db, found ? { customerId: found.quote.customerId } : {});
  // A quote that already became an order isn't offered again (the server refuses it too).
  const quote =
    found && !found.quote.salesOrderId
      ? {
          id: found.quote.id,
          number: found.quote.number,
          customerId: found.quote.customerId,
          deliveryFeeCents: found.quote.deliveryFeeCents,
          lines: found.items.filter((it) => it.productId).map((it) => ({ productId: it.productId!, qty: it.qty, unitPriceCents: it.unitPriceCents })),
        }
      : undefined;
  // A fresh key per form, so a double-click or a retry can't place the order twice.
  return <OrderForm mode="new" {...data} idempotencyKey={crypto.randomUUID()} initialCustomerId={uuid(sp.customer)} exchangeReturnId={uuid(sp.exchange)} quote={quote} />;
}
