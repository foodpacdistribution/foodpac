import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { CustomerImportClient } from "./import-client";

export const metadata: Metadata = { title: "Import customers" };

export default async function ImportCustomersPage() {
  await requireUser(STAFF);
  const rows = await (await getDb()).select({ code: customers.code, name: customers.name }).from(customers);
  return <CustomerImportClient existing={rows} />;
}
