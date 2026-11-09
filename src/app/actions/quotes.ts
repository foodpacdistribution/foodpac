"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { quotes } from "@/lib/db/schema";
import { parseDollars } from "@/lib/money";
import { sendQuote } from "@/lib/notify";
import { getSettings, UserError } from "@/lib/planning";
import { quoteEditBlocker, quoteWithItems, saveQuote as save } from "@/lib/quotes";
import { shiftDate } from "@/lib/dates";
import { QUOTE_VALID_DAYS } from "@/lib/quote-status";
import { todayIn } from "@/lib/time";

/** What the quote form sends. Checked again in lib/quotes.ts. */
export type QuotePayload = {
  customerId: string;
  validUntil: string;
  deliveryFee: string;
  notes: string;
  internalNote: string;
  lines: { productId: string; qty: number; unitPrice: string }[];
};

function revalidate(id?: string) {
  revalidatePath("/admin/quotes");
  if (id) revalidatePath(`/admin/quotes/${id}`);
}

function parse(p: QuotePayload) {
  const cents = (v: string, what: string) => {
    const n = parseDollars(String(v ?? "").trim() || "0");
    if (n === null) throw new UserError(`${what} must be an amount, e.g. 12.50.`);
    return n;
  };
  const text = (v: string, max: number) => String(v ?? "").trim().slice(0, max) || null;
  return {
    customerId: String(p.customerId ?? ""),
    validUntil: String(p.validUntil ?? ""),
    deliveryFeeCents: cents(p.deliveryFee, "Delivery fee"),
    notes: text(p.notes, 2000),
    internalNote: text(p.internalNote, 1000),
    lines: (Array.isArray(p.lines) ? p.lines : []).slice(0, 300).map((l) => ({ productId: String(l.productId), qty: Math.round(Number(l.qty)), unitPriceCents: cents(l.unitPrice, "Price") })),
  };
}

/** Creates a quote (id null) or saves changes to an open one. */
export async function saveQuote(id: string | null, p: QuotePayload) {
  return attempt<{ id: string }>(async () => {
    const user = await assertUser(STAFF);
    const db = await getDb();
    const s = await getSettings(db);
    const q = await save(db, user.id, id, parse(p), todayIn(s.timezone));
    revalidate(q.id);
    return { message: id ? `Quote ${q.number} saved` : `Quote ${q.number} created`, data: { id: q.id } };
  });
}

/** Records what happened with the quote: sent another way (e.g. handed over), declined, or back to draft. */
export async function setQuoteStatus(id: string, status: "draft" | "sent" | "declined") {
  return attempt(async () => {
    await assertUser(STAFF);
    if (!["draft", "sent", "declined"].includes(status)) throw new UserError("Unknown status.");
    const db = await getDb();
    const [q] = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
    if (!q) throw new UserError("Quote not found.");
    if (q.salesOrderId) throw new UserError("This quote has already become a sales order.");
    await db.update(quotes).set({ status, updatedAt: new Date() }).where(eq(quotes.id, id));
    revalidate(id);
    return { message: status === "declined" ? "Marked as declined" : status === "sent" ? "Marked as sent" : "Back to draft" };
  });
}

/** Emails the quote to the customer (a draft becomes "sent"). */
export async function emailQuote(id: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    const db = await getDb();
    const r = await sendQuote(db, id);
    if (!r.sent) throw new UserError(r.reason);
    revalidate(id);
    return { message: `Quote emailed to ${r.to}` };
  });
}

/** A new draft with the same customer, products and prices, valid for another month: for re-quoting. */
export async function copyQuote(id: string) {
  return attempt<{ id: string }>(async () => {
    const user = await assertUser(STAFF);
    const db = await getDb();
    const found = await quoteWithItems(db, id);
    if (!found) throw new UserError("Quote not found.");
    const s = await getSettings(db);
    const today = todayIn(s.timezone);
    const { quote: q, items } = found;
    const copy = await save(
      db,
      user.id,
      null,
      {
        customerId: q.customerId,
        validUntil: shiftDate(today, QUOTE_VALID_DAYS),
        deliveryFeeCents: q.deliveryFeeCents,
        notes: q.notes,
        internalNote: `Copied from ${q.number}`,
        // Products deleted since then are left out.
        lines: items.filter((it) => it.productId).map((it) => ({ productId: it.productId!, qty: it.qty, unitPriceCents: it.unitPriceCents })),
      },
      today,
    );
    revalidate(copy.id);
    return { message: `Copied to ${copy.number}`, data: { id: copy.id } };
  });
}

/** Deletes a quote. One that became an order can only be deleted by an admin (the order stays). */
export async function deleteQuote(id: string) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    const db = await getDb();
    const [q] = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
    if (!q) throw new UserError("Quote not found.");
    if (quoteEditBlocker(q) && user.role !== "admin") throw new UserError("Only an admin can delete a quote that became an order.");
    await db.delete(quotes).where(eq(quotes.id, id)); // its lines go with it
    revalidate();
    return { message: `Quote ${q.number} deleted` };
  });
}
