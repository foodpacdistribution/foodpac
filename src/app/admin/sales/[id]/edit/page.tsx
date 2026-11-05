import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { Card } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { orders, salesOrders } from "@/lib/db/schema";
import { editBlocker } from "@/lib/staff-orders";
import { orderFormData, reservedBy } from "../../form-data";
import { OrderForm } from "../../order-form";

export const metadata: Metadata = { title: "Edit Order" };

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(STAFF);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, id)).limit(1);
  if (!so) notFound();
  const [d] = so.deliveryOrderId ? await db.select({ status: orders.status }).from(orders).where(eq(orders.id, so.deliveryOrderId)).limit(1) : [];
  const blocked = editBlocker(so, d?.status ?? null);
  if (blocked) {
    return (
      <>
        <Link href={`/admin/sales/${so.id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="size-4" /> <T>{"Order"}</T> {so.number}
        </Link>
        <Card className="p-6 text-sm text-slate-600">
          <Tx>{blocked}</Tx>
        </Card>
      </>
    );
  }
  const [data, { items, reserved }] = await Promise.all([orderFormData(db, { customerId: so.customerId }), reservedBy(db, so.id)]);
  // "Already waiting" means other customers: leave out this order's own waiting units.
  const own = (productId: string) => items.filter((it) => it.productId === productId).reduce((n, it) => n + it.backorderQty, 0);
  return (
    <OrderForm
      mode="edit"
      {...data}
      products={data.products.map((p) => ({ ...p, waiting: Math.max(0, p.waiting - own(p.id)) }))}
      order={{
        id: so.id,
        number: so.number,
        customerId: so.customerId,
        deliveryDate: so.deliveryDate,
        recipient: so.recipient,
        phone: so.phone,
        address: so.address,
        instructions: so.instructions,
        windowStartMin: so.windowStartMin,
        windowEndMin: so.windowEndMin,
        notes: so.notes,
        deliveryFeeCents: so.deliveryFeeCents,
        lines: items.filter((it) => it.productId).map((it) => ({ productId: it.productId!, qty: it.qty, unitPriceCents: it.unitPriceCents })),
        reserved,
      }}
    />
  );
}
