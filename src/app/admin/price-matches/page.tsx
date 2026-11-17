import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/planning";
import { pendingMatches } from "@/lib/price-match";
import { PriceMatchesClient } from "./price-matches-client";

export const metadata: Metadata = { title: "Price Matches" };

/** The office: price matches sales staff gave below the minimum margin (or with no cost known), to approve. */
export default async function PriceMatchesPage() {
  const me = await requireUser(STAFF);
  const db = await getDb();
  const [rows, s] = await Promise.all([pendingMatches(db), getSettings(db)]);
  const when = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <>
      <PageHeader title="Price Matches" subtitle="Prices sales staff offered below the minimum margin, or for products with no cost known. Approving one makes it the customer's price." />
      <PriceMatchesClient
        isAdmin={me.role === "admin"}
        rules={{ minMarginPct: s.salesMinMarginPct, beatPct: s.priceMatchBeatPct }}
        matches={rows.map((m) => ({
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
          costCents: m.costCents,
          monthlyQty: m.monthlyQty,
          note: m.note,
          status: m.status,
          mine: m.requestedBy === me.id,
          by: m.requestedByName,
          when: when.format(m.createdAt),
          customer: { id: m.customerId, name: m.customer, code: m.customerCode },
        }))}
      />
    </>
  );
}
