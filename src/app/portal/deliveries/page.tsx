import { eq } from "drizzle-orm";
import { ChevronRight, Clock, PackageSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { requireUser } from "@/lib/auth/dal";
import { linkOrdersToCustomer } from "@/lib/customers";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { listPortalOrders } from "@/lib/portal";
import { formatClock, todayIn } from "@/lib/time";
import { StageBadge, StageSteps } from "../stage";
import { T, Tx } from "@/components/i18n";

export const metadata: Metadata = { title: "Deliveries" };

export default async function PortalDeliveries() {
  const user = await requireUser(["customer"]);
  const db = await getDb();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const [c] = user.customerId ? await db.select().from(customers).where(eq(customers.id, user.customerId)).limit(1) : [];
  if (c) await linkOrdersToCustomer(db, c);
  const rows = c ? await listPortalOrders(db, c.id, today) : [];

  const current = rows.filter((o) => o.deliveryDate >= today && o.stage !== "delivered" && o.stage !== "failed");
  const past = rows.filter((o) => !current.includes(o));
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, hour: "numeric", minute: "2-digit" });

  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight"><T>{"Deliveries"}</T></h1>
      <p className="mt-1 text-sm text-leaf-900/60"><T>{"Follow each delivery from our warehouse to your door."}</T></p>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-leaf-950/15 bg-white px-6 py-14 text-center">
          <PackageSearch className="mx-auto size-10 text-leaf-700/60" />
          <p className="mt-3 font-semibold"><T>{"No orders yet"}</T></p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-leaf-900/60"><T>{"Orders we have for your business will appear here as soon as they're booked in."}</T></p>
        </div>
      ) : (
        <>
          <Section title={<T>{"Upcoming & on the way"}</T>} empty="Nothing on the way right now.">
            {current.map((o) => (
              <OrderCard key={o.id} o={o}>
                {o.stage === "out_for_delivery" && o.etaS !== null ? (
                  <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-amber-800">
                    <Clock className="size-4" /> {" "}<T>{"On the way · planned arrival around"}</T>{" "}{formatClock(o.etaS)}
                  </p>
                ) : o.etaS !== null ? (
                  <p className="mt-3 flex items-center gap-1.5 text-sm text-leaf-900/70">
                    <Clock className="size-4" /> {" "}<T>{"Planned arrival around"}</T>{" "}{formatClock(o.etaS)}
                  </p>
                ) : null}
              </OrderCard>
            ))}
          </Section>
          <Section title={<T>{"Past deliveries"}</T>} empty="No past deliveries in the last 60 days.">
            {past.map((o) => (
              <OrderCard key={o.id} o={o} compact>
                {o.completedAt && (
                  <p className="mt-1 text-xs text-leaf-900/60">
                    {o.stage === "delivered" ? <T>{"Delivered"}</T> : <T>{"Attempted"}</T>} {" "}<T>{"at"}</T>{" "}{fmt.format(new Date(o.completedAt))}
                  </p>
                )}
              </OrderCard>
            ))}
          </Section>
        </>
      )}
    </>
  );
}

function Section({ title, empty, children }: { title: React.ReactNode; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-leaf-900/50">{<Tx>{title}</Tx>}</h2>
      <div className="mt-3 space-y-3">{children.length ? children : <p className="text-sm text-leaf-900/50">{empty}</p>}</div>
    </section>
  );
}

function OrderCard({
  o,
  compact,
  children,
}: {
  o: Awaited<ReturnType<typeof listPortalOrders>>[number];
  compact?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Link href={`/portal/track/${o.id}`} className="group block rounded-2xl border border-leaf-950/10 bg-white p-4 transition-colors hover:border-leaf-700/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            <T>{"Order"}</T>{" "}{o.orderNumber} <span className="font-normal text-leaf-900/50">· {<Tx>{prettyDate(o.deliveryDate)}</Tx>}</span>
          </p>
          <p className="truncate text-xs text-leaf-900/60">{o.address}</p>
        </div>
        <div className="flex items-center gap-1">
          <StageBadge stage={o.stage} />
          <ChevronRight className="size-4 text-leaf-900/30 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
      {!compact && (
        <div className="mt-4">
          <StageSteps stage={o.stage} compact />
        </div>
      )}
      {children}
    </Link>
  );
}
