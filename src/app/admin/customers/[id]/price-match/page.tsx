import { eq } from "drizzle-orm";
import { ArrowLeft, Heart, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { T } from "@/components/i18n";
import Link from "@/components/link";
import { btn, PageHeader } from "@/components/ui";
import { PIPELINE, requireUser } from "@/lib/auth/dal";
import { listCounts } from "@/lib/customer-list";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { customerMatches, matchProducts } from "@/lib/price-match";
import { mayServe } from "@/lib/rep-scope";
import { todayIn } from "@/lib/time";
import { PriceMatchClient } from "./price-match-client";

export const metadata: Metadata = { title: "Price match" };

/**
 * At the store: what they pay their supplier now, product by product, and the price we offer.
 * Within the margin floor it's their price straight away; lower waits for the office.
 */
export default async function PriceMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser(PIPELINE);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [c] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!c || !mayServe(me, c)) notFound();
  const s = await getSettings(db);
  const office = me.role !== "sales";
  const [data, matches, counts] = await Promise.all([matchProducts(db, id, todayIn(s.timezone), office), customerMatches(db, id), listCounts(db, [id])]);
  const when = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const approved = matches.some((m) => m.status === "approved");

  return (
    <>
      <Link href={`/admin/customers/${c.id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> {c.name}
      </Link>
      <PageHeader
        title={<T vars={{ name: c.name }}>{"Price match · {name}"}</T>}
        subtitle={
          office
            ? "Type what they pay now and the price you offer. It becomes their price straight away and goes on their list."
            : "Type what they pay now and the price you offer. Down to the minimum margin it's their price straight away; lower goes to the office to approve. Every product goes on their list."
        }
        actions={
          <>
            <Link href={`/admin/customers/${c.id}/list`} className={btn("secondary")}>
              <Heart className="size-4" /> <T vars={{ n: counts.get(c.id) ?? 0 }}>{"Their list ({n})"}</T>
            </Link>
            {approved && (
              <Link href={`/admin/customers/${c.id}/price-match/sheet`} className={btn("primary")}>
                <ReceiptText className="size-4" /> <T>{"Savings sheet"}</T>
              </Link>
            )}
          </>
        }
      />
      <PriceMatchClient
        customerId={c.id}
        office={office}
        meId={me.id}
        beatPct={data.beatPct}
        minMarginPct={data.minMarginPct}
        products={data.products}
        matches={matches.map((m) => ({
          id: m.id,
          productId: m.productId,
          name: m.name,
          sku: m.sku,
          unit: m.unit,
          packSize: m.packSize,
          competitorCents: m.competitorCents,
          competitor: m.competitor,
          priceCents: m.priceCents,
          listCents: m.listCents,
          costCents: office ? m.costCents : null,
          monthlyQty: m.monthlyQty,
          note: m.note,
          status: m.status,
          mine: m.requestedBy === me.id,
          by: m.requestedByName,
          when: when.format(m.createdAt),
        }))}
      />
    </>
  );
}
