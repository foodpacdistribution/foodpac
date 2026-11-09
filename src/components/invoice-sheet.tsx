import type { SiteInfo } from "@/app/(site)/site-info";
import { prettyDate } from "@/lib/dates";
import type { customers, salesOrderItems, salesOrders } from "@/lib/db/schema";
import { aud, PAYMENT_METHOD_LABEL, PAYMENT_STATUS } from "@/lib/money";
import { Logo } from "./brand";
import { PrintButton } from "./print-button";

/**
 * Printable invoice for one shop order (customer portal and back office): a proforma until staff
 * make it final. In English, laid out as an A4 page: on screen it's an A4-proportioned sheet, and
 * printing (see `.invoice-sheet` in globals.css) gives A4 margins, repeats the column headings on
 * each page and never splits a line or the totals across pages. Each line shows the product photo.
 */
export function InvoiceSheet({
  so,
  customer,
  items,
  issued,
  bankDetails,
  site,
  images = {},
  delivery = null,
}: {
  so: typeof salesOrders.$inferSelect;
  customer: typeof customers.$inferSelect;
  items: (typeof salesOrderItems.$inferSelect)[];
  /** The issue date, already formatted (e.g. "6 November 2026"). */
  issued: string;
  bankDetails: string;
  site: SiteInfo;
  /** productId → photo URL, for lines whose product has one. */
  images?: Record<string, string>;
  /** Once delivered: when, who received it, and their signature (already formatted for display). */
  delivery?: { at: string; recipient: string | null; signatureUrl: string | null } | null;
}) {
  const proforma = so.invoiceStatus === "proforma";
  const title = so.status === "cancelled" ? "Cancelled invoice" : proforma ? "Proforma invoice" : "Tax invoice";
  const hasPhotos = items.some((it) => it.productId && images[it.productId]);
  const dueCents = so.paymentStatus === "unpaid" ? so.totalCents - so.creditAppliedCents : 0;
  const contact = [site.phone, site.email].filter(Boolean).join(" · ");

  const cancelled = so.status === "cancelled";
  const due = so.dueDate ? prettyDate(so.dueDate, { day: "numeric", month: "long", year: "numeric" }) : null;
  const label = "text-[10px] font-semibold tracking-[0.12em] text-leaf-900/45 uppercase";

  return (
    <div className="invoice-page">
      <div className="no-print mx-auto mb-4 flex w-full max-w-[210mm] items-center justify-between gap-3">
        <p className="text-xs text-leaf-900/60">A4 · choose “Save as PDF” in the print window for a PDF copy.</p>
        <PrintButton className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-leaf-700 px-4 text-sm font-semibold text-white" label="Print / save PDF" />
      </div>
      <article className="invoice-sheet mx-auto flex w-full max-w-[210mm] flex-col overflow-hidden rounded-2xl border border-leaf-950/10 bg-white text-[13px] leading-snug text-leaf-950 shadow-sm sm:min-h-[297mm]">
        {/* A thin brand rule across the top of the page. */}
        <div aria-hidden className="h-1.5 shrink-0 bg-leaf-800" />
        <div className="flex flex-1 flex-col p-6 sm:p-[14mm] sm:pt-[12mm]">
          <header className="keep flex items-start justify-between gap-8">
            <div className="min-w-0">
              <Logo className="h-11" />
              <div className="mt-4 text-[11.5px] leading-relaxed text-leaf-900/65">
                <p className="text-[13px] font-semibold text-leaf-950">{site.name}</p>
                {site.abn && <p>ABN {site.abn}</p>}
                {site.address && <p>{site.address}</p>}
                {contact && <p>{contact}</p>}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-display text-[26px] leading-none font-bold tracking-tight text-leaf-900">{title}</p>
              {cancelled ? (
                <p className="mt-2.5 inline-block rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">Cancelled · nothing to pay</p>
              ) : proforma ? (
                <p className="mt-2.5 text-[11px] text-leaf-900/55">Not a tax invoice</p>
              ) : null}
            </div>
          </header>

          {/* The four facts people look for first. */}
          <dl className="keep mt-8 grid grid-cols-2 overflow-hidden rounded-xl bg-leaf-50/70 ring-1 ring-leaf-950/8 sm:grid-cols-4">
            {[
              ["Invoice no.", <span key="n" className="font-semibold">{so.number}</span>],
              [proforma ? "Date" : "Issue date", issued],
              ["Due date", due ?? "On receipt"],
              ["Amount due", <span key="a" className="text-base font-bold">{aud(cancelled ? 0 : dueCents)}</span>],
            ].map(([k, v], i) => (
              <div key={String(k)} className={`px-4 py-3 ${i > 0 ? "sm:border-l sm:border-leaf-950/8" : ""} ${i % 2 ? "max-sm:border-l max-sm:border-leaf-950/8" : ""} ${i > 1 ? "max-sm:border-t max-sm:border-leaf-950/8" : ""}`}>
                <dt className={label}>{k}</dt>
                <dd className="mt-1 tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="keep mt-8 grid grid-cols-2 gap-8 text-[12px] leading-relaxed">
            <div>
              <p className={label}>Bill to</p>
              <p className="mt-1.5 text-[13px] font-semibold">{customer.name}</p>
              <p className="text-leaf-900/65">Customer code {customer.code}</p>
              {customer.abn && <p className="text-leaf-900/65">ABN {customer.abn}</p>}
              {customer.address && <p className="text-leaf-900/65">{customer.address}</p>}
            </div>
            <div>
              <p className={label}>Deliver to</p>
              <p className="mt-1.5 text-[13px] font-semibold">{so.recipient}</p>
              <p className="text-leaf-900/65">{so.address}</p>
              <p className="text-leaf-900/65">Delivery {prettyDate(so.deliveryDate, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</p>
            </div>
          </div>

          <table className="mt-8 w-full border-collapse sm:table-fixed print:table-fixed">
            <colgroup>
              {hasPhotos && <col className="sm:w-[14mm] print:w-[14mm]" />}
              <col />
              <col className="sm:w-[24mm] print:w-[24mm]" />
              <col className="sm:w-[26mm] print:w-[26mm]" />
              <col className="sm:w-[28mm] print:w-[28mm]" />
            </colgroup>
            <thead>
              <tr className="bg-leaf-950/[0.04] text-left text-[10px] font-semibold tracking-[0.12em] text-leaf-900/60 uppercase">
                <th className="rounded-l-md py-2.5 pl-3" colSpan={hasPhotos ? 2 : 1}>
                  Description
                </th>
                <th className="py-2.5 pl-2 text-right">Qty</th>
                <th className="py-2.5 pl-2 text-right whitespace-nowrap">Unit price</th>
                <th className="rounded-r-md py-2.5 pr-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const img = it.productId ? images[it.productId] : undefined;
                return (
                  <tr key={it.id} className="border-b border-leaf-950/8 align-middle">
                    {hasPhotos && (
                      <td className="py-2.5 pr-2 pl-3">
                        {img ? (
                          // Plain <img>, loaded straight away, so it's there when the page is printed.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="" width={40} height={40} loading="eager" className="size-10 rounded-md bg-white object-contain ring-1 ring-leaf-950/8" />
                        ) : (
                          <span className="block size-10 rounded-md bg-leaf-950/[0.03]" />
                        )}
                      </td>
                    )}
                    <td className={`py-2.5 pr-3 ${hasPhotos ? "" : "pl-3"}`}>
                      <p className="font-medium break-words">{it.name}</p>
                      <p className="mt-0.5 text-[11px] text-leaf-900/50">
                        {it.sku}
                        {it.packSize && ` · ${it.packSize}`}
                        {!it.gst && " · GST free"}
                      </p>
                    </td>
                    <td className="py-2.5 pl-2 text-right whitespace-nowrap tabular-nums">
                      {it.qty} <span className="text-leaf-900/55">{it.unit}</span>
                    </td>
                    <td className="py-2.5 pl-2 text-right whitespace-nowrap tabular-nums">{aud(it.unitPriceCents)}</td>
                    <td className="py-2.5 pr-3 pl-2 text-right font-medium whitespace-nowrap tabular-nums">{aud(it.lineCents)}</td>
                  </tr>
                );
              })}
              {so.deliveryFeeCents > 0 && (
                <tr className="border-b border-leaf-950/8">
                  <td className="py-2.5 pl-3" colSpan={hasPhotos ? 2 : 1}>
                    Delivery
                  </td>
                  <td />
                  <td />
                  <td className="py-2.5 pr-3 text-right font-medium tabular-nums">{aud(so.deliveryFeeCents)}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="keep mt-5 flex justify-end">
            <dl className="w-[80mm] max-w-full text-[13px]">
              <div className="flex justify-between gap-4 px-3 py-1 text-leaf-900/65">
                <dt>Subtotal (ex GST)</dt>
                <dd className="tabular-nums">{aud(so.subtotalCents + so.deliveryFeeCents)}</dd>
              </div>
              <div className="flex justify-between gap-4 px-3 py-1 text-leaf-900/65">
                <dt>GST (10%)</dt>
                <dd className="tabular-nums">{aud(so.gstCents)}</dd>
              </div>
              <div className="mt-1 flex justify-between gap-4 border-t border-leaf-950/15 px-3 pt-2.5 pb-1 font-semibold">
                <dt>Total (incl. GST)</dt>
                <dd className="tabular-nums">{aud(so.totalCents)}</dd>
              </div>
              {so.creditAppliedCents > 0 && (
                <div className="flex justify-between gap-4 px-3 py-1 text-leaf-900/65">
                  <dt>Paid with store credit</dt>
                  <dd className="tabular-nums">−{aud(so.creditAppliedCents)}</dd>
                </div>
              )}
              {!cancelled && (
                <div className="mt-2 flex items-baseline justify-between gap-4 rounded-lg bg-leaf-900 px-3 py-2.5 text-white">
                  <dt className="text-[13px] font-medium">{so.paymentStatus === "paid" ? "Paid in full" : "Amount due (AUD)"}</dt>
                  <dd className="text-lg font-bold tabular-nums">{aud(so.paymentStatus === "paid" ? so.totalCents : dueCents)}</dd>
                </div>
              )}
            </dl>
          </div>

          {delivery && (
            <section className="keep mt-8 flex justify-end">
              <div className="w-[80mm] max-w-full px-3">
                <p className={label}>Proof of delivery</p>
                {delivery.signatureUrl ? (
                  <>
                    {/* The saved signature carries a stamp strip at the bottom (order, time, GPS); show just the signature. */}
                    <div className="mt-2 aspect-[1000/320] w-full overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element -- private proof image, served with the viewer's session */}
                      <img src={delivery.signatureUrl} alt={`Signature${delivery.recipient ? ` of ${delivery.recipient}` : ""}`} className="w-full" />
                    </div>
                    <div className="border-t border-leaf-950/40" />
                  </>
                ) : (
                  <div className="mt-6 border-t border-leaf-950/15" />
                )}
                <p className="mt-1.5 text-[11.5px] text-leaf-900/70">
                  {delivery.recipient ? (
                    <>
                      Received by <span className="font-semibold text-leaf-950">{delivery.recipient}</span> ·{" "}
                    </>
                  ) : delivery.signatureUrl ? (
                    "Signed by the customer · "
                  ) : null}
                  Delivered {delivery.at}
                </p>
              </div>
            </section>
          )}

          {/* Payment details sit at the foot of the first page (mt-auto), on screen and on paper; on a long invoice they follow the totals. */}
          <footer className="keep mt-auto pt-10 text-[11.5px] leading-relaxed text-leaf-900/70">
            <div className="grid grid-cols-2 gap-8 border-t border-leaf-950/10 pt-5">
              <div>
                <p className={label}>Payment</p>
                <p className="mt-1.5">
                  {PAYMENT_METHOD_LABEL[so.paymentMethod]} · {PAYMENT_STATUS[so.paymentStatus].label}
                </p>
                {proforma && !cancelled && (
                  <p className="mt-3 text-leaf-900/55">
                    This proforma may change until the order is final. Your tax invoice follows then.
                  </p>
                )}
              </div>
              {so.paymentStatus === "unpaid" && so.paymentMethod !== "card" && bankDetails && !cancelled && (
                <div>
                  <p className={label}>How to pay</p>
                  <p className="mt-1.5 whitespace-pre-wrap">{bankDetails}</p>
                  <p className="mt-1">
                    Reference: <span className="font-semibold text-leaf-950">{so.number}</span>
                  </p>
                </div>
              )}
            </div>
            <p className="mt-8 text-center text-[11px] text-leaf-900/45">Thank you for your business · {site.name}</p>
          </footer>
        </div>
      </article>
    </div>
  );
}
