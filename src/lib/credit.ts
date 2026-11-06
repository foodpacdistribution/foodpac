import "server-only";
import { and, desc, eq, ne } from "drizzle-orm";
import type { DB } from "./db";
import { creditTransactionNo, type CreditTransactionType, customerCreditAccounts, customerCreditTransactions, salesOrders, users } from "./db/schema";
import { UserError } from "./planning";
import { guarded, nextNumber } from "./purchasing/common";

// Store credit: a customer's wallet. The balance lives on customer_credit_accounts but only moves
// when a row goes into customer_credit_transactions; a database trigger locks the account, checks
// it can't go below zero and writes balance before/after (see migration 0021). Mistakes are fixed
// with a reversal, never by editing history. Credit doesn't expire.

export type CreditEntry = {
  customerId: string;
  type: CreditTransactionType;
  /** Dollars, signed: + gives credit, − uses or takes it back. */
  amount: number;
  sourceType: "customer_return" | "sales_order" | "manual";
  sourceId?: string | null;
  sourceNumber?: string | null;
  description?: string | null;
  by?: string | null;
};

export async function postCredit(db: DB, e: CreditEntry) {
  return guarded(async () => {
    const [row] = await db
      .insert(customerCreditTransactions)
      .values({
        transactionNumber: nextNumber("CT-", creditTransactionNo.seqName!),
        customerId: e.customerId,
        transactionType: e.type,
        amount: Math.round(e.amount * 100) / 100,
        sourceType: e.sourceType,
        sourceId: e.sourceId ?? null,
        sourceNumber: e.sourceNumber ?? null,
        description: e.description ?? null,
        createdBy: e.by ?? null,
      })
      .returning();
    return row;
  });
}

/** Available store credit in dollars (0 for a customer who never had any). */
export async function creditBalance(db: DB, customerId: string) {
  const [a] = await db.select({ balance: customerCreditAccounts.balance }).from(customerCreditAccounts).where(eq(customerCreditAccounts.customerId, customerId)).limit(1);
  return a?.balance ?? 0;
}

export async function creditAccount(db: DB, customerId: string) {
  const [a] = await db.select().from(customerCreditAccounts).where(eq(customerCreditAccounts.customerId, customerId)).limit(1);
  return a ?? { balance: 0, totalIssued: 0, totalUsed: 0 };
}

export async function creditHistory(db: DB, customerId: string, limit = 200) {
  const rows = await db
    .select({ t: customerCreditTransactions, by: users.name })
    .from(customerCreditTransactions)
    .leftJoin(users, eq(users.id, customerCreditTransactions.createdBy))
    .where(eq(customerCreditTransactions.customerId, customerId))
    .orderBy(desc(customerCreditTransactions.createdAt), desc(customerCreditTransactions.transactionNumber))
    .limit(limit);
  return rows.map((r) => ({ ...r.t, by: r.by }));
}

/**
 * Pays (part of) an order with the customer's store credit. Call inside the transaction that
 * creates or changes the order, so a failure leaves neither. Caps at what's still due; an order
 * fully covered is marked paid.
 */
export async function applyCreditToOrder(tx: DB, salesOrderId: string, cents: number, by: string | null) {
  if (!Number.isInteger(cents) || cents <= 0) return 0;
  const [so] = await tx.select().from(salesOrders).where(eq(salesOrders.id, salesOrderId)).for("update");
  if (!so) throw new UserError("Order not found.");
  if (so.status === "cancelled") throw new UserError("This order is cancelled.");
  if (so.paymentStatus !== "unpaid") throw new UserError("This order is already paid.");
  const due = so.totalCents - so.creditAppliedCents;
  const use = Math.min(cents, due);
  if (use <= 0) throw new UserError("Nothing left to pay on this order.");
  await postCredit(tx, { customerId: so.customerId, type: "order_redemption", amount: -use / 100, sourceType: "sales_order", sourceId: so.id, sourceNumber: so.number, description: "Used on order", by });
  const applied = so.creditAppliedCents + use;
  await tx
    .update(salesOrders)
    .set({ creditAppliedCents: applied, ...(applied >= so.totalCents ? { paymentStatus: "paid" as const, paidAt: new Date() } : {}) })
    .where(eq(salesOrders.id, so.id));
  return use;
}

/** Gives back credit an order no longer needs: it was cancelled (all of it) or its total dropped below what credit paid. */
export async function releaseOrderCredit(tx: DB, so: { id: string; number: string; customerId: string; creditAppliedCents: number }, keepCents: number, why: string, by: string | null) {
  const back = so.creditAppliedCents - Math.max(0, keepCents);
  if (back <= 0) return 0;
  await postCredit(tx, { customerId: so.customerId, type: "redemption_reversal", amount: back / 100, sourceType: "sales_order", sourceId: so.id, sourceNumber: so.number, description: why, by });
  await tx.update(salesOrders).set({ creditAppliedCents: so.creditAppliedCents - back }).where(and(eq(salesOrders.id, so.id), ne(salesOrders.creditAppliedCents, 0)));
  return back;
}

/** Admin: give credit (goodwill, promotion) or take back credit given by mistake. A reason is required. */
export async function adjustCredit(db: DB, adminId: string, customerId: string, kind: "manual_credit" | "promotion_credit" | "credit_reversal", amount: number, reason: string) {
  if (!reason.trim()) throw new UserError("Say why the credit is changing.");
  if (!(amount > 0)) throw new UserError("Enter an amount.");
  return postCredit(db, { customerId, type: kind, amount: kind === "credit_reversal" ? -amount : amount, sourceType: "manual", description: reason.trim(), by: adminId });
}
