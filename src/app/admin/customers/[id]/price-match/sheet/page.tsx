import { siteInfo } from "@/app/(site)/site-info";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/brand";
import Link from "@/components/link";
import { PrintButton } from "@/components/print-button";
import { PIPELINE, requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { invoiceImages } from "@/lib/invoices";
import { aud } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { savingsLines } from "@/lib/price-match";
import { savings } from "@/lib/price-match-rules";
import { mayServe } from "@/lib/rep-scope";

/** The title is the PDF's file name when the sheet is saved from the print window. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: "Your savings" };
  const [c] = await (await getDb()).select({ name: customers.name }).from(customers).where(eq(customers.id, id)).limit(1);
  return { title: c ? `Your savings with Foodpac · ${c.name}` : "Your savings" };
}

/**
 * What the store pays now against what it would pay us, product by product, with the saving a
 * month: to show on the phone at the counter, or print / save as PDF and send. Same A4 layout as
 * the quote. Only approved matches where we're no dearer, at the price they'd pay us today.
 */
export default async function SavingsSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser(PIPELINE);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [c] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!c || !mayServe(me, c)) notFound();
  const [lines, s] = await Promise.all([savingsLines(db, id), getSettings(db)]);
  const images = await invoiceImages(db, lines.map((l) => ({ productId: l.id })));
  const site = siteInfo(s);
  const issued = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "long" }).format(new Date());
  const rows = lines.map((l) => ({ ...l, s: savings(l.competitorCents, l.ourCents, l.monthlyQty) }));
  const monthly = rows.reduce((t, r) => t + (r.s.monthlyCents ?? 0), 0);
  // Monthly figures only when there's a saving to show for them.
  const counted = monthly > 0;
  const avgPct = rows.length ? Math.round(rows.reduce((t, r) => t + r.s.pct, 0) / rows.length) : 0;
  const contact = [site.phone, site.email].filter(Boolean).join(" · ");
  const label = "text-[10px] font-semibold tracking-[0.12em] text-leaf-900/45 uppercase";
  const hasPhotos = rows.some((r) => images[r.id]);

  return (
    <div className="text-leaf-950">
      <div className="invoice-page">
        <div className="no-print mx-auto mb-4 flex w-full max-w-[210mm] flex-wrap items-center justify-between gap-3">
          <Link href={`/admin/customers/${c.id}/price-match`} className="text-sm text-leaf-900/70 hover:text-leaf-950">
            ← Back to price match
          </Link>
          <PrintButton className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-leaf-700 px-4 text-sm font-semibold text-white" label="Print / save PDF" />
        </div>
        <article className="invoice-sheet mx-auto flex w-full max-w-[210mm] flex-col overflow-hidden rounded-2xl border border-leaf-950/10 bg-white text-[13px] leading-snug text-leaf-950 shadow-sm sm:min-h-[297mm]">
          <div aria-hidden className="h-1.5 shrink-0 bg-tomato" />
          <div className="flex flex-1 flex-col p-6 sm:p-[14mm] sm:pt-[12mm]">
            <header className="keep flex items-start justify-between gap-8">
              <div className="min-w-0">
                <Logo className="h-11" />
                <div className="mt-4 text-[11.5px] leading-relaxed text-leaf-900/65">
                  <p className="text-[13px] font-semibold text-leaf-950">{site.name}</p>
                  {site.abn && <p>ABN {site.abn}</p>}
                  {contact && <p>{contact}</p>}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display text-[26px] leading-none font-bold tracking-tight text-leaf-900">Your savings</p>
                <p className="mt-2.5 text-[11px] text-leaf-900/55">{issued}</p>
              </div>
            </header>

            <div className="keep mt-8">
              <p className={label}>Prepared for</p>
              <p className="mt-1.5 text-[15px] font-semibold">{c.name}</p>
              {c.address && <p className="text-[12px] text-leaf-900/65">{c.address}</p>}
            </div>

            {rows.length === 0 ? (
              <p className="mt-10 rounded-xl bg-leaf-50/70 px-4 py-6 text-center text-leaf-900/70">No approved price matches yet.</p>
            ) : (
              <>
                <dl className="keep mt-6 grid grid-cols-2 overflow-hidden rounded-xl bg-leaf-900 text-white sm:grid-cols-3">
                  <div className="px-4 py-3.5">
                    <dt className="text-[10px] font-semibold tracking-[0.12em] text-white/60 uppercase">Products</dt>
                    <dd className="mt-1 text-xl font-bold tabular-nums">{rows.length}</dd>
                  </div>
                  <div className="border-l border-white/10 px-4 py-3.5">
                    <dt className="text-[10px] font-semibold tracking-[0.12em] text-white/60 uppercase">{avgPct > 0 ? "Average saving" : "Our prices"}</dt>
                    <dd className="mt-1 text-xl font-bold tabular-nums">{avgPct > 0 ? `${avgPct}%` : "Matched"}</dd>
                  </div>
                  {counted && (
                    <div className="col-span-2 border-white/10 px-4 py-3.5 max-sm:border-t sm:col-span-1 sm:border-l">
                      <dt className="text-[10px] font-semibold tracking-[0.12em] text-white/60 uppercase">You save a month</dt>
                      <dd className="mt-1 text-xl font-bold tabular-nums">
                        {aud(monthly)}
                        <span className="ml-1.5 text-[12px] font-medium text-white/70">≈ {aud(monthly * 12)} a year</span>
                      </dd>
                    </div>
                  )}
                </dl>

                <table className="mt-8 w-full border-collapse">
                  <thead>
                    <tr className="bg-leaf-950/[0.04] text-left text-[10px] font-semibold tracking-[0.12em] text-leaf-900/60 uppercase">
                      <th className="rounded-l-md py-2.5 pl-3" colSpan={hasPhotos ? 2 : 1}>
                        Product
                      </th>
                      <th className="py-2.5 pl-2 text-right whitespace-nowrap">You pay now</th>
                      <th className="py-2.5 pl-2 text-right whitespace-nowrap">With us</th>
                      <th className={`py-2.5 pl-2 text-right ${counted ? "" : "rounded-r-md pr-3"}`}>Save</th>
                      {counted && <th className="rounded-r-md py-2.5 pr-3 pl-2 text-right whitespace-nowrap">A month</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-leaf-950/8 align-middle">
                        {hasPhotos && (
                          <td className="w-12 py-2.5 pr-2 pl-3">
                            {images[r.id] ? (
                              // eslint-disable-next-line @next/next/no-img-element -- loaded straight away so it's there when printed
                              <img src={images[r.id]} alt="" width={40} height={40} loading="eager" className="size-10 rounded-md bg-white object-contain ring-1 ring-leaf-950/8" />
                            ) : (
                              <span className="block size-10 rounded-md bg-leaf-950/[0.03]" />
                            )}
                          </td>
                        )}
                        <td className={`py-2.5 pr-3 ${hasPhotos ? "" : "pl-3"}`}>
                          <p className="font-medium break-words">{r.name}</p>
                          <p className="mt-0.5 text-[11px] text-leaf-900/50">
                            {[r.sku, r.packSize, `per ${r.unit}`].filter(Boolean).join(" · ")}
                            {r.monthlyQty ? ` · ${r.monthlyQty} a month` : ""}
                          </p>
                        </td>
                        <td className={`py-2.5 pl-2 text-right whitespace-nowrap text-leaf-900/60 tabular-nums ${r.s.perUnitCents > 0 ? "line-through decoration-leaf-900/30" : ""}`}>{aud(r.competitorCents)}</td>
                        <td className="py-2.5 pl-2 text-right font-semibold whitespace-nowrap tabular-nums">{aud(r.ourCents)}</td>
                        <td className={`py-2.5 pl-2 text-right whitespace-nowrap text-emerald-700 tabular-nums ${counted ? "" : "pr-3"}`}>
                          {r.s.perUnitCents > 0 ? (
                            <>
                              {aud(r.s.perUnitCents)} <span className="text-[11px]">({r.s.pct}%)</span>
                            </>
                          ) : (
                            <span className="text-leaf-900/50">Same price</span>
                          )}
                        </td>
                        {counted && <td className="py-2.5 pr-3 pl-2 text-right font-medium whitespace-nowrap text-emerald-700 tabular-nums">{r.s.monthlyCents ? aud(r.s.monthlyCents) : "—"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <footer className="keep mt-auto pt-10 text-[11.5px] leading-relaxed text-leaf-900/70">
              <div className="border-t border-leaf-950/10 pt-5">
                <p className={label}>About these prices</p>
                <p className="mt-1.5">
                  Prices are per unit, ex GST, and are your account prices with {site.name} today. &ldquo;You pay now&rdquo; is what you told us you pay your current supplier. Monthly savings use the
                  quantities you gave us. Order online any time from your list, and we deliver on our next run.
                </p>
              </div>
              <p className="mt-8 text-center text-[11px] text-leaf-900/45">
                Thank you for the opportunity · {site.name}
                {site.phone ? ` · ${site.phone}` : ""}
              </p>
            </footer>
          </div>
        </article>
      </div>
    </div>
  );
}
