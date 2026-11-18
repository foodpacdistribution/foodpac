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
import { RollingAmount } from "../cart-badge";
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
      <h1 className="font-display text-[28px] font-semibold tracking-tight sm:text-4xl"><T>{"Your cart"}</T></h1>
      {lines.length === 0 ? (
        <div className="mt-8 border-y border-leaf-950/10 px-6 py-16 text-center">
          <ShoppingCart className="mx-auto size-9 text-leaf-900/25" strokeWidth={1.5} />
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
      {lines.length > 0 && freeGap > 0 && (
        // Phones: how far from free delivery, before the items (the summary is further down).
        <div className="mt-4 lg:hidden">
          <Progress icon={Truck} done={false} have={q.subtotalCents} need={s.freeDeliveryOverCents}>
            <T vars={{ more: aud(freeGap) }}>{"Add {more} more for free delivery"}</T>
          </Progress>
        </div>
      )}
      {lines.length === 0 ? null : (
        <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_340px]">
          <section className="border-y border-leaf-950/10">
            {lines.map((l) => (
              // Phones: photo and name on the first line, quantity and line total under the name.
              <div key={l.id} className="grid grid-cols-[4.5rem_1fr] items-center gap-x-4 gap-y-3 border-b border-leaf-950/8 py-5 last:border-0 sm:flex sm:gap-x-5">
                <Link href={`/products/${encodeURIComponent(l.sku)}`} className="shrink-0 overflow-hidden rounded-lg">
                  <ProductImage p={l} sizes="80px" className="size-[4.5rem] sm:size-20" />
                </Link>
                <div className="min-w-0 sm:flex-1">
                  <Link href={`/products/${encodeURIComponent(l.sku)}`} className="line-clamp-2 leading-snug font-medium hover:underline">
                    {l.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-leaf-900/55">
                    {[l.sku, l.packSize, `${aud(l.priceCents)} / ${l.unit}`].filter(Boolean).join(" · ")}
                  </p>
                  {l.byCarton && l.per && (
                    <p className="mt-0.5 text-xs text-leaf-900/70">
                      <T vars={{ n: l.qty, units: l.units, unit: l.unit, price: aud((l.priceCents ?? 0) * l.per) }}>{"{n} × carton ({units} {unit}) · {price} a carton"}</T>
                    </p>
                  )}
                  {l.issue && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-red-700">
                      <TriangleAlert className="size-3.5" /> {l.issue}
                    </p>
                  )}
                </div>
                <div className="col-start-2 flex items-center justify-between gap-4 sm:contents">
                  <CartQty productId={l.id} qty={l.qty} minQty={l.minQty} unit={l.unit} per={l.per} byCarton={l.byCarton} />
                  <p className="text-right font-semibold tabular-nums sm:w-24">{aud(l.lineCents)}</p>
                </div>
              </div>
            ))}
          </section>
          <aside className="h-fit rounded-2xl bg-white/70 p-6 ring-1 ring-leaf-950/8 lg:sticky lg:top-36">
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
              <Progress icon={Truck} done={false} have={q.subtotalCents} need={s.freeDeliveryOverCents} className="max-lg:hidden">
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
                <dd>
                  <RollingAmount cents={q.totalCents} />
                </dd>
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
          {/* Phones: the total and Checkout stay at the bottom of the screen while scrolling the items. */}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-leaf-950/10 bg-cream/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_rgb(17_58_39/0.25)] backdrop-blur lg:hidden">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1 leading-tight">
                <p className="text-xs text-leaf-900/60">
                  <T>{"Total incl. GST"}</T>
                </p>
                <RollingAmount cents={q.totalCents} className="font-display text-xl font-semibold" />
              </div>
              {blocked ? (
                <span className="flex h-12 items-center rounded-md bg-leaf-950/10 px-4 text-sm font-semibold text-leaf-900/50">
                  {canSeePrices(viewer.customer) ? <T>{"Fix the items above"}</T> : <T>{"Waiting for approval"}</T>}
                </span>
              ) : (
                <Link href="/checkout" className="flex h-12 items-center rounded-md bg-tomato px-7 text-base font-semibold text-white transition-transform active:scale-95">
                  <T>{"Checkout"}</T>
                </Link>
              )}
            </div>
          </div>
          <div aria-hidden className="h-16 lg:hidden" />
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
function Progress({ icon: Icon, done, have, need, children, className = "" }: { icon: typeof Truck; done: boolean; have: number; need: number; children: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-4 rounded-xl px-3 py-2.5 text-sm ${done ? "bg-leaf-50 text-leaf-900" : "bg-[#f5f1e8] text-leaf-950"} ${className}`}>
      <p className="flex items-center gap-2 font-medium">
        <Icon className="size-4 shrink-0 text-leaf-700" /> {children}
      </p>
      {!done && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-leaf-950/10">
          <div className="h-full origin-left animate-[grow-x_700ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-full bg-leaf-600 transition-[width] duration-700 ease-out" style={{ width: `${Math.min(100, Math.round((have / need) * 100))}%` }} />
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
