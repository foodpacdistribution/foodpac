import { SITE } from "@/app/(site)/content";
import { prettyDate } from "@/lib/dates";
import type { customers, salesOrderItems, salesOrders } from "@/lib/db/schema";
import { aud, PAYMENT_METHOD_LABEL, PAYMENT_STATUS } from "@/lib/money";
import { BrandMark } from "./brand";
import { PrintButton } from "./print-button";

/** Printable tax invoice for one shop order (customer portal and back office). */
export function InvoiceSheet({
  so,
  customer,
  items,
  issued,
  bankDetails,
}: {
  so: typeof salesOrders.$inferSelect;
  customer: typeof customers.$inferSelect;
  items: (typeof salesOrderItems.$inferSelect)[];
  issued: string;
  bankDetails: string;
}) {
  return (
    <div>
      <div className="no-print mb-4 flex justify-end">
        <PrintButton className="inline-flex h-10 items-center gap-2 rounded-full bg-leaf-700 px-4 text-sm font-semibold text-white" label="Print / save PDF" />
      </div>
      <article className="rounded-3xl border border-leaf-950/10 bg-white p-6 text-sm sm:p-10 print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-3">
            <BrandMark className="size-10" />
            <div>
              <p className="font-display text-lg font-semibold">{SITE.name}</p>
              {SITE.abn && <p className="text-xs text-leaf-900/60">ABN {SITE.abn}</p>}
              {SITE.address && <p className="text-xs text-leaf-900/60">{SITE.address}</p>}
              {SITE.email && <p className="text-xs text-leaf-900/60">{SITE.email}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="font-display text-2xl font-semibold tracking-tight">{so.status === "cancelled" ? "Cancelled invoice" : "Tax invoice"}</p>
            <p className="text-leaf-900/70">No. {so.number}</p>
            <p className="text-leaf-900/70">Issued {issued}</p>
            {so.dueDate && <p className="text-leaf-900/70">Due {prettyDate(so.dueDate)}</p>}
          </div>
        </header>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-leaf-900/45">Bill to</p>
            <p className="mt-1 font-semibold">{customer.name}</p>
            {customer.abn && <p className="text-leaf-900/70">ABN {customer.abn}</p>}
            {customer.address && <p className="text-leaf-900/70">{customer.address}</p>}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-leaf-900/45">Deliver to</p>
            <p className="mt-1 font-semibold">{so.recipient}</p>
            <p className="text-leaf-900/70">{so.address}</p>
            <p className="text-leaf-900/70">{prettyDate(so.deliveryDate)}</p>
          </div>
        </div>
        <table className="mt-8 w-full">
          <thead className="border-b border-leaf-950/15 text-left text-xs text-leaf-900/60">
            <tr>
              <th className="py-2 font-medium">Item</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Unit (ex GST)</th>
              <th className="py-2 text-right font-medium">Amount (ex GST)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-leaf-950/5">
                <td className="py-2.5">
                  {it.name}
                  {!it.gst && <span className="text-leaf-900/50"> (GST free)</span>}
                  <span className="block text-xs text-leaf-900/50">
                    {it.sku} · {it.packSize}
                  </span>
                </td>
                <td className="py-2.5 text-right tabular-nums">
                  {it.qty} {it.unit}
                </td>
                <td className="py-2.5 text-right tabular-nums">{aud(it.unitPriceCents)}</td>
                <td className="py-2.5 text-right tabular-nums">{aud(it.lineCents)}</td>
              </tr>
            ))}
            {so.deliveryFeeCents > 0 && (
              <tr className="border-b border-leaf-950/5">
                <td className="py-2.5">Delivery</td>
                <td />
                <td />
                <td className="py-2.5 text-right tabular-nums">{aud(so.deliveryFeeCents)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <dl className="mt-4 ml-auto w-full max-w-xs space-y-1">
          <div className="flex justify-between text-leaf-900/70">
            <dt>Subtotal (ex GST)</dt>
            <dd className="tabular-nums">{aud(so.subtotalCents + so.deliveryFeeCents)}</dd>
          </div>
          <div className="flex justify-between text-leaf-900/70">
            <dt>GST</dt>
            <dd className="tabular-nums">{aud(so.gstCents)}</dd>
          </div>
          <div className="flex justify-between border-t border-leaf-950/15 pt-2 font-display text-lg font-semibold">
            <dt>Total (incl. GST)</dt>
            <dd className="tabular-nums">{aud(so.totalCents)}</dd>
          </div>
        </dl>
        <footer className="mt-8 border-t border-leaf-950/10 pt-4 text-xs text-leaf-900/70">
          <p>
            Payment: {PAYMENT_METHOD_LABEL[so.paymentMethod]} · {PAYMENT_STATUS[so.paymentStatus].label}
          </p>
          {so.paymentStatus === "unpaid" && so.paymentMethod !== "card" && bankDetails && (
            <p className="mt-2 whitespace-pre-wrap">
              {bankDetails}
              {"\n"}Reference: {so.number}
            </p>
          )}
        </footer>
      </article>
    </div>
  );
}
