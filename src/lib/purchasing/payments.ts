import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "../db";
import { purchaseOrders, supplierPaymentNo, supplierPayments, type SupplierPayMethod } from "../db/schema";
import { UserError } from "../planning";
import { guarded, nextNumber } from "./common";
import { toCents } from "./labels";
import { paidByPo } from "./orders";

export type PaymentInput = { purchaseOrderId: string; paymentDate: string; amount: number; method: SupplierPayMethod; reference: string | null; notes: string | null };

/**
 * Money paid to a supplier for a purchase order. Suppliers give no credit, so there are no terms
 * or balances carried forward: a payment is recorded against an order and can't exceed what's left.
 */
export async function recordPayment(db: DB, userId: string, input: PaymentInput) {
  if (!(input.amount > 0)) throw new UserError("Enter the amount paid.");
  return guarded(() =>
    db.transaction(async (t) => {
      const tx = t as unknown as DB;
      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, input.purchaseOrderId)).for("update");
      if (!po) throw new UserError("Purchase order not found.");
      if (po.status === "draft" || po.status === "cancelled") throw new UserError("Pay a purchase order once it has gone to the supplier.");
      const paid = (await paidByPo(tx, [po.id])).get(po.id) ?? 0;
      const left = (toCents(po.total) - toCents(paid)) / 100;
      if (toCents(input.amount) > toCents(left)) throw new UserError(`That's more than the ${left.toFixed(2)} left to pay on ${po.poNumber}.`);
      const [row] = await tx
        .insert(supplierPayments)
        .values({ paymentNumber: nextNumber("SP-", supplierPaymentNo.seqName!), supplierId: po.supplierId, ...input, createdBy: userId })
        .returning();
      return row;
    }),
  );
}
