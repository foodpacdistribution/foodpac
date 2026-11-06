import type { SiteInfo } from "@/app/(site)/site-info";
import { prettyDate } from "@/lib/dates";
import type { customers, salesOrderItems, salesOrders } from "@/lib/db/schema";
import { loadZh, translate } from "@/lib/i18n";
import { zhDates } from "@/lib/i18n/zh-dates";
import { aud, PAYMENT_METHOD_LABEL, PAYMENT_STATUS } from "@/lib/money";
import { Logo } from "./brand";
import { PrintButton } from "./print-button";
import { T } from "@/components/i18n";

/**
 * Printable invoice for one shop order (customer portal and back office): a proforma until staff
 * make it final. Always in English and Chinese, whoever prints it, so the PDF or paper copy works
 * for every reader. Product names stay as entered. Each line shows the product's photo.
 */
export async function InvoiceSheet({
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
  const zh = await loadZh();
  const cn = (en: string) => translate(zh, en);
  /** "English 中文" for a label; the Chinese is quieter so English stays the lead language. */
  const l = (en: string, stacked?: boolean) => {
    const c = cn(en);
    if (c === en) return <>{en}</>;
    return stacked ? (
      <>
        {en}
        <span className="block text-[11px] font-normal text-leaf-900/55">{c}</span>
      </>
    ) : (
      <>
        {en} <span className="font-normal text-leaf-900/55">{c}</span>
      </>
    );
  };
  const date = (d: string) => (
    <>
      {prettyDate(d)} <span className="text-leaf-900/55">{zhDates(prettyDate(d))}</span>
    </>
  );
  const proforma = so.invoiceStatus === "proforma";
  const title = so.status === "cancelled" ? "Cancelled invoice" : proforma ? "Proforma invoice" : "Tax invoice";
  const hasPhotos = items.some((it) => it.productId && images[it.productId]);

  return (
    <div>
      <div className="no-print mb-4 flex justify-end">
        <PrintButton className="inline-flex h-10 items-center gap-2 rounded-full bg-leaf-700 px-4 text-sm font-semibold text-white" label={<T>{"Print / save PDF"}</T>} />
      </div>
      <article className="rounded-3xl border border-leaf-950/10 bg-white p-6 text-sm sm:p-10 print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-3">
            <Logo className="h-14" />
            <div className="border-l border-leaf-950/10 pl-3">
              <p className="font-display text-lg font-semibold">{site.name}</p>
              {site.abn && <p className="text-xs text-leaf-900/60">ABN {site.abn}</p>}
              {site.address && <p className="text-xs text-leaf-900/60">{site.address}</p>}
              {site.email && <p className="text-xs text-leaf-900/60">{site.email}</p>}
              {site.phone && <p className="text-xs text-leaf-900/60">{site.phone}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="font-display text-2xl font-semibold tracking-tight">{title}</p>
            <p className="font-display text-lg font-semibold text-leaf-900/70">{cn(title)}</p>
            <p className="mt-1 text-leaf-900/70">{l("No.")} {so.number}</p>
            <p className="text-leaf-900/70">{l(proforma ? "Date" : "Issued")} {issued} <span className="text-leaf-900/55">{zhDates(issued)}</span></p>
            {so.dueDate && <p className="text-leaf-900/70">{l("Due")} {date(so.dueDate)}</p>}
          </div>
        </header>
        {proforma && so.status !== "cancelled" && (
          <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 print:border-amber-500">
            <p>{"This is a proforma invoice, not a tax invoice. Quantities and prices may still change. The tax invoice follows once the order is final."}</p>
            <p className="mt-1">{cn("This is a proforma invoice, not a tax invoice. Quantities and prices may still change. The tax invoice follows once the order is final.")}</p>
          </div>
        )}
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-leaf-900/45">{l("Bill to")}</p>
            <p className="mt-1 font-semibold">{customer.name}</p>
            {customer.abn && <p className="text-leaf-900/70">ABN {customer.abn}</p>}
            {customer.address && <p className="text-leaf-900/70">{customer.address}</p>}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-leaf-900/45">{l("Deliver to")}</p>
            <p className="mt-1 font-semibold">{so.recipient}</p>
            <p className="text-leaf-900/70">{so.address}</p>
            <p className="text-leaf-900/70">{date(so.deliveryDate)}</p>
          </div>
        </div>
        <table className="mt-8 w-full">
          <thead className="border-b border-leaf-950/15 text-left align-bottom text-xs text-leaf-900/60">
            <tr>
              <th className="py-2 font-medium" colSpan={hasPhotos ? 2 : 1}>{l("Item", true)}</th>
              <th className="py-2 text-right font-medium">{l("Qty", true)}</th>
              <th className="py-2 pl-3 text-right font-medium">{l("Unit (ex GST)", true)}</th>
              <th className="py-2 pl-3 text-right font-medium">{l("Amount (ex GST)", true)}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const img = it.productId ? images[it.productId] : undefined;
              return (
                <tr key={it.id} className="border-b border-leaf-950/5 break-inside-avoid">
                  {hasPhotos && (
                    <td className="w-14 py-2 pr-3 align-middle">
                      {img ? (
                        // Plain <img>, loaded straight away, so it's there when the page is printed.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="" width={44} height={44} loading="eager" className="size-11 rounded-lg border border-leaf-950/10 bg-white object-cover" />
                      ) : (
                        <span className="block size-11 rounded-lg border border-dashed border-leaf-950/15" />
                      )}
                    </td>
                  )}
                  <td className="py-2.5">
                    {it.name}
                    {!it.gst && <span className="text-leaf-900/50"> (GST free · {cn("GST free")})</span>}
                    <span className="block text-xs text-leaf-900/50">
                      {it.sku} · {it.packSize}
                    </span>
                  </td>
                  <td className="py-2.5 text-right whitespace-nowrap tabular-nums">
                    {it.qty} {it.unit}
                    {cn(it.unit) !== it.unit && <span className="block text-xs text-leaf-900/50">{cn(it.unit)}</span>}
                  </td>
                  <td className="py-2.5 pl-3 text-right tabular-nums">{aud(it.unitPriceCents)}</td>
                  <td className="py-2.5 pl-3 text-right tabular-nums">{aud(it.lineCents)}</td>
                </tr>
              );
            })}
            {so.deliveryFeeCents > 0 && (
              <tr className="border-b border-leaf-950/5">
                <td className="py-2.5" colSpan={hasPhotos ? 2 : 1}>{l("Delivery")}</td>
                <td />
                <td />
                <td className="py-2.5 pl-3 text-right tabular-nums">{aud(so.deliveryFeeCents)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <dl className="mt-4 ml-auto w-full max-w-sm space-y-1">
          <div className="flex justify-between gap-4 text-leaf-900/70">
            <dt>{l("Subtotal (ex GST)")}</dt>
            <dd className="tabular-nums">{aud(so.subtotalCents + so.deliveryFeeCents)}</dd>
          </div>
          <div className="flex justify-between gap-4 text-leaf-900/70">
            <dt>GST</dt>
            <dd className="tabular-nums">{aud(so.gstCents)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-leaf-950/15 pt-2 font-display text-lg font-semibold">
            <dt>{l("Total (incl. GST)")}</dt>
            <dd className="tabular-nums">{aud(so.totalCents)}</dd>
          </div>
          {so.creditAppliedCents > 0 && (
            <>
              <div className="flex justify-between gap-4 text-leaf-900/70">
                <dt>{l("Paid with store credit")}</dt>
                <dd className="tabular-nums">−{aud(so.creditAppliedCents)}</dd>
              </div>
              <div className="flex justify-between gap-4 font-semibold">
                <dt>{l("Amount due")}</dt>
                <dd className="tabular-nums">{aud(so.paymentStatus === "unpaid" ? so.totalCents - so.creditAppliedCents : 0)}</dd>
              </div>
            </>
          )}
        </dl>
        <footer className="mt-8 border-t border-leaf-950/10 pt-4 text-xs text-leaf-900/70">
          <p>
            {l("Payment:")} {l(PAYMENT_METHOD_LABEL[so.paymentMethod])} · {l(PAYMENT_STATUS[so.paymentStatus].label)}
          </p>
          {so.paymentStatus === "unpaid" && so.paymentMethod !== "card" && bankDetails && (
            <p className="mt-2 whitespace-pre-wrap">
              {bankDetails}
              {"\n"}{l("Reference:")} {so.number}
            </p>
          )}
        </footer>
      </article>
    </div>
  );
}
