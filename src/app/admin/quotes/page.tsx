import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customers, quoteItems, quotes, salesOrders } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { quoteState } from "@/lib/quote-status";
import { todayIn } from "@/lib/time";
import { QuotesClient } from "./quotes-client";

export const metadata: Metadata = { title: "Quotations" };

const VIEWS = ["open", "accepted", "closed", "all"] as const;

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  await requireUser(STAFF);
  const sp = await searchParams;
  const view = VIEWS.find((v) => v === sp.view) ?? "open";
  const db = await getDb();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const q = (sp.q ?? "").trim().slice(0, 100);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const open = and(inArray(quotes.status, ["draft", "sent"]), gte(quotes.validUntil, today));
  const where = and(
    view === "open"
      ? open
      : view === "accepted"
        ? eq(quotes.status, "accepted")
        : view === "closed"
          ? or(eq(quotes.status, "declined"), and(inArray(quotes.status, ["draft", "sent"]), lt(quotes.validUntil, today)))
          : undefined,
    q ? or(ilike(quotes.number, like), ilike(customers.name, like), ilike(customers.code, like)) : undefined,
  );
  const [rows, [stats]] = await Promise.all([
    db
      .select({
        q: quotes,
        customer: customers.name,
        code: customers.code,
        order: salesOrders.number,
        lines: sql<number>`(select count(*)::int from ${quoteItems} qi where qi.quote_id = ${quotes}.id)`,
      })
      .from(quotes)
      .innerJoin(customers, eq(customers.id, quotes.customerId))
      .leftJoin(salesOrders, eq(salesOrders.id, quotes.salesOrderId))
      .where(where)
      .orderBy(desc(quotes.createdAt))
      .limit(300),
    db
      .select({
        openCount: sql<number>`count(*) filter (where ${open})::int`,
        openCents: sql<number>`coalesce(sum(${quotes.totalCents}) filter (where ${open}), 0)::int`,
        // Of the quotes made in the last 90 days that are decided (accepted or declined), how many were accepted.
        accepted90: sql<number>`count(*) filter (where ${quotes.status} = 'accepted' and ${quotes.createdAt} > now() - interval '90 days')::int`,
        decided90: sql<number>`count(*) filter (where ${quotes.status} in ('accepted', 'declined') and ${quotes.createdAt} > now() - interval '90 days')::int`,
      })
      .from(quotes),
  ]);
  return (
    <QuotesClient
      view={view}
      q={q}
      stats={stats}
      rows={rows.map((r) => ({
        id: r.q.id,
        number: r.q.number,
        customer: r.customer,
        code: r.code,
        createdAt: r.q.createdAt.toISOString(),
        validUntil: r.q.validUntil,
        totalCents: r.q.totalCents,
        lines: r.lines,
        state: quoteState(r.q, today),
        order: r.order && r.q.salesOrderId ? { id: r.q.salesOrderId, number: r.order } : null,
      }))}
    />
  );
}
