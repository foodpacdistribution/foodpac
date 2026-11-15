import { Gift, ShoppingCart, TriangleAlert, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { aud } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { canSeePrices, catalogFor, type CatalogItem, getCart, quote, recentlyBought } from "@/lib/shop";
import { firstOrderOfferFor, openOffer } from "@/lib/first-order-offer";
import { worthOffering } from "@/lib/recommend";
import { prettyDate } from "@/lib/dates";
import { todayIn } from "@/lib/time";
import { lastOrder } from "@/app/portal/orders/data";
import { RepeatOrder } from "@/app/portal/repeat-order";
import { ProductCard, ProductImage } from "../shop-ui";
import { CartQty } from "./cart-line";
import { T, Tx } from "@/components/i18n";

export const metadata: Metadata = { title: "Cart" };

export default async function CartPage() {
  const viewer = await getCurrentCustomer();
  if (!viewer) redirect("/login?next=%2Fcart");
  const db = await getDb();
  const [lines, s] = await Promise.all([getCart(db, viewer.customer), getSettings(db)]);
  // An empty cart offers the last order again and what they've bought before.
  const priced = canSeePrices(viewer.customer);
  const [last, again] = lines.length === 0 && priced ? await Promise.all([lastOrder(db, viewer.customer.id), recentlyBought(db, viewer.customer, 4)]) : [null, []];
  const q = quote(lines, s);
  const blocked = lines.some((l) => l.issue) || q.belowMinimum || !canSeePrices(viewer.customer);
  // How far from free delivery, and from a first-order offer, plus a few things to top up with.
  const freeGap = q.deliveryFeeCents > 0 && s.freeDeliveryOverCents > 0 ? s.freeDeliveryOverCents - q.subtotalCents : 0;
  const offer = lines.length && priced ? openOffer(viewer.customer) : null;
  const offerOn = offer && (await firstOrderOfferFor(db, viewer.customer, Number.MAX_SAFE_INTEGER)) > 0 ? offer : null;
  const topUp = lines.length && priced ? await topUpItems(db, viewer.customer, new Set(lines.map((l) => l.id))) : [];

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
      ) : null}
      {lines.length === 0 && last && (
        <RepeatOrder
          className="mt-4"
          order={{ ...last, date: prettyDate(todayIn(s.timezone, last.createdAt), { weekday: "short", day: "numeric", month: "short" }) }}
        />
      )}
      {lines.length === 0 && again.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-leaf-900/50 uppercase"><T>{"Bought before"}</T></h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {again.map((p) => (
              <ProductCard key={p.id} p={p} signedIn />
            ))}
          </div>
        </section>
      )}
      {lines.length === 0 ? null : (
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
            {offerOn && (
              <Progress icon={Gift} done={q.subtotalCents >= offerOn.minCents} have={q.subtotalCents} need={offerOn.minCents}>
                {q.subtotalCents >= offerOn.minCents ? (
                  <T vars={{ amount: aud(offerOn.offCents) }}>{"First-order offer: {amount} off at checkout"}</T>
                ) : (
                  <T vars={{ more: aud(offerOn.minCents - q.subtotalCents), amount: aud(offerOn.offCents) }}>{"Add {more} more to get {amount} off your first order"}</T>
                )}
              </Progress>
            )}
            {freeGap > 0 && (
              <Progress icon={Truck} done={false} have={q.subtotalCents} need={s.freeDeliveryOverCents}>
                <T vars={{ more: aud(freeGap) }}>{"Add {more} more for free delivery"}</T>
              </Progress>
            )}
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
          {topUp.length > 0 && (
            <section className="lg:col-start-1">
              <h2 className="text-xs font-semibold tracking-[0.14em] text-leaf-900/50 uppercase">
                {freeGap > 0 ? <T>{"Top up for free delivery"}</T> : <T>{"Anything else you need?"}</T>}
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                {topUp.map((p) => (
                  <ProductCard key={p.id} p={p} signedIn />
                ))}
              </div>
            </section>
          )}
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

/** A bar towards a spend target (free delivery, a first-order offer), with what's left to add. */
function Progress({ icon: Icon, done, have, need, children }: { icon: typeof Truck; done: boolean; have: number; need: number; children: React.ReactNode }) {
  return (
    <div className={`mb-4 rounded-xl px-3 py-2.5 text-sm ${done ? "bg-leaf-50 text-leaf-900" : "bg-[#f5f1e8] text-leaf-950"}`}>
      <p className="flex items-center gap-2 font-medium">
        <Icon className="size-4 shrink-0 text-leaf-700" /> {children}
      </p>
      {!done && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-leaf-950/10">
          <div className="h-full rounded-full bg-leaf-600" style={{ width: `${Math.min(100, Math.round((have / need) * 100))}%` }} />
        </div>
      )}
    </div>
  );
}

/**
 * Up to four things to add: what they usually buy that isn't in the cart, then what stores like
 * them buy. In stock only, so adding one doesn't hold up the order.
 */
async function topUpItems(db: Awaited<ReturnType<typeof getDb>>, customer: Parameters<typeof recentlyBought>[1], inCart: Set<string>) {
  const fresh = (items: CatalogItem[]) => items.filter((p) => !inCart.has(p.id) && p.stock > 0);
  const usual = fresh(await recentlyBought(db, customer, 16));
  if (usual.length >= 4) return usual.slice(0, 4);
  const more = fresh(await catalogFor(db, customer, (await worthOffering(db, customer.id, 8)).map((x) => x.productId)));
  return [...usual, ...more.filter((p) => !usual.some((u) => u.id === p.id))].slice(0, 4);
}
