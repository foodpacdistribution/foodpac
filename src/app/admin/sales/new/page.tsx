import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { orderFormData } from "../form-data";
import { OrderForm } from "../order-form";

export const metadata: Metadata = { title: "New Order" };

/** ?customer= preselects who it's for; ?exchange= is a customer return whose credit pays for replacement goods. */
export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ customer?: string; exchange?: string }> }) {
  await requireUser(STAFF);
  const sp = await searchParams;
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const data = await orderFormData(await getDb());
  // A fresh key per form, so a double-click or a retry can't place the order twice.
  return <OrderForm mode="new" {...data} idempotencyKey={crypto.randomUUID()} initialCustomerId={uuid(sp.customer)} exchangeReturnId={uuid(sp.exchange)} />;
}
