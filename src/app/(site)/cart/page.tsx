import { ShoppingCart, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { aud } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { canSeePrices, getCart, quote } from "@/lib/shop";
import { ProductImage } from "../shop-ui";
import { CartQty } from "./cart-line";
import { T, Tx } from "@/components/i18n";

export const metadata: Metadata = { title: "Cart" };

export default async function CartPage() {
  const viewer = await getCurrentCustomer();
  if (!viewer) redirect("/login?next=%2Fcart");
  const db = await getDb();
  const [lines, s] = await Promise.all([getCart(db, viewer.customer), getSettings(db)]);
  const q = quote(lines, s);
  const blocked = lines.some((l) => l.issue) || q.belowMinimum || !canSeePrices(viewer.customer);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight"><T>{"Your cart"}</T></h1>
      {lines.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-leaf-950/15 bg-white px-6 py-14 text-center">
          <ShoppingCart className="mx-auto size-10 text-leaf-700/60" />
          <p className="mt-3 font-semibold"><T>{"Your cart is empty"}</T></p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/products" className="inline-flex h-10 items-center rounded-md bg-leaf-700 px-5 text-sm font-semibold text-white">
              <T>{"Browse products"}</T></Link>
            <Link href="/portal/quick-order" className="inline-flex h-10 items-center rounded-md border border-leaf-950/15 bg-white px-5 text-sm font-semibold">
              <T>{"Quick order"}</T></Link>
          </div>
        </div>
      ) : (
        <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_340px]">
          <section className="overflow-hidden rounded-3xl border border-leaf-950/10 bg-white">
            {lines.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-4 border-b border-leaf-950/5 p-4 last:border-0">
                <ProductImage p={l} sizes="64px" className="size-16 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <Link href={`/products/${encodeURIComponent(l.sku)}`} className="font-semibold hover:text-leaf-700">
                    {l.name}
                  </Link>
                  <p className="text-xs text-leaf-900/55">
                    {l.sku} · {l.packSize} · {aud(l.priceCents)} / {l.unit}
                  </p>
                  {l.issue && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-red-700">
                      <TriangleAlert className="size-3.5" /> {l.issue}
                    </p>
                  )}
                </div>
                <CartQty productId={l.id} qty={l.qty} minQty={l.minQty} />
                <p className="w-24 text-right font-semibold tabular-nums">{aud(l.lineCents)}</p>
              </div>
            ))}
          </section>
          <aside className="h-fit rounded-3xl border border-leaf-950/10 bg-white p-5 lg:sticky lg:top-36">
            <dl className="space-y-2 text-sm">
              <Row label={<T>{"Subtotal (ex GST)"}</T>} value={aud(q.subtotalCents)} />
              <Row
                label={<T>{"Delivery"}</T>}
                value={q.deliveryFeeCents ? aud(q.deliveryFeeCents) : "Free"}
                hint={q.deliveryFeeCents && s.freeDeliveryOverCents ? `Free over ${aud(s.freeDeliveryOverCents)}` : undefined}
              />
              <Row label={<T>{"GST"}</T>} value={aud(q.gstCents)} />
              <div className="flex justify-between border-t border-leaf-950/10 pt-3 font-display text-lg font-semibold">
                <dt><T>{"Total"}</T></dt>
                <dd className="tabular-nums">{aud(q.totalCents)}</dd>
              </div>
            </dl>
            {q.belowMinimum && <p className="mt-3 text-xs text-red-700"><T>{"The minimum order is"}</T>{" "}{aud(s.minOrderCents)} {" "}<T>{"before GST."}</T></p>}
            {blocked ? (
              <span className="mt-4 flex h-12 w-full items-center justify-center rounded-md bg-leaf-950/10 text-sm font-semibold text-leaf-900/50">
                {canSeePrices(viewer.customer) ? <T>{"Fix the items above to continue"}</T> : <T>{"Waiting for account approval"}</T>}
              </span>
            ) : (
              <Link href="/checkout" className="mt-4 flex h-12 w-full items-center justify-center rounded-md bg-tomato text-base font-semibold text-white hover:bg-tomato-dark">
                <T>{"Checkout"}</T></Link>
            )}
            <p className="mt-3 text-center text-xs text-leaf-900/50"><T>{"Stock is reserved when you place the order."}</T></p>
          </aside>
        </div>
      )}
    </main>
  );
}

function Row({ label, value, hint }: { label: React.ReactNode; value: string; hint?: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-leaf-900/75">
      <dt>
        {<Tx>{label}</Tx>}
        {hint && <span className="block text-[11px] text-leaf-900/45">{<Tx>{hint}</Tx>}</span>}
      </dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
