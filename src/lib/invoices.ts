import "server-only";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { DB } from "./db";
import { products, salesOrders } from "./db/schema";
import { productImageUrl } from "./product-image";
import { UserError } from "./planning";

// An order's invoice starts as a proforma: staff can still change lines, prices and delivery.
// Finalising it makes it the tax invoice (issued that day) and locks the order. Only a final
// invoice is emailed to the customer, together with a statement of what else they owe.

type SO = typeof salesOrders.$inferSelect;

/** Why this order's invoice can't be made final yet, or null if it can. */
export function finaliseBlocker(so: Pick<SO, "status" | "invoiceStatus">) {
  if (so.invoiceStatus === "final") return "The invoice is already final.";
  if (so.status === "cancelled") return "This order is cancelled.";
  if (so.status === "pending") return "Confirm the order before finalising its invoice.";
  return null;
}

/** Why a final invoice can't go back to proforma, or null if it can. */
export function reopenBlocker(so: Pick<SO, "status" | "invoiceStatus" | "paymentMethod" | "paymentStatus">) {
  if (so.invoiceStatus !== "final") return "The invoice is still a proforma.";
  if (so.status === "cancelled") return "This order is cancelled.";
  if (so.paymentMethod === "card") return "Card orders are paid up front, so their invoice stays final.";
  if (so.paymentStatus !== "unpaid") return "The invoice has been paid. Mark it unpaid first if it needs correcting.";
  return null;
}

/** Makes the invoice final: it becomes the tax invoice, issued now, and the order can't be changed. */
export async function finaliseInvoice(db: DB, salesOrderId: string, now = new Date()) {
  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, salesOrderId)).limit(1);
  if (!so) throw new UserError("Order not found.");
  const blocked = finaliseBlocker(so);
  if (blocked) throw new UserError(blocked);
  const [updated] = await db
    .update(salesOrders)
    .set({ invoiceStatus: "final", invoicedAt: now })
    .where(and(eq(salesOrders.id, so.id), eq(salesOrders.invoiceStatus, "proforma"), eq(salesOrders.status, "confirmed")))
    .returning();
  if (!updated) throw new UserError("The order changed while finalising. Reload and try again.");
  return updated;
}

/** Turns a final invoice back into a proforma so the order can be corrected. It gets a new issue date when finalised again. */
export async function reopenInvoice(db: DB, salesOrderId: string) {
  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, salesOrderId)).limit(1);
  if (!so) throw new UserError("Order not found.");
  const blocked = reopenBlocker(so);
  if (blocked) throw new UserError(blocked);
  const [updated] = await db
    .update(salesOrders)
    .set({ invoiceStatus: "proforma", invoicedAt: null, invoiceSentAt: null, invoiceSentTo: null })
    .where(and(eq(salesOrders.id, so.id), eq(salesOrders.invoiceStatus, "final"), eq(salesOrders.paymentStatus, "unpaid")))
    .returning();
  if (!updated) throw new UserError("The order changed while reopening. Reload and try again.");
  return updated;
}

/** A customer's open (final, unpaid) invoices, oldest first, with what's owing and overdue. */
export async function accountStatement(db: DB, customerId: string, today: string) {
  const open = await db
    .select({ id: salesOrders.id, number: salesOrders.number, invoicedAt: salesOrders.invoicedAt, dueDate: salesOrders.dueDate, totalCents: sql<number>`(${salesOrders.totalCents} - ${salesOrders.creditAppliedCents})::int` })
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.customerId, customerId),
        eq(salesOrders.invoiceStatus, "final"),
        eq(salesOrders.paymentStatus, "unpaid"),
        ne(salesOrders.status, "cancelled"),
        ne(salesOrders.paymentMethod, "card"),
      ),
    )
    .orderBy(asc(salesOrders.invoicedAt), asc(salesOrders.number));
  const invoices = open.map((r) => ({ ...r, overdue: !!r.dueDate && r.dueDate < today }));
  return {
    invoices,
    owingCents: invoices.reduce((t, r) => t + r.totalCents, 0),
    overdueCents: invoices.filter((r) => r.overdue).reduce((t, r) => t + r.totalCents, 0),
  };
}

/** Photo URLs for the invoice lines whose product has a photo (productId → URL). */
export async function invoiceImages(db: DB, items: { productId: string | null }[]) {
  const ids = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))];
  if (!ids.length) return {};
  const rows = await db
    .select({ id: products.id, updatedAt: products.updatedAt, hasImage: sql<boolean>`${products.image} is not null` })
    .from(products)
    .where(inArray(products.id, ids));
  return Object.fromEntries(rows.filter((r) => r.hasImage).map((r) => [r.id, productImageUrl(r)])) as Record<string, string>;
}
