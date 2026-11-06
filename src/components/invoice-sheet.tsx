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
}) {
  const proforma = so.invoiceStatus === "proforma";
  const title = so.status === "cancelled" ? "Cancelled invoice" : proforma ? "Proforma invoice" : "Tax invoice";
  const hasPhotos = items.some((it) => it.productId && images[it.productId]);
  const dueCents = so.paymentStatus === "unpaid" ? so.totalCents - so.creditAppliedCents : 0;
  const contact = [site.phone, site.email].filter(Boolean).join(" · ");

  return (
    <div className="invoice-page">
      <div className="no-print mx-auto mb-4 flex w-full max-w-[210mm] items-center justify-between gap-3">
        <p className="text-xs text-leaf-900/60">A4 · choose “Save as PDF” in the print window for a PDF copy.</p>
        <PrintButton className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-leaf-700 px-4 text-sm font-semibold text-white" label="Print / save PDF" />
      </div>
      <article className="invoice-sheet mx-auto flex w-full max-w-[210mm] flex-col rounded-2xl border border-leaf-950/10 bg-white p-6 text-[13px] leading-snug text-leaf-950 shadow-sm sm:min-h-[297mm] sm:p-[14mm]">
        <header className="keep flex items-start justify-between gap-6">
          <div className="min-w-0">
            <Logo className="h-12" />
            <div className="mt-3 text-xs leading-relaxed text-leaf-900/70">
              <p className="text-sm font-semibold text-leaf-950">{site.name}</p>
              {site.abn && <p>ABN {site.abn}</p>}
              {site.address && <p>{site.address}</p>}
              {contact && <p>{contact}</p>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-display text-2xl font-bold tracking-tight uppercase">{title}</p>
            <dl className="mt-3 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5 text-xs">
              <dt className="text-leaf-900/60">Invoice no.</dt>
              <dd className="font-semibold tabular-nums">{so.number}</dd>
              <dt className="text-leaf-900/60">{proforma ? "Date" : "Issue date"}</dt>
              <dd className="tabular-nums">{issued}</dd>
              {so.dueDate && (
                <>
                  <dt className="text-leaf-900/60">Due date</dt>
                  <dd className="tabular-nums">{prettyDate(so.dueDate, { day: "numeric", month: "long", year: "numeric" })}</dd>
                </>
              )}
            </dl>
          </div>
        </header>

        {proforma && so.status !== "cancelled" && (
          <p className="keep mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
            This is a proforma invoice, not a tax invoice. Quantities and prices may still change. The tax invoice follows once the order is final.
          </p>
        )}

        <div className="keep mt-7 grid grid-cols-2 gap-6 border-y border-leaf-950/10 py-4 text-xs">
          <div>
            <p className="font-semibold tracking-wider text-leaf-900/50 uppercase">Bill to</p>
            <p className="mt-1 text-sm font-semibold">{customer.name}</p>
            {customer.abn && <p className="text-leaf-900/70">ABN {customer.abn}</p>}
            {customer.address && <p className="text-leaf-900/70">{customer.address}</p>}
          </div>
          <div>
            <p className="font-semibold tracking-wider text-leaf-900/50 uppercase">Deliver to</p>
            <p className="mt-1 text-sm font-semibold">{so.recipient}</p>
            <p className="text-leaf-900/70">{so.address}</p>
            <p className="text-leaf-900/70">Delivery {prettyDate(so.deliveryDate, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</p>
          </div>
        </div>

        <table className="mt-6 w-full table-fixed border-collapse">
          <colgroup>
            {hasPhotos && <col className="w-[13mm]" />}
            <col />
            <col className="w-[24mm]" />
            <col className="w-[26mm]" />
            <col className="w-[28mm]" />
          </colgroup>
          <thead>
            <tr className="border-b-2 border-leaf-950/80 text-left text-[11px] font-semibold tracking-wide text-leaf-900/70 uppercase">
              <th className="py-2" colSpan={hasPhotos ? 2 : 1}>
                Description
              </th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit price</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const img = it.productId ? images[it.productId] : undefined;
              return (
                <tr key={it.id} className="border-b border-leaf-950/10 align-middle">
                  {hasPhotos && (
                    <td className="py-1.5 pr-2">
                      {img ? (
                        // Plain <img>, loaded straight away, so it's there when the page is printed.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="" width={40} height={40} loading="eager" className="size-10 rounded border border-leaf-950/10 bg-white object-cover" />
                      ) : (
                        <span className="block size-10 rounded border border-dashed border-leaf-950/15" />
                      )}
                    </td>
                  )}
                  <td className="py-2 pr-3">
                    <p className="font-medium break-words">{it.name}</p>
                    <p className="text-[11px] text-leaf-900/55">
                      {it.sku}
                      {it.packSize && ` · ${it.packSize}`}
                      {!it.gst && " · GST free"}
                    </p>
                  </td>
                  <td className="py-2 text-right whitespace-nowrap tabular-nums">
                    {it.qty} {it.unit}
                  </td>
                  <td className="py-2 text-right tabular-nums">{aud(it.unitPriceCents)}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{aud(it.lineCents)}</td>
                </tr>
              );
            })}
            {so.deliveryFeeCents > 0 && (
              <tr className="border-b border-leaf-950/10">
                <td className="py-2" colSpan={hasPhotos ? 2 : 1}>
                  Delivery
                </td>
                <td />
                <td />
                <td className="py-2 text-right font-medium tabular-nums">{aud(so.deliveryFeeCents)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="keep mt-4 flex justify-end">
          <dl className="w-[78mm] max-w-full space-y-1 text-sm">
            <div className="flex justify-between gap-4 text-leaf-900/70">
              <dt>Subtotal (ex GST)</dt>
              <dd className="tabular-nums">{aud(so.subtotalCents + so.deliveryFeeCents)}</dd>
            </div>
            <div className="flex justify-between gap-4 text-leaf-900/70">
              <dt>GST (10%)</dt>
              <dd className="tabular-nums">{aud(so.gstCents)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t-2 border-leaf-950/80 pt-2 text-base font-bold">
              <dt>Total (incl. GST)</dt>
              <dd className="tabular-nums">{aud(so.totalCents)}</dd>
            </div>
            {so.creditAppliedCents > 0 && (
              <div className="flex justify-between gap-4 text-leaf-900/70">
                <dt>Paid with store credit</dt>
                <dd className="tabular-nums">−{aud(so.creditAppliedCents)}</dd>
              </div>
            )}
            {so.status !== "cancelled" && (
              <div className="flex justify-between gap-4 rounded bg-leaf-50 px-2 py-1.5 font-semibold">
                <dt>{so.paymentStatus === "paid" ? "Paid in full" : "Amount due"}</dt>
                <dd className="tabular-nums">{aud(so.paymentStatus === "paid" ? so.totalCents : dueCents)}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Payment details sit at the foot of the first page (mt-auto), on screen and on paper; on a long invoice they follow the totals. */}
        <footer className="keep mt-auto pt-8 text-xs text-leaf-900/75">
          <div className="grid grid-cols-2 gap-6 border-t border-leaf-950/10 pt-4">
            <div>
              <p className="font-semibold tracking-wider text-leaf-900/50 uppercase">Payment</p>
              <p className="mt-1">
                {PAYMENT_METHOD_LABEL[so.paymentMethod]} · {PAYMENT_STATUS[so.paymentStatus].label}
              </p>
            </div>
            {so.paymentStatus === "unpaid" && so.paymentMethod !== "card" && bankDetails && (
              <div>
                <p className="font-semibold tracking-wider text-leaf-900/50 uppercase">How to pay</p>
                <p className="mt-1 whitespace-pre-wrap">{bankDetails}</p>
                <p className="mt-1">
                  Reference: <span className="font-semibold">{so.number}</span>
                </p>
              </div>
            )}
          </div>
          <p className="mt-6 text-center text-[11px] text-leaf-900/50">Thank you for your business.</p>
        </footer>
      </article>
    </div>
  );
}
