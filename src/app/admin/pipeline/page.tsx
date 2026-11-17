import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { PIPELINE, requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { listCounts } from "@/lib/customer-list";
import { customers as customerRows, customerVisits, users } from "@/lib/db/schema";
import { isMineToFollow, loadPipeline } from "@/lib/pipeline";
import { PipelineClient } from "./pipeline-client";

export const metadata: Metadata = { title: "Sales Pipeline" };

export default async function PipelinePage() {
  const me = await requireUser(PIPELINE);
  const db = await getDb();
  const weekAgo = sql`now() - interval '7 days'`;
  const [{ today, quietDays, customers }, reps, logins, [week]] = await Promise.all([
    loadPipeline(db),
    db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.role, ["sales", "admin", "dispatcher"])),
    db.select({ customerId: users.customerId, email: users.email, name: users.name }).from(users).where(eq(users.role, "customer")),
    // This person's last seven days, for the line at the top.
    db
      .select({
        visits: sql<number>`(select count(*)::int from ${customerVisits} where ${customerVisits.userId} = ${me.id} and ${customerVisits.createdAt} > ${weekAgo})`,
        won: sql<number>`count(*)::int`,
      })
      .from(customerRows)
      .where(and(eq(customerRows.salesRepId, me.id), eq(customerRows.salesStage, "won"), gte(customerRows.salesStageAt, weekAgo))),
  ]);
  const lists = await listCounts(db, customers.map((c) => c.id));
  const repName = new Map(reps.map((r) => [r.id, r.name]));
  const loginOf = new Map(logins.map((l) => [l.customerId, { email: l.email, name: l.name }]));
  return (
    <PipelineClient
      me={{ id: me.id, role: me.role }}
      today={today}
      quietDays={quietDays}
      week={me.role === "sales" || week.visits > 0 ? week : null}
      customers={customers.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        address: c.address,
        abn: c.abn,
        active: c.active,
        approved: c.approved,
        paymentTerms: c.paymentTerms,
        creditLimitCents: c.creditLimitCents,
        login: loginOf.get(c.id) ?? null,
        listCount: lists.get(c.id) ?? 0,
        stage: c.stage,
        stageAt: c.stageAt.toISOString(),
        repId: c.repId,
        repName: c.repId ? (repName.get(c.repId) ?? null) : null,
        followUpOn: c.followUpOn,
        followUpNote: c.followUpNote,
        notNowReason: c.notNowReason,
        storeType: c.storeType,
        contactName: c.contactName,
        bestTime: c.bestTime,
        lastVisit: c.lastVisit,
        lastOrderOn: c.lastOrderOn,
        due: c.due,
        dueForMe: !!c.due && isMineToFollow(me, c.repId),
      }))}
    />
  );
}
