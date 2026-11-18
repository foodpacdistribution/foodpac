"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, attempt } from "@/lib/action";
import { assertUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { addDocket, type DeliverResult, deliverDockets, type DocketPick, MAX_DOCKETS_AT_ONCE, removeDocket, searchForDocket, updateDocket } from "@/lib/dockets";
import { revalidateDriverPages } from "@/lib/driver-stops";
import { getSettings, UserError } from "@/lib/planning";
import { readUpload } from "@/lib/proofs";
import { todayIn } from "@/lib/time";

function refresh() {
  revalidatePath("/driver/dockets");
  revalidatePath("/admin/dockets");
}

/** One photographed invoice, read straight away. The phone sends a stack a few at a time. */
export async function uploadDocket(form: FormData): Promise<ActionResult<{ id: string }>> {
  return attempt(async () => {
    const user = await assertUser(["driver"]);
    const photo = await readUpload(form.get("photo"), "Photo");
    if (!photo) throw new UserError("Add a photo.");
    const db = await getDb();
    const s = await getSettings(db);
    const id = await addDocket(db, user, photo, todayIn(s.timezone));
    refresh();
    return { data: { id } };
  });
}

export async function saveDocket(id: string, f: { orderNumber: string; customerName: string; address: string; phone: string; customerId?: string | null }): Promise<ActionResult> {
  return attempt(async () => {
    const user = await assertUser(["driver"]);
    await updateDocket(await getDb(), user, id, f);
    refresh();
    return { message: "Saved" };
  });
}

/** Customers on file and today's deliveries matching what the driver typed, to pick instead of typing. */
export async function findForDocket(q: string): Promise<DocketPick[]> {
  await assertUser(["driver"]);
  const db = await getDb();
  const s = await getSettings(db);
  return searchForDocket(db, String(q ?? ""), todayIn(s.timezone));
}

export async function deleteDocket(id: string): Promise<ActionResult> {
  return attempt(async () => {
    const user = await assertUser(["driver"]);
    await removeDocket(await getDb(), user, id);
    refresh();
    return { message: "Deleted" };
  });
}

/** Adds the chosen invoices to the driver's deliveries for today. */
export async function deliverDocketsNow(ids: string[]): Promise<ActionResult<DeliverResult[]>> {
  return attempt(async () => {
    const user = await assertUser(["driver"]);
    if (!Array.isArray(ids) || !ids.length) throw new UserError("Choose the invoices to deliver.");
    if (ids.length > MAX_DOCKETS_AT_ONCE * 2) throw new UserError("Too many at once.");
    const db = await getDb();
    const s = await getSettings(db);
    const results = await deliverDockets(db, user, ids.map(String), todayIn(s.timezone));
    refresh();
    revalidateDriverPages();
    const added = results.filter((r) => r.ok).length;
    return { message: added ? `${added} added to today's deliveries` : undefined, data: results };
  });
}
