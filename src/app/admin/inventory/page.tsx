import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import type { MovementType } from "@/lib/db/schema";
import { isUuid } from "@/lib/purchasing/common";
import { movements, stockOverview } from "@/lib/purchasing/inventory";
import { MOVEMENT_LABEL } from "@/lib/purchasing/labels";
import { getSettings } from "@/lib/planning";
import { InventoryClient } from "./inventory-client";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ tab?: string; product?: string; type?: string }> }) {
  await requireUser(STAFF);
  const sp = await searchParams;
  const tab = sp.tab === "ledger" ? "ledger" : "stock";
  const productId = sp.product && isUuid(sp.product) ? sp.product : undefined;
  const type = sp.type && sp.type in MOVEMENT_LABEL ? (sp.type as MovementType) : undefined;
  const db = await getDb();
  const [stock, ledger, s] = await Promise.all([stockOverview(db), tab === "ledger" ? movements(db, { productId, type }) : Promise.resolve([]), getSettings(db)]);
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "medium", timeStyle: "short" });
  return (
    <InventoryClient
      tab={tab}
      filters={{ productId: productId ?? "", type: type ?? "" }}
      stock={stock}
      ledger={ledger.map((m) => ({ ...m, createdAt: fmt.format(m.createdAt) }))}
    />
  );
}
