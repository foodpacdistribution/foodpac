"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, PIPELINE, STAFF } from "@/lib/auth/dal";
import { addToList, removeFromList, setListQty } from "@/lib/customer-list";
import { getDb } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { aud, parseDollars } from "@/lib/money";
import { getSettings, UserError } from "@/lib/planning";
import { decidePriceMatch as decide, savePriceMatch as save, withdrawPriceMatch as withdraw } from "@/lib/price-match";
import { assertMayServe, takeOn } from "@/lib/rep-scope";
import { todayIn } from "@/lib/time";

function refresh(customerId: string) {
  revalidatePath(`/admin/customers/${customerId}`, "layout");
  revalidatePath("/admin/price-matches");
  revalidatePath("/admin", "layout");
}

const whole = (v: string) => {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n)) throw new UserError("Monthly quantity must be a whole number, e.g. 20.");
  return n;
};

/** What the price match form sends; amounts as typed ("21.50"). */
export type PriceMatchPayload = {
  customerId: string;
  productId: string;
  competitorPrice: string;
  competitor: string;
  price: string;
  monthlyQty: string;
  note: string;
};

export async function savePriceMatch(p: PriceMatchPayload) {
  return attempt<{ pending: boolean }>(async () => {
    const user = await assertUser(PIPELINE);
    const db = await getDb();
    const customerId = String(p.customerId ?? "");
    await assertMayServe(db, user, customerId);
    const competitorCents = parseDollars(p.competitorPrice);
    if (!competitorCents) throw new UserError("Enter what they pay now, e.g. 21.50.");
    const priceCents = parseDollars(p.price);
    if (!priceCents) throw new UserError("Enter the price you're offering, e.g. 20.90.");
    const today = todayIn((await getSettings(db)).timezone);
    const r = await save(
      db,
      user,
      { customerId, productId: String(p.productId ?? ""), competitorCents, competitor: p.competitor, priceCents, monthlyQty: whole(String(p.monthlyQty ?? "")), note: p.note },
      today,
    );
    await takeOn(db, user, customerId);
    refresh(customerId);
    return {
      message: r.pending ? `${r.product}: ${aud(priceCents)} sent to the office to approve` : `${r.product}: their price is now ${aud(priceCents)}`,
      data: { pending: r.pending },
    };
  });
}

/** Office: approve or turn down a price match waiting for it. */
export async function decidePriceMatch(id: string, approve: boolean) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    const r = await decide(await getDb(), user, id, approve);
    refresh(r.customerId);
    revalidatePath("/", "layout");
    return { message: approve ? `Approved: ${r.product}` : `Turned down: ${r.product}` };
  });
}

export async function withdrawPriceMatch(id: string) {
  return attempt(async () => {
    const user = await assertUser(PIPELINE);
    const r = await withdraw(await getDb(), user, id);
    refresh(r.customerId);
    return { message: "Price match withdrawn" };
  });
}

/** Admin: how low sales staff can go on their own, and how far under the competitor to suggest. */
export async function savePriceMatchRules(minMarginPct: number, beatPct: number) {
  return attempt(async () => {
    await assertUser(["admin"]);
    if (!Number.isInteger(minMarginPct) || minMarginPct < 0 || minMarginPct > 90) throw new UserError("Minimum margin must be a whole percent from 0 to 90.");
    if (!Number.isFinite(beatPct) || beatPct < 0 || beatPct > 50) throw new UserError("Beat by must be a percent from 0 to 50.");
    await (await getDb()).update(settings).set({ salesMinMarginPct: minMarginPct, priceMatchBeatPct: Math.round(beatPct * 10) / 10 }).where(eq(settings.id, 1));
    revalidatePath("/admin", "layout");
    return { message: "Saved" };
  });
}

// ---------------------------------------------------------------------------- the customer's list

export async function addListItems(customerId: string, items: { productId: string; qty: number | null }[]) {
  return attempt(async () => {
    const user = await assertUser(PIPELINE);
    const db = await getDb();
    await assertMayServe(db, user, customerId);
    const n = await addToList(db, user, customerId, Array.isArray(items) ? items.map((i) => ({ productId: String(i.productId), qty: i.qty === null ? null : Number(i.qty) })) : []);
    await takeOn(db, user, customerId);
    refresh(customerId);
    return { message: n === 1 ? "Added to their list" : `${n} products added to their list` };
  });
}

export async function setListItemQty(customerId: string, productId: string, qty: number | null) {
  return attempt(async () => {
    const user = await assertUser(PIPELINE);
    const db = await getDb();
    await assertMayServe(db, user, customerId);
    await setListQty(db, customerId, productId, qty);
    refresh(customerId);
    return { message: "Saved" };
  });
}

export async function removeListItem(customerId: string, productId: string) {
  return attempt(async () => {
    const user = await assertUser(PIPELINE);
    const db = await getDb();
    await assertMayServe(db, user, customerId);
    await removeFromList(db, customerId, productId);
    refresh(customerId);
    return { message: "Removed from their list" };
  });
}
