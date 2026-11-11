import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { PIPELINE, requireUser } from "@/lib/auth/dal";
import { areaOf } from "@/lib/customer-map";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { CustomerMapClient, type MapCustomer } from "./customer-map-client";

export const metadata: Metadata = { title: "Customer Map" };

export default async function CustomerMapPage() {
  const me = await requireUser(PIPELINE);
  const db = await getDb();
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
  const canOpen = me.role !== "sales";
  const list: MapCustomer[] = rows.map((c) => {
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
      href: canOpen ? `/admin/customers/${c.id}` : null,
    };
  });
  return <CustomerMapClient customers={list} />;
}
