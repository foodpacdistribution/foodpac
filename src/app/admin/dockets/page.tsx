import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import type { Metadata } from "next";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { prettyDate, shiftDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { canReadPhotos, type DocketView, listDockets } from "@/lib/dockets";
import { aud } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { todayIn } from "@/lib/time";

export const metadata: Metadata = { title: "Driver Invoices" };

/** The invoices drivers photographed to deliver, with what was read off each and how the delivery went. */
export default async function DocketsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireUser(STAFF);
  const db = await getDb();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const asked = (await searchParams).date;
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && !Number.isNaN(Date.parse(asked)) ? asked : today;
  const dockets = await listDockets(db, date);
  const time = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, hour: "numeric", minute: "2-digit" });
  const count = (f: (d: DocketView) => boolean) => dockets.filter(f).length;
  const href = (d: string) => (d === today ? "/admin/dockets" : `/admin/dockets?date=${d}`);

  return (
    <div>
      <PageHeader
        title="Driver Invoices"
        subtitle="Invoices drivers photographed and delivered. Each one is a stop on that driver's route, with its proof of delivery."
        actions={
          <div className="flex items-center gap-1.5">
            <Link href={href(shiftDate(date, -1))} className={btn("secondary", "icon")} aria-label="Previous day">
              <ChevronLeft className="size-4" />
            </Link>
            <form action="/admin/dockets" className="flex">
              <input type="date" name="date" defaultValue={date} className="h-9 rounded-lg border border-line bg-white px-2 text-sm" aria-label="Day" />
              <button className={btn("secondary", "md", "ml-1.5")}>
                <T>{"Show"}</T>
              </button>
            </form>
            <Link href={href(shiftDate(date, 1))} className={btn("secondary", "icon")} aria-label="Next day">
              <ChevronRight className="size-4" />
            </Link>
          </div>
        }
      />
      {!canReadPhotos() && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          <T>{"Reading photos needs the Vercel AI Gateway. Until it's on, drivers type in the customer and address themselves."}</T>
        </p>
      )}
      <p className="mb-3 text-sm text-slate-600">
        <Tx>{prettyDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</Tx> ·{" "}
        <T vars={{ n: dockets.length }}>{"{n} photographed"}</T> · <T vars={{ n: count((d) => d.delivery?.status === "delivered") }}>{"{n} delivered"}</T>
        {count((d) => !d.added) > 0 && (
          <>
            {" "}
            · <T vars={{ n: count((d) => !d.added) }}>{"{n} not on a route yet"}</T>
          </>
        )}
      </p>
      {dockets.length === 0 ? (
        <Card>
          <EmptyState icon={FileText} title="No invoices photographed on this day">
            {"Drivers photograph the invoices they're given in the Invoices tab of their app; they show up here."}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {dockets.map((d) => (
            <Card key={d.id} className="flex gap-4 p-4">
              <a href={`/api/dockets/${d.id}`} target="_blank" rel="noreferrer" className="shrink-0" title="Open the photo">
                {/* eslint-disable-next-line @next/next/no-img-element -- private photo, served with the viewer's session */}
                <img src={`/api/dockets/${d.id}`} alt="Invoice photo" loading="lazy" className="h-36 w-28 rounded-lg bg-slate-100 object-cover ring-1 ring-line" />
              </a>
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-slate-500">{d.orderNumber ?? "—"}</p>
                    <p className="font-semibold text-slate-900">{d.customerName ?? <T>{"Customer not filled in"}</T>}</p>
                  </div>
                  <Status d={d} time={time} />
                </div>
                <p className="mt-0.5 text-slate-600">{d.address ?? "—"}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {d.driverName ?? "—"} · <T>{"photographed"}</T> {time.format(new Date(d.at))}
                  {d.phone && <> · {d.phone}</>}
                  {d.known && (
                    <>
                      {" "}
                      · <T>{"Customer on file"}</T>
                    </>
                  )}
                </p>
                {d.readProblem && !d.added && (
                  <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 ring-1 ring-amber-200">
                    <T>{"Couldn't be read:"}</T> {d.readProblem}
                  </p>
                )}
                {d.goods.length > 0 && (
                  <details className="mt-2 text-xs text-slate-600">
                    <summary className="cursor-pointer font-medium text-slate-700">
                      <T vars={{ n: d.goods.length }}>{d.goods.length === 1 ? "1 item" : "{n} items"}</T>
                      {d.totalCents !== null && <> · {aud(d.totalCents)}</>}
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {d.goods.map((g, i) => (
                        <li key={i}>
                          <span className="font-medium text-slate-900 tabular-nums">
                            {g.qty ?? ""} {g.unit ?? ""}
                          </span>{" "}
                          {g.name}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {d.goods.length === 0 && d.totalCents !== null && <p className="mt-2 text-xs text-slate-600">{aud(d.totalCents)}</p>}
                {d.proofs.length > 0 && (
                  <div className="mt-2 flex gap-1.5">
                    {d.proofs.map((p) => (
                      <a key={p.id} href={`/api/proofs/${p.id}`} target="_blank" rel="noreferrer" title={p.kind === "photo" ? "Delivery photo" : "Signature"}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- private proof image */}
                        <img src={`/api/proofs/${p.id}`} alt={p.kind === "photo" ? "Delivery photo" : "Signature"} loading="lazy" className="h-12 w-16 rounded border border-line bg-white object-cover" />
                      </a>
                    ))}
                  </div>
                )}
                {d.orderId && d.added && (
                  <Link href={`/admin/orders?date=${date}&q=${encodeURIComponent(d.orderNumber ?? "")}`} className="mt-2 inline-block text-xs font-medium text-blue-600">
                    <T>{"Open the delivery order"}</T> →
                  </Link>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Status({ d, time }: { d: DocketView; time: Intl.DateTimeFormat }) {
  if (!d.added) return <Badge tone="amber">{d.readStatus === "reading" ? "Reading" : "Not on a route yet"}</Badge>;
  const s = d.delivery?.status;
  const at = d.delivery?.at ? time.format(new Date(d.delivery.at)) : null;
  if (s === "delivered")
    return (
      <span className="text-right">
        <Badge tone="green">{"Delivered"}</Badge>
        {(at || d.delivery?.recipient) && (
          <span className="mt-0.5 block text-[11px] text-slate-500">
            {at}
            {d.delivery?.recipient && <> · {d.delivery.recipient}</>}
          </span>
        )}
      </span>
    );
  if (s === "failed")
    return (
      <span className="text-right">
        <Badge tone="red">{"Not delivered"}</Badge>
        {d.delivery?.reason && (
          <span className="mt-0.5 block text-[11px] text-slate-500">
            <T>{d.delivery.reason}</T>
          </span>
        )}
      </span>
    );
  return <Badge tone="blue">{"On the route"}</Badge>;
}
