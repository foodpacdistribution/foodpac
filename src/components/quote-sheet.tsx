import type { SiteInfo } from "@/app/(site)/site-info";
import { prettyDate } from "@/lib/dates";
import type { customers, quoteItems, quotes } from "@/lib/db/schema";
import { aud } from "@/lib/money";
import { Logo } from "./brand";
import { PrintButton } from "./print-button";

/**
 * A printable quotation, laid out like the invoice (see InvoiceSheet and `.invoice-sheet` in
 * globals.css): an A4 sheet on screen, A4 pages on paper, lines never split across pages.
 */
export function QuoteSheet({
  quote: q,
  customer,
  items,
  issued,
  site,
  images = {},
}: {
  quote: typeof quotes.$inferSelect;
  customer: typeof customers.$inferSelect;
  items: (typeof quoteItems.$inferSelect)[];
  /** The quote's date, already formatted. */
  issued: string;
  site: SiteInfo;
  /** productId → photo URL. */
  images?: Record<string, string>;
}) {
  const hasPhotos = items.some((it) => it.productId && images[it.productId]);
  const contact = [site.phone, site.email].filter(Boolean).join(" · ");
  const label = "text-[10px] font-semibold tracking-[0.12em] text-leaf-900/45 uppercase";
  const valid = prettyDate(q.validUntil, { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="invoice-page">
      <div className="no-print mx-auto mb-4 flex w-full max-w-[210mm] items-center justify-between gap-3">
        <p className="text-xs text-leaf-900/60">A4 · choose “Save as PDF” in the print window for a PDF copy.</p>
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
                {site.address && <p>{site.address}</p>}
                {contact && <p>{contact}</p>}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-display text-[26px] leading-none font-bold tracking-tight text-leaf-900">Quotation</p>
              <p className="mt-2.5 text-[11px] text-leaf-900/55">Not a tax invoice</p>
            </div>
          </header>

          <dl className="keep mt-8 grid grid-cols-2 overflow-hidden rounded-xl bg-leaf-50/70 ring-1 ring-leaf-950/8 sm:grid-cols-4">
            {[
              ["Quote no.", <span key="n" className="font-semibold">{q.number}</span>],
              ["Date", issued],
              ["Valid until", valid],
              ["Total (incl. GST)", <span key="a" className="text-base font-bold">{aud(q.totalCents)}</span>],
            ].map(([k, v], i) => (
              <div key={String(k)} className={`px-4 py-3 ${i > 0 ? "sm:border-l sm:border-leaf-950/8" : ""} ${i % 2 ? "max-sm:border-l max-sm:border-leaf-950/8" : ""} ${i > 1 ? "max-sm:border-t max-sm:border-leaf-950/8" : ""}`}>
                <dt className={label}>{k}</dt>
                <dd className="mt-1 tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="keep mt-8 grid grid-cols-2 gap-8 text-[12px] leading-relaxed">
            <div>
              <p className={label}>Prepared for</p>
              <p className="mt-1.5 text-[13px] font-semibold">{customer.name}</p>
              <p className="text-leaf-900/65">Customer code {customer.code}</p>
              {customer.abn && <p className="text-leaf-900/65">ABN {customer.abn}</p>}
              {customer.address && <p className="text-leaf-900/65">{customer.address}</p>}
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
                          // eslint-disable-next-line @next/next/no-img-element -- loaded straight away so it's there when printed
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
              {q.deliveryFeeCents > 0 && (
                <tr className="border-b border-leaf-950/8">
                  <td className="py-2.5 pl-3" colSpan={hasPhotos ? 2 : 1}>
                    Delivery
                  </td>
                  <td />
                  <td />
                  <td className="py-2.5 pr-3 text-right font-medium tabular-nums">{aud(q.deliveryFeeCents)}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="keep mt-5 flex justify-end">
            <dl className="w-[80mm] max-w-full text-[13px]">
              <div className="flex justify-between gap-4 px-3 py-1 text-leaf-900/65">
                <dt>Subtotal (ex GST)</dt>
                <dd className="tabular-nums">{aud(q.subtotalCents + q.deliveryFeeCents)}</dd>
              </div>
              <div className="flex justify-between gap-4 px-3 py-1 text-leaf-900/65">
                <dt>GST (10%)</dt>
                <dd className="tabular-nums">{aud(q.gstCents)}</dd>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-4 rounded-lg bg-leaf-900 px-3 py-2.5 text-white">
                <dt className="text-[13px] font-medium">Total (AUD, incl. GST)</dt>
                <dd className="text-lg font-bold tabular-nums">{aud(q.totalCents)}</dd>
              </div>
            </dl>
          </div>

          {q.notes && (
            <section className="keep mt-8">
              <p className={label}>Notes</p>
              <p className="mt-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-leaf-900/80">{q.notes}</p>
            </section>
          )}

          <footer className="keep mt-auto pt-10 text-[11.5px] leading-relaxed text-leaf-900/70">
            <div className="border-t border-leaf-950/10 pt-5">
              <p className={label}>How to accept</p>
              <p className="mt-1.5">
                Prices are valid until {valid}. To go ahead, reply to us{site.email ? ` at ${site.email}` : ""}{site.phone ? ` or call ${site.phone}` : ""} quoting{" "}
                <span className="font-semibold text-leaf-950">{q.number}</span>, and we&apos;ll book in your delivery. Stock is confirmed when the order is placed.
              </p>
            </div>
            <p className="mt-8 text-center text-[11px] text-leaf-900/45">Thank you for the opportunity · {site.name}</p>
          </footer>
        </div>
      </article>
    </div>
  );
}
