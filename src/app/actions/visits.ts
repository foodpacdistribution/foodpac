"use server";

import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, PIPELINE } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import type { SalesStage } from "@/lib/db/schema";
import { getSettings, UserError } from "@/lib/planning";
import { readUpload } from "@/lib/proofs";
import { STAGE_INFO } from "@/lib/sales-stage";
import { todayIn } from "@/lib/time";
import { recordVisit, removeVisit } from "@/lib/visit-log";
import { isNotNowReason, isVisitOutcome, MAX_VISIT_PHOTOS } from "@/lib/visits";

function refresh(customerId: string) {
  revalidatePath("/admin/pipeline");
  revalidatePath("/admin/customers");
  revalidatePath("/admin/customer-map");
  revalidatePath(`/admin/customers/${customerId}`);
}

/**
 * Logs a visit (or call) from the form: result, note, photos (already shrunk on the phone),
 * where the phone was, and the next reminder. See recordVisit for what it changes.
 */
export async function logVisit(form: FormData) {
  return attempt<{ stage: SalesStage; followUpOn: string | null }>(async () => {
    const user = await assertUser(PIPELINE);
    const db = await getDb();
    const get = (k: string) => String(form.get(k) ?? "").trim();
    const outcome = get("outcome");
    if (!isVisitOutcome(outcome)) throw new UserError("Choose how it went.");
    const reason = get("reason");
    const num = (k: string) => (get(k) ? Number(get(k)) : null);
    const files = form.getAll("photo").slice(0, MAX_VISIT_PHOTOS);
    const photos = [];
    for (const f of files) {
      const p = await readUpload(f, "Photo");
      if (p) photos.push(p);
    }
    const today = todayIn((await getSettings(db)).timezone);
    const followUpOn = get("followUpOn") || null;
    const r = await recordVisit(
      db,
      user,
      {
        customerId: get("customerId"),
        channel: get("channel") === "call" ? "call" : "visit",
        outcome,
        note: get("note"),
        reason: isNotNowReason(reason) ? reason : null,
        followUpOn,
        lat: num("lat"),
        lng: num("lng"),
        photos,
      },
      today,
    );
    refresh(get("customerId"));
    const moved = r.stage !== r.from ? ` · ${STAGE_INFO[r.stage].label}` : "";
    return { message: `Visit saved: ${r.name}${moved}`, data: { stage: r.stage, followUpOn } };
  });
}

/** Deletes a visit logged by mistake. */
export async function deleteVisit(visitId: string) {
  return attempt(async () => {
    const user = await assertUser(PIPELINE);
    const customerId = await removeVisit(await getDb(), user, visitId);
    refresh(customerId);
    return { message: "Visit deleted" };
  });
}
