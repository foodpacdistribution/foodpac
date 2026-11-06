import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/planning";
import { isUuid } from "@/lib/purchasing/common";
import { todayIn } from "@/lib/time";
import { poFormData } from "../form-data";
import { PoForm } from "../po-form";

export const metadata: Metadata = { title: "New Purchase Order" };

export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  await requireUser(STAFF);
  const { supplier } = await searchParams;
  const db = await getDb();
  const [data, s] = await Promise.all([poFormData(db), getSettings(db)]);
  return <PoForm {...data} today={todayIn(s.timezone)} defaultSupplierId={supplier && isUuid(supplier) ? supplier : undefined} />;
}
