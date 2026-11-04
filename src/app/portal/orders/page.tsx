import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { listSalesOrders } from "./data";
import { SalesOrderList } from "./list";
import { T } from "@/components/i18n";

export const metadata: Metadata = { title: "My orders" };

export default async function OrdersPage() {
  const user = await requireUser(["customer"]);
  const rows = user.customerId ? await listSalesOrders(await getDb(), user.customerId) : [];
  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight"><T>{"My orders"}</T></h1>
      <p className="mt-1 text-sm text-leaf-900/60"><T>{"Everything you've ordered online, with payment and delivery status."}</T></p>
      {rows.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-leaf-950/15 bg-white px-6 py-14 text-center">
          <Receipt className="mx-auto size-10 text-leaf-700/60" />
          <p className="mt-3 font-semibold"><T>{"No orders yet"}</T></p>
          <Link href="/products" className="mt-4 inline-flex h-10 items-center rounded-full bg-leaf-700 px-5 text-sm font-semibold text-white">
            <T>{"Start shopping"}</T></Link>
        </div>
      ) : (
        <SalesOrderList rows={rows} />
      )}
    </>
  );
}
