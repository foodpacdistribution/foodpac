import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { orderFormData } from "../form-data";
import { OrderForm } from "../order-form";

export const metadata: Metadata = { title: "New Order" };

export default async function NewOrderPage() {
  await requireUser(STAFF);
  const data = await orderFormData(await getDb());
  // A fresh key per form, so a double-click or a retry can't place the order twice.
  return <OrderForm mode="new" {...data} idempotencyKey={crypto.randomUUID()} />;
}
