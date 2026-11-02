import { SITE } from "@/app/(site)/content";
import { prettyDate } from "@/lib/dates";
import type { customers, salesOrderItems, salesOrders } from "@/lib/db/schema";
import { aud, PAYMENT_METHOD_LABEL, PAYMENT_STATUS } from "@/lib/money";
import { Logo } from "./brand";
import { PrintButton } from "./print-button";
import { T, Tx } from "@/components/i18n";

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
        <PrintButton className="inline-flex h-10 items-center gap-2 rounded-full bg-leaf-700 px-4 text-sm font-semibold text-white" label={<T>{"Print / save PDF"}</T>} />
      </div>
      <article className="rounded-3xl border border-leaf-950/10 bg-white p-6 text-sm sm:p-10 print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-3">
            <Logo className="h-14" />
            <div className="border-l border-leaf-950/10 pl-3">
              <p className="font-display text-lg font-semibold">{SITE.name}</p>
              {SITE.abn && <p className="text-xs text-leaf-900/60"><T>{"ABN"}</T>{" "}{SITE.abn}</p>}
              {SITE.address && <p className="text-xs text-leaf-900/60">{SITE.address}</p>}
              {SITE.email && <p className="text-xs text-leaf-900/60">{SITE.email}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="font-display text-2xl font-semibold tracking-tight">{so.status === "cancelled" ? <T>{"Cancelled invoice"}</T> : <T>{"Tax invoice"}</T>}</p>
            <p className="text-leaf-900/70"><T>{"No."}</T>{" "}{so.number}</p>
            <p className="text-leaf-900/70"><T>{"Issued"}</T>{" "}{issued}</p>
            {so.dueDate && <p className="text-leaf-900/70"><T>{"Due"}</T>{" "}{<Tx>{prettyDate(so.dueDate)}</Tx>}</p>}
          </div>
        </header>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-leaf-900/45"><T>{"Bill to"}</T></p>
            <p className="mt-1 font-semibold">{customer.name}</p>
            {customer.abn && <p className="text-leaf-900/70"><T>{"ABN"}</T>{" "}{customer.abn}</p>}
            {customer.address && <p className="text-leaf-900/70">{customer.address}</p>}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-leaf-900/45"><T>{"Deliver to"}</T></p>
            <p className="mt-1 font-semibold">{so.recipient}</p>
            <p className="text-leaf-900/70">{so.address}</p>
            <p className="text-leaf-900/70">{<Tx>{prettyDate(so.deliveryDate)}</Tx>}</p>
          </div>
        </div>
        <table className="mt-8 w-full">
          <thead className="border-b border-leaf-950/15 text-left text-xs text-leaf-900/60">
            <tr>
              <th className="py-2 font-medium"><T>{"Item"}</T></th>
              <th className="py-2 text-right font-medium"><T>{"Qty"}</T></th>
              <th className="py-2 text-right font-medium"><T>{"Unit (ex GST)"}</T></th>
              <th className="py-2 text-right font-medium"><T>{"Amount (ex GST)"}</T></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-leaf-950/5">
                <td className="py-2.5">
                  {it.name}
                  {!it.gst && <span className="text-leaf-900/50"> {" "}<T>{"(GST free)"}</T></span>}
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
                <td className="py-2.5"><T>{"Delivery"}</T></td>
                <td />
                <td />
                <td className="py-2.5 text-right tabular-nums">{aud(so.deliveryFeeCents)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <dl className="mt-4 ml-auto w-full max-w-xs space-y-1">
          <div className="flex justify-between text-leaf-900/70">
            <dt><T>{"Subtotal (ex GST)"}</T></dt>
            <dd className="tabular-nums">{aud(so.subtotalCents + so.deliveryFeeCents)}</dd>
          </div>
          <div className="flex justify-between text-leaf-900/70">
            <dt><T>{"GST"}</T></dt>
            <dd className="tabular-nums">{aud(so.gstCents)}</dd>
          </div>
          <div className="flex justify-between border-t border-leaf-950/15 pt-2 font-display text-lg font-semibold">
            <dt><T>{"Total (incl. GST)"}</T></dt>
            <dd className="tabular-nums">{aud(so.totalCents)}</dd>
          </div>
        </dl>
        <footer className="mt-8 border-t border-leaf-950/10 pt-4 text-xs text-leaf-900/70">
          <p>
            <T>{"Payment:"}</T>{" "}{PAYMENT_METHOD_LABEL[so.paymentMethod]} · {<Tx>{PAYMENT_STATUS[so.paymentStatus].label}</Tx>}
          </p>
          {so.paymentStatus === "unpaid" && so.paymentMethod !== "card" && bankDetails && (
            <p className="mt-2 whitespace-pre-wrap">
              {bankDetails}
              {"\n"}<T>{"Reference:"}</T>{" "}{so.number}
            </p>
          )}
        </footer>
      </article>
    </div>
  );
}
