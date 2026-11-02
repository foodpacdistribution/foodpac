import { asc, eq } from "drizzle-orm";
import { MapPin } from "lucide-react";
import type { Metadata } from "next";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customerAddresses } from "@/lib/db/schema";
import { DeleteAddress } from "./delete-address";
import { T } from "@/components/i18n";

export const metadata: Metadata = { title: "Addresses" };

export default async function AddressesPage() {
  const viewer = await getCurrentCustomer();
  if (!viewer) return null;
  const rows = await (await getDb()).select().from(customerAddresses).where(eq(customerAddresses.customerId, viewer.customer.id)).orderBy(asc(customerAddresses.createdAt));
  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight"><T>{"Delivery addresses"}</T></h1>
      <p className="mt-1 text-sm text-leaf-900/60"><T>{"Addresses you saved at checkout. Pick one next time with a single tap."}</T></p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {rows.map((a) => (
          <div key={a.id} className="flex items-start gap-3 rounded-2xl border border-leaf-950/10 bg-white p-4">
            <MapPin className="mt-0.5 size-4 shrink-0 text-leaf-700" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold">{a.label || a.recipient}</p>
              <p className="text-leaf-900/70">{a.address}</p>
              <p className="text-xs text-leaf-900/50">
                {a.recipient}
                {a.phone && ` · ${a.phone}`}
              </p>
              {a.instructions && <p className="mt-1 text-xs text-leaf-900/60">“{a.instructions}”</p>}
            </div>
            <DeleteAddress id={a.id} />
          </div>
        ))}
        {!rows.length && <p className="text-sm text-leaf-900/50"><T>{"No saved addresses yet. Tick “Save this address” at checkout."}</T></p>}
      </div>
    </>
  );
}
