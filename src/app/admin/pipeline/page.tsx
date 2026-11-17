import { eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { PIPELINE, requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { listCounts } from "@/lib/customer-list";
import { users } from "@/lib/db/schema";
import { isMineToFollow, loadPipeline } from "@/lib/pipeline";
import { PipelineClient } from "./pipeline-client";

export const metadata: Metadata = { title: "Sales Pipeline" };

export default async function PipelinePage() {
  const me = await requireUser(PIPELINE);
  const db = await getDb();
  const [{ today, quietDays, customers }, reps, logins] = await Promise.all([
    loadPipeline(db),
    db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.role, ["sales", "admin", "dispatcher"])),
    db.select({ customerId: users.customerId, email: users.email, name: users.name }).from(users).where(eq(users.role, "customer")),
  ]);
  const lists = await listCounts(db, customers.map((c) => c.id));
  const repName = new Map(reps.map((r) => [r.id, r.name]));
  const loginOf = new Map(logins.map((l) => [l.customerId, { email: l.email, name: l.name }]));
  return (
    <PipelineClient
      me={{ id: me.id, role: me.role }}
      today={today}
      quietDays={quietDays}
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
        lastOrderOn: c.lastOrderOn,
        due: c.due,
        dueForMe: !!c.due && isMineToFollow(me, c.repId),
      }))}
    />
  );
}
