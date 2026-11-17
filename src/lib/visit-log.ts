import "server-only";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { CurrentUser } from "./auth/dal";
import type { DB } from "./db";
import { customers, customerVisitPhotos, customerVisits, type NotNowReason, type SalesStage, users, type VisitOutcome } from "./db/schema";
import { UserError } from "./planning";
import { assertMayServe } from "./rep-scope";
import { followUpNoteFor, MAX_VISIT_PHOTOS, stageAfter } from "./visits";

type Who = Pick<CurrentUser, "id" | "role">;

export type VisitInput = {
  customerId: string;
  channel: "visit" | "call";
  outcome: VisitOutcome;
  note: string;
  /** Required for "not now". */
  reason: NotNowReason | null;
  /** The next reminder (today or later), or null for none. */
  followUpOn: string | null;
  lat: number | null;
  lng: number | null;
  photos: { mime: string; data: Uint8Array }[];
};

/**
 * Records a visit and, in the same go, moves the customer along: the stage the result implies,
 * the next reminder (replacing any earlier one), "last contacted" now, and the reason when they
 * said not now. A salesperson logging a visit for a customer nobody looks after takes it on.
 */
export async function recordVisit(db: DB, user: Who, input: VisitInput, today: string) {
  await assertMayServe(db, user, input.customerId);
  if (input.followUpOn !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(input.followUpOn) || Number.isNaN(Date.parse(input.followUpOn)))) throw new UserError("Pick a date.");
  if (input.followUpOn !== null && input.followUpOn < today) throw new UserError("Pick today or a later date.");
  if (input.outcome === "not_now" && !input.reason) throw new UserError("Choose why they said no.");
  const located = input.channel === "visit" && Number.isFinite(input.lat) && Number.isFinite(input.lng);

  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({ stage: customers.salesStage, rep: customers.salesRepId, name: customers.name })
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .for("update")
      .limit(1);
    if (!c) throw new UserError("Customer not found.");
    const stage = stageAfter(input.outcome, c.stage);
    const [visit] = await tx
      .insert(customerVisits)
      .values({
        customerId: input.customerId,
        userId: user.id,
        channel: input.channel,
        outcome: input.outcome,
        note: input.note.trim().slice(0, 2000) || null,
        lat: located ? input.lat : null,
        lng: located ? input.lng : null,
      })
      .returning({ id: customerVisits.id });
    const photos = input.photos.slice(0, MAX_VISIT_PHOTOS);
    if (photos.length) await tx.insert(customerVisitPhotos).values(photos.map((p) => ({ visitId: visit.id, mime: p.mime, bytes: p.data.byteLength, data: p.data })));
    await tx
      .update(customers)
      .set({
        contactedAt: new Date(),
        followUpOn: input.followUpOn,
        followUpNote: input.followUpOn ? followUpNoteFor(input.outcome, input.note, input.reason) : null,
        ...(stage !== c.stage ? { salesStage: stage, salesStageAt: new Date() } : {}),
        // The reason stays while they're "not now", and goes once they move on.
        notNowReason: stage === "not_now" ? (input.outcome === "not_now" ? input.reason : sql`${customers.notNowReason}`) : null,
        ...(user.role === "sales" && !c.rep ? { salesRepId: user.id } : {}),
      })
      .where(eq(customers.id, input.customerId));
    return { visitId: visit.id, name: c.name, stage, from: c.stage as SalesStage };
  });
}

/** Deletes a visit logged by mistake: the person who logged it, or an admin. */
export async function removeVisit(db: DB, user: Who, visitId: string) {
  const [v] = await db.select({ userId: customerVisits.userId, customerId: customerVisits.customerId }).from(customerVisits).where(eq(customerVisits.id, visitId)).limit(1);
  if (!v) throw new UserError("That visit is already gone.");
  if (user.role !== "admin" && v.userId !== user.id) throw new UserError("Only the person who logged a visit (or an admin) can delete it.");
  await db.delete(customerVisits).where(eq(customerVisits.id, visitId));
  return v.customerId;
}

export type VisitRow = {
  id: string;
  at: string;
  channel: "visit" | "call";
  outcome: VisitOutcome;
  note: string | null;
  userId: string | null;
  by: string | null;
  located: boolean;
  photoIds: string[];
};

/** A customer's visits, newest first, with who logged them and their photo ids (not the photos). */
export async function customerVisitList(db: DB, customerId: string, limit = 200): Promise<VisitRow[]> {
  const rows = await db
    .select({
      id: customerVisits.id,
      at: customerVisits.createdAt,
      channel: customerVisits.channel,
      outcome: customerVisits.outcome,
      note: customerVisits.note,
      userId: customerVisits.userId,
      by: users.name,
      lat: customerVisits.lat,
    })
    .from(customerVisits)
    .leftJoin(users, eq(users.id, customerVisits.userId))
    .where(eq(customerVisits.customerId, customerId))
    .orderBy(desc(customerVisits.createdAt))
    .limit(limit);
  const photos = rows.length
    ? await db
        .select({ id: customerVisitPhotos.id, visitId: customerVisitPhotos.visitId })
        .from(customerVisitPhotos)
        .where(inArray(customerVisitPhotos.visitId, rows.map((r) => r.id)))
        .orderBy(customerVisitPhotos.createdAt)
    : [];
  return rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    channel: r.channel,
    outcome: r.outcome,
    note: r.note,
    userId: r.userId,
    by: r.by,
    located: r.lat !== null,
    photoIds: photos.filter((p) => p.visitId === r.id).map((p) => p.id),
  }));
}

/** A customer's latest visit; `day` is in the business's time zone. */
export type LastVisit = { day: string; outcome: VisitOutcome; note: string | null; channel: "visit" | "call" };

/** Each customer's latest visit, for the pipeline. */
export async function lastVisits(db: DB, timeZone: string) {
  const rows = await db
    .selectDistinctOn([customerVisits.customerId], {
      customerId: customerVisits.customerId,
      day: sql<string>`(${customerVisits.createdAt} at time zone ${timeZone})::date::text`,
      outcome: customerVisits.outcome,
      note: customerVisits.note,
      channel: customerVisits.channel,
    })
    .from(customerVisits)
    .orderBy(customerVisits.customerId, desc(customerVisits.createdAt));
  return new Map<string, LastVisit>(rows.map((r) => [r.customerId, { day: r.day, outcome: r.outcome, note: r.note, channel: r.channel }]));
}

/** One visit photo and whose visit it was (the caller checks who may see it). */
export async function visitPhoto(db: DB, photoId: string) {
  const [p] = await db
    .select({ mime: customerVisitPhotos.mime, bytes: customerVisitPhotos.bytes, data: customerVisitPhotos.data, customerId: customerVisits.customerId })
    .from(customerVisitPhotos)
    .innerJoin(customerVisits, eq(customerVisits.id, customerVisitPhotos.visitId))
    .where(eq(customerVisitPhotos.id, photoId))
    .limit(1);
  return p ?? null;
}
