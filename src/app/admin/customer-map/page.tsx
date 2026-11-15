import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { PIPELINE, requireUser } from "@/lib/auth/dal";
import { recentSales, vanDaysNear, vanRuns } from "@/lib/area-insights";
import { areaOf } from "@/lib/customer-map";
import { loadPipeline } from "@/lib/pipeline";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { CustomerMapClient, type MapCustomer } from "./customer-map-client";

export const metadata: Metadata = { title: "Customer Map" };

export default async function CustomerMapPage() {
  const me = await requireUser(PIPELINE);
  const db = await getDb();
  // Follow-ups due, sales lately and the van runs: what says which areas are worth a visit.
  const [pipeline, sales] = await Promise.all([loadPipeline(db), recentSales(db)]);
  const runs = await vanRuns(db, pipeline.today);
  const follow = new Map(pipeline.customers.map((c) => [c.id, c]));
  const rows = await db
    .select({
      id: customers.id,
      code: customers.code,
      name: customers.name,
      phone: customers.phone,
      address: customers.address,
      active: customers.active,
      approved: customers.approved,
      stage: customers.salesStage,
      lat: customers.lat,
      lng: customers.lng,
      geocodeStatus: customers.geocodeStatus,
      geocodeLabel: customers.geocodeLabel,
      geocodedAddress: customers.geocodedAddress,
    })
    .from(customers)
    .orderBy(asc(customers.name));

  // Sales staff only have the pipeline, so customer names link to the full page for office staff.
  const list: Omit<MapCustomer, "repId" | "due" | "last90Cents" | "prev90Cents" | "vanDays">[] = rows.map((c) => {
    const address = c.address?.trim() ?? "";
    const current = !!address && c.geocodedAddress === c.address;
    const place = !address ? "none" : !current ? "pending" : c.lat == null || c.lng == null ? "failed" : "placed";
    const area = areaOf(current ? c.geocodeLabel : null, address);
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      phone: c.phone,
      address,
      active: c.active && c.approved,
      stage: c.stage,
      place,
      lat: place === "placed" ? c.lat : null,
      lng: place === "placed" ? c.lng : null,
      approximate: c.geocodeStatus === "approximate",
      areaKey: area.key,
      areaName: area.name,
      href: `/admin/customers/${c.id}`,
    };
  });
  // Which weekdays a van already passes each customer.
  const placed = list.filter((c) => c.lat !== null && c.lng !== null);
  const days = vanDaysNear(runs, placed as { lat: number; lng: number }[]);
  const vanDaysOf = new Map(placed.map((c, i) => [c.id, days[i]]));
  return (
    <CustomerMapClient
      me={{ id: me.id, role: me.role }}
      runs={runs}
      customers={list.map((c) => ({
        ...c,
        repId: follow.get(c.id)?.repId ?? null,
        due: follow.get(c.id)?.due ?? null,
        last90Cents: sales.get(c.id)?.last90 ?? 0,
        prev90Cents: sales.get(c.id)?.prev90 ?? 0,
        vanDays: vanDaysOf.get(c.id) ?? [],
      }))}
    />
  );
}
