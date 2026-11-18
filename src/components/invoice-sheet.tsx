import type { SiteInfo } from "@/app/(site)/site-info";
import { prettyDate } from "@/lib/dates";
import type { customers, salesOrderItems, salesOrders } from "@/lib/db/schema";
import { aud, GST_RATE, PAYMENT_METHOD_LABEL, PAYMENT_STATUS, PAYMENT_TERMS_LABEL } from "@/lib/money";
import { asSold } from "@/lib/stock-units";
import { Logo } from "./brand";
import { PrintButton } from "./print-button";

/**
 * Quantity and unit price cells of a printed line (invoice, quote): a carton line reads "3 carton"
 * with the units it holds, at the carton price.
 */
export function SoldCells({ it }: { it: Parameters<typeof asSold>[0] }) {
  const sold = asSold(it);
  return (
    <>
      <td className="py-2.5 pl-2 text-right whitespace-nowrap tabular-nums">
        {sold.qty} <span className="text-leaf-900/55">{sold.unit}</span>
        {sold.units !== null && (
          <span className="block text-[11px] text-leaf-900/50">
            {sold.units} {sold.packUnit}
          </span>
        )}
      </td>
      <td className="py-2.5 pl-2 text-right whitespace-nowrap tabular-nums">
        {aud(sold.priceCents)}
        {sold.units !== null && <span className="block text-[11px] text-leaf-900/50">per carton</span>}
      </td>
    </>
  );
}

const money = (cents: number) => (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Printable invoice for one shop order (customer portal and back office): a proforma until staff
 * make it final. In English, laid out as an A4 page in the style of the company's printed
 * invoices: the customer and the invoice facts at the top, then one table of lines (price, unit,
 * quantity, discount, GST and amount) under the sales order it belongs to, the totals, and the
 * bank details at the foot. On screen it's an A4-proportioned sheet; printing (see
 * `.invoice-sheet` in globals.css) gives A4 margins, repeats the column headings on each page and
 * never splits a line or the totals across pages. Each line shows the product photo.
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
  const cancelled = so.status === "cancelled";
  const title = cancelled ? "Cancelled invoice" : proforma ? "Proforma invoice" : "Invoice";
  const dueCents = cancelled || so.paymentStatus !== "unpaid" ? 0 : so.totalCents - so.creditAppliedCents;
  const due = so.dueDate ? prettyDate(so.dueDate, { day: "numeric", month: "long", year: "numeric" }) : "On receipt";
  const contact = [site.phone, site.email].filter(Boolean).join(" · ");
  const lines = items.map((it) => ({ it, sold: asSold(it), taxCents: it.gst ? Math.round(it.lineCents * GST_RATE) : 0 }));
  const totalQty = lines.reduce((t, l) => t + l.sold.qty, 0);
  const gstFreeCents = 0;

  const facts: [string, React.ReactNode][] = [
    ["Invoice #", <span key="n" className="font-semibold">{so.number}</span>],
    ["Date", issued],
    ["Date due", due],
    ["Sales order type", "Standard"],
    ["Credit term", PAYMENT_TERMS_LABEL[customer.paymentTerms] ?? "—"],
    ["Delivery method", "Delivery"],
    ["Delivery terms", prettyDate(so.deliveryDate, { weekday: "short", day: "numeric", month: "short", year: "numeric" })],
  ];
  const totals: [string, number, boolean?][] = [
    ["Sub Total", so.subtotalCents],
    ["GST (10%)", so.gstCents],
    ["GST Free (0%)", gstFreeCents],
    ["Additional Charges", so.deliveryFeeCents],
    ["Discount On Total Price", 0],
  ];
  const label = "text-[10.5px] font-semibold tracking-wide text-neutral-500 uppercase";
  const th = "py-2 px-1.5 text-[10.5px] font-semibold tracking-wide text-neutral-600 uppercase";

  return (
    <div className="invoice-page">
      <div className="no-print mx-auto mb-4 flex w-full max-w-[210mm] items-center justify-between gap-3">
        <p className="text-xs text-leaf-900/60">A4 · choose “Save as PDF” in the print window for a PDF copy.</p>
        <PrintButton className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-leaf-700 px-4 text-sm font-semibold text-white" label="Print / save PDF" />
      </div>
      <article className="invoice-sheet mx-auto flex w-full max-w-[210mm] flex-col overflow-hidden rounded-2xl border border-leaf-950/10 bg-white text-[12.5px] leading-snug text-neutral-900 shadow-sm sm:min-h-[297mm]">
        <div className="flex flex-1 flex-col p-6 sm:p-[14mm] sm:pt-[12mm]">
          <header className="keep flex items-start justify-between gap-6">
            <Logo className="mt-3 h-9 shrink-0 sm:h-12" />
            <div className="text-right">
              <p className="text-[12px] font-semibold tracking-[0.08em] text-neutral-700 uppercase">{site.legalName}</p>
              <div className="mt-1 text-[10.5px] leading-relaxed text-neutral-500">
                {site.abn && <p>ABN {site.abn}</p>}
                {site.address && <p>{site.address}</p>}
                {contact && <p>{contact}</p>}
              </div>
              <p className="mt-5 text-[21px] leading-none font-semibold tracking-[0.06em] text-neutral-700 uppercase sm:text-[28px] print:text-[28px]">{title}</p>
              {cancelled ? (
                <p className="mt-2 inline-block rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">Cancelled · nothing to pay</p>
              ) : proforma ? (
                <p className="mt-1.5 text-[10.5px] text-neutral-500">Not a tax invoice</p>
              ) : (
                <p className="mt-1.5 text-[10.5px] text-neutral-500">Tax invoice</p>
              )}
            </div>
          </header>

          <section className="keep mt-7">
            <p className="text-[17px] font-semibold">{customer.name}</p>
            <div className="mt-3 grid gap-x-6 gap-y-4 text-[11.5px] leading-relaxed sm:grid-cols-[1fr_1fr_1.35fr]">
              <div>
                <p className={label}>Bill to:</p>
                <p className="mt-0.5 text-neutral-700">{customer.address || customer.name}</p>
                {customer.abn && <p className="text-neutral-500">ABN {customer.abn}</p>}
                <p className="text-neutral-500">Customer {customer.code}</p>
              </div>
              <div>
                <p className={label}>Ship to:</p>
                <p className="mt-0.5 text-neutral-700">{so.address}</p>
                {so.recipient && so.recipient !== customer.name && <p className="text-neutral-500">Attn: {so.recipient}</p>}
                {so.phone && <p className="text-neutral-500">{so.phone}</p>}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                {facts.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className={label + " leading-[1.6]"}>{k}:</dt>
                    <dd className="text-right tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <div className="mt-7 max-sm:-mx-6 max-sm:overflow-x-auto max-sm:px-6">
            <table className="w-full min-w-[600px] border-collapse sm:table-fixed print:min-w-0 print:table-fixed">
              <colgroup>
                <col className="w-[7mm]" />
                <col />
                <col className="w-[18mm]" />
                <col className="w-[22mm]" />
                <col className="w-[13mm]" />
                <col className="w-[12mm]" />
                <col className="w-[19mm]" />
                <col className="w-[27mm]" />
              </colgroup>
              <thead>
                <tr className="border-y border-neutral-300 bg-neutral-100 text-left">
                  <th className={th + " pl-2"}>#</th>
                  <th className={th}>Item</th>
                  <th className={th + " text-right"}>Price</th>
                  <th className={th + " text-center"}>Unit</th>
                  <th className={th + " text-right"}>Qty</th>
                  <th className={th + " text-center"}>Disc.</th>
                  <th className={th + " text-right"}>Tax</th>
                  <th className={th + " pr-2 text-right whitespace-nowrap"}>Amount (AUD)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <td colSpan={8} className="px-2 py-1.5 text-[11px] font-semibold tracking-wide text-neutral-700 uppercase">
                    Sales order {so.number}
                  </td>
                </tr>
                {lines.map(({ it, sold, taxCents }, i) => {
                  const img = it.productId ? images[it.productId] : undefined;
                  const per = sold.units !== null ? sold.units / sold.qty : null;
                  return (
                    <tr key={it.id} className="border-b border-neutral-200 align-top">
                      <td className="py-2.5 pl-2 text-neutral-500 tabular-nums">{i + 1}</td>
                      <td className="py-2.5 px-1.5">
                        <div className="flex items-start gap-2.5">
                          {img ? (
                            // Plain <img>, loaded straight away, so it's there when the page is printed.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={img} alt="" width={36} height={36} loading="eager" className="size-9 shrink-0 rounded bg-white object-contain ring-1 ring-neutral-200" />
                          ) : null}
                          <div className="min-w-0">
                            <p className="font-medium break-words uppercase">{it.name}</p>
                            <p className="mt-0.5 text-[10.5px] text-neutral-500">
                              {it.sku}
                              {it.packSize && ` · ${it.packSize}`}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-1.5 text-right tabular-nums">{money(sold.priceCents)}</td>
                      <td className="py-2.5 px-1.5 text-center whitespace-nowrap uppercase">{per !== null ? `CTN [${qty(per)}]` : sold.unit}</td>
                      <td className="py-2.5 px-1.5 text-right tabular-nums">{qty(sold.qty)}</td>
                      <td className="py-2.5 px-1.5 text-center text-neutral-400">–</td>
                      <td className="py-2.5 px-1.5 text-right tabular-nums">
                        {money(taxCents)}
                        <span className="block text-[10px] text-neutral-500">{it.gst ? "GST(10%)" : "GST Free(0%)"}</span>
                      </td>
                      <td className="py-2.5 pr-2 pl-1.5 text-right font-medium tabular-nums">{money(it.lineCents)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-neutral-400 font-semibold">
                  <td colSpan={4} className="py-2 pl-2 text-[11px] tracking-wide uppercase">
                    Total quantity
                  </td>
                  <td className="py-2 px-1.5 text-right tabular-nums">{qty(totalQty)}</td>
                  <td colSpan={3} />
                </tr>
              </tbody>
            </table>
          </div>

          <div className="keep mt-4 flex justify-end">
            <dl className="w-[88mm] max-w-full text-[12.5px]">
              {totals.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-2 py-[3px] text-neutral-700">
                  <dt>{k}</dt>
                  <dd className="tabular-nums">{money(v)}</dd>
                </div>
              ))}
              <div className="mt-1.5 flex justify-between gap-4 border-t border-neutral-300 px-2 pt-2 text-[15px] font-semibold">
                <dt>Invoice Amount</dt>
                <dd className="tabular-nums">{aud(so.totalCents)}</dd>
              </div>
              {so.creditAppliedCents > 0 && (
                <div className="flex justify-between gap-4 px-2 py-[3px] text-neutral-700">
                  <dt>Paid with store credit</dt>
                  <dd className="tabular-nums">−{aud(so.creditAppliedCents)}</dd>
                </div>
              )}
              {!cancelled && (
                <div className="mt-1 flex justify-between gap-4 px-2 py-1 text-[15px] font-semibold">
                  <dt>{so.paymentStatus === "paid" ? "Amount Due (paid in full)" : "Amount Due"}</dt>
                  <dd className="tabular-nums">{aud(dueCents)}</dd>
                </div>
              )}
            </dl>
          </div>

          {delivery && (
            <section className="keep mt-8 flex justify-end">
              <div className="w-[88mm] max-w-full px-2">
                <p className={label}>Proof of delivery</p>
                {delivery.signatureUrl ? (
                  <>
                    {/* The saved signature carries a stamp strip at the bottom (order, time, GPS); show just the signature. */}
                    <div className="mt-2 aspect-[1000/320] w-full overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element -- private proof image, served with the viewer's session */}
                      <img src={delivery.signatureUrl} alt={`Signature${delivery.recipient ? ` of ${delivery.recipient}` : ""}`} className="w-full" />
                    </div>
                    <div className="border-t border-neutral-500" />
                  </>
                ) : (
                  <div className="mt-6 border-t border-neutral-300" />
                )}
                <p className="mt-1.5 text-[11px] text-neutral-600">
                  {delivery.recipient ? (
                    <>
                      Received by <span className="font-semibold text-neutral-900">{delivery.recipient}</span> ·{" "}
                    </>
                  ) : delivery.signatureUrl ? (
                    "Signed by the customer · "
                  ) : null}
                  Delivered {delivery.at}
                </p>
              </div>
            </section>
          )}

          {/* Bank details at the foot of the first page (mt-auto), on screen and on paper; on a long invoice they follow the totals. */}
          <footer className="keep mt-auto pt-10 text-[11.5px] leading-relaxed text-neutral-700">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                {!cancelled && bankDetails && so.paymentMethod !== "card" && so.paymentStatus === "unpaid" && (
                  <>
                    <p className="whitespace-pre-wrap uppercase">{bankDetails}</p>
                    <p className="mt-1 uppercase">
                      Reference: <span className="font-semibold text-neutral-900">{so.number}</span>
                    </p>
                  </>
                )}
                <p className={bankDetails ? "mt-2 text-neutral-500" : "text-neutral-500"}>
                  Payment: {PAYMENT_METHOD_LABEL[so.paymentMethod]} · {PAYMENT_STATUS[so.paymentStatus].label}
                </p>
                {proforma && !cancelled && <p className="mt-1 text-neutral-500">This proforma may change until the order is final. Your tax invoice follows then.</p>}
              </div>
              <p className="text-[10.5px] text-neutral-400">Thank you for your business</p>
            </div>
            <p className="mt-6 border-t border-neutral-200 pt-2 text-[10.5px] text-neutral-500">{so.number}</p>
          </footer>
        </div>
      </article>
    </div>
  );
}
