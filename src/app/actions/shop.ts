"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { attempt } from "@/lib/action";
import { assertCustomer } from "@/lib/auth/dal";
import { hashPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { countAttempt } from "@/lib/auth/throttle";
import { getDb } from "@/lib/db";
import { accountRequested, orderConfirmed } from "@/lib/notify";
import { cartItems, customerAddresses, customers, favourites, orders, type PaymentMethod, products, salesOrderItems, salesOrders, users } from "@/lib/db/schema";
import { getSettings, UserError } from "@/lib/planning";
import { canSeePrices, cancelOrder, placeOrder } from "@/lib/shop";
import { refundOrExpire } from "@/lib/payments";
import { createCheckoutSession, stripeEnabled } from "@/lib/stripe";
import { geocodeOrderIds } from "@/lib/sync";
import { inputToMinutes } from "@/lib/time";

const MAX_QTY = 9999;

function revalidateShop() {
  revalidatePath("/cart");
  revalidatePath("/", "layout");
}

async function addLines(customerId: string, lines: { productId: string; qty: number }[], mode: "add" | "set") {
  const db = await getDb();
  for (const { productId, qty } of lines) {
    const q = Math.min(MAX_QTY, Math.max(0, Math.round(qty)));
    if (mode === "set" && q === 0) {
      await db.delete(cartItems).where(and(eq(cartItems.customerId, customerId), eq(cartItems.productId, productId)));
      continue;
    }
    if (q === 0) continue;
    await db
      .insert(cartItems)
      .values({ customerId, productId, qty: q })
      .onConflictDoUpdate({
        target: [cartItems.customerId, cartItems.productId],
        set: { qty: mode === "add" ? sql`least(${cartItems.qty} + ${q}, ${MAX_QTY})` : q },
      });
  }
}

export async function addToCart(productId: string, qty: number) {
  return attempt(async () => {
    const { customer } = await assertCustomer();
    if (!canSeePrices(customer)) throw new UserError("Your account is waiting for approval.");
    const db = await getDb();
    const [p] = await db.select({ id: products.id, name: products.name, minQty: products.minQty }).from(products).where(and(eq(products.id, productId), eq(products.active, true))).limit(1);
    if (!p) throw new UserError("This product isn't available.");
    await addLines(customer.id, [{ productId, qty: Math.max(qty, 1) }], "add");
    revalidateShop();
    return { message: `${p.name} added to cart` };
  });
}

export async function setCartQty(productId: string, qty: number) {
  return attempt(async () => {
    const { customer } = await assertCustomer();
    await addLines(customer.id, [{ productId, qty }], "set");
    revalidateShop();
  });
}

/** Adds a product to the customer's own list ("My list"), or takes it off. */
export async function setFavourite(productId: string, on: boolean) {
  return attempt(async () => {
    const { customer } = await assertCustomer();
    const db = await getDb();
    if (on) {
      const [p] = await db.select({ id: products.id }).from(products).where(and(eq(products.id, productId), eq(products.active, true))).limit(1);
      if (!p) throw new UserError("This product isn't available.");
      await db.insert(favourites).values({ customerId: customer.id, productId }).onConflictDoNothing();
    } else {
      await db.delete(favourites).where(and(eq(favourites.customerId, customer.id), eq(favourites.productId, productId)));
    }
    revalidatePath("/portal/list");
    return { message: on ? "Saved to My list" : "Removed from My list" };
  });
}

/** Several products at once (My list), each at least its minimum order. */
export async function addManyToCart(lines: { productId: string; qty: number }[]) {
  return attempt(async () => {
    const { customer } = await assertCustomer();
    if (!canSeePrices(customer)) throw new UserError("Your account is waiting for approval.");
    const wanted = lines.filter((l) => Number.isFinite(l.qty) && l.qty > 0).slice(0, 200);
    if (!wanted.length) throw new UserError("Enter a quantity for at least one product.");
    const db = await getDb();
    const found = await db
      .select({ id: products.id, minQty: products.minQty })
      .from(products)
      .where(and(eq(products.active, true), inArray(products.id, wanted.map((l) => l.productId))));
    const ok = wanted.flatMap((l) => {
      const p = found.find((f) => f.id === l.productId);
      return p ? [{ productId: p.id, qty: Math.max(l.qty, p.minQty) }] : [];
    });
    if (!ok.length) throw new UserError("None of those products are available any more.");
    await addLines(customer.id, ok, "add");
    revalidateShop();
    return { message: ok.length === 1 ? "1 product added to cart" : `${ok.length} products added to cart`, data: { units: ok.reduce((t, l) => t + l.qty, 0) } };
  });
}

/** Quick order: one "SKU quantity" per line, e.g. "FP-10001 5". */
export async function quickOrder(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const { customer } = await assertCustomer();
    if (!canSeePrices(customer)) throw new UserError("Your account is waiting for approval.");
    const wanted = String(form.get("lines") ?? "")
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = /^(\S+)[\s,;x×*]+(\d+)$/i.exec(l) ?? /^(\S+)$/.exec(l);
        return m ? { sku: m[1].toUpperCase(), qty: m[2] ? Number(m[2]) : 1, raw: l } : { sku: "", qty: 0, raw: l };
      });
    if (!wanted.length) throw new UserError("Enter at least one SKU.");
    const db = await getDb();
    const found = await db
      .select({ id: products.id, sku: products.sku, minQty: products.minQty })
      .from(products)
      .where(and(eq(products.active, true), inArray(sql`upper(${products.sku})`, wanted.map((w) => w.sku).filter(Boolean))));
    const missing = wanted.filter((w) => !found.some((f) => f.sku.toUpperCase() === w.sku));
    if (missing.length) throw new UserError(`Not found: ${missing.map((m) => m.raw).join(", ")}`);
    await addLines(
      customer.id,
      wanted.map((w) => {
        const p = found.find((f) => f.sku.toUpperCase() === w.sku)!;
        return { productId: p.id, qty: Math.max(w.qty, p.minQty) };
      }),
      "add",
    );
    revalidateShop();
    return { message: `${wanted.length} item${wanted.length === 1 ? "" : "s"} added to cart` };
  });
}

/** Puts everything from a past order back in the cart (still-available products only). */
export async function reorder(salesOrderId: string) {
  return attempt(async () => {
    const { customer } = await assertCustomer();
    const db = await getDb();
    const [so] = await db
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.customerId, customer.id)))
      .limit(1);
    if (!so) throw new UserError("Order not found.");
    const items = await db
      .select({ productId: salesOrderItems.productId, qty: salesOrderItems.qty })
      .from(salesOrderItems)
      .innerJoin(products, eq(products.id, salesOrderItems.productId))
      .where(and(eq(salesOrderItems.salesOrderId, so.id), eq(products.active, true)));
    if (!items.length) throw new UserError("None of these products are available any more.");
    await addLines(customer.id, items.map((i) => ({ productId: i.productId!, qty: i.qty })), "add");
    revalidateShop();
    return { message: "Added to cart" };
  });
}

const str = (f: FormData, k: string, max = 300) => {
  const v = String(f.get(k) ?? "").trim().slice(0, max);
  return v || null;
};

export async function checkout(_prev: unknown, form: FormData) {
  return attempt<{ redirect: string }>(async () => {
    const { user, customer } = await assertCustomer();
    const db = await getDb();
    const s = await getSettings(db);
    const method = String(form.get("method")) as PaymentMethod;
    const recipient = str(form, "recipient", 120);
    const address = str(form, "address", 300);
    const idempotencyKey = str(form, "idempotencyKey", 80);
    if (!idempotencyKey) throw new UserError("Please reload the page and try again.");
    if (!recipient) throw new UserError("Enter who will receive the delivery.");
    if (!address) throw new UserError("Enter the delivery address.");
    const windowStartMin = inputToMinutes(str(form, "windowStart"));
    const windowEndMin = inputToMinutes(str(form, "windowEnd"));
    if (windowStartMin !== null && windowEndMin !== null && windowStartMin >= windowEndMin) throw new UserError("The delivery window must end after it starts.");

    const so = await placeOrder(
      db,
      customer,
      user.id,
      {
        idempotencyKey,
        method,
        deliveryDate: String(form.get("deliveryDate") ?? ""),
        recipient,
        phone: str(form, "phone", 40),
        address,
        instructions: str(form, "instructions", 500),
        windowStartMin,
        windowEndMin,
        notes: str(form, "notes", 1000),
      },
      s,
      stripeEnabled(),
    );

    if (form.get("saveAddress") === "on") {
      await db.insert(customerAddresses).values({ customerId: customer.id, label: str(form, "addressLabel", 60) ?? "", recipient, phone: str(form, "phone", 40), address, instructions: str(form, "instructions", 500) });
    }
    if (so.deliveryOrderId) {
      const id = so.deliveryOrderId;
      after(async () => geocodeOrderIds(await getDb(), [id]));
    }
    // Card orders are confirmed (and emailed) once the payment comes through.
    if (so.status === "confirmed") after(() => orderConfirmed(so.id, { office: true }));
    revalidateShop();
    revalidatePath("/admin/sales");

    if (so.paymentMethod === "card" && so.paymentStatus !== "paid") {
      const h = await headers();
      const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
      const session = await createCheckoutSession({ id: so.id, number: so.number, totalCents: so.totalCents, email: customer.email ?? user.email }, origin);
      await db.update(salesOrders).set({ stripeSessionId: session.id }).where(eq(salesOrders.id, so.id));
      redirect(session.url);
    }
    // Redirect from the action: re-rendering /checkout with the now-empty cart would bounce to /cart.
    redirect(`/checkout/done?order=${so.id}`);
  });
}

/** Customers can cancel until the warehouse starts picking. Card payments are refunded through Stripe. */
export async function cancelMyOrder(salesOrderId: string) {
  return attempt(async () => {
    const { customer } = await assertCustomer();
    const db = await getDb();
    const [so] = await db
      .select()
      .from(salesOrders)
      .where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.customerId, customer.id)))
      .limit(1);
    if (!so) throw new UserError("Order not found.");
    if (so.status === "cancelled") return { message: "Already cancelled" };
    if (so.fulfilment !== "new") throw new UserError("We've started packing this order. Please call us to change it.");
    if (so.deliveryOrderId) {
      const [d] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, so.deliveryOrderId)).limit(1);
      if (d && d.status !== "pending" && d.status !== "planned") throw new UserError("This order is already on its way.");
    }
    await cancelOrder(db, so.id);
    await refundOrExpire(so);
    revalidatePath("/portal", "layout");
    revalidatePath("/admin/sales");
    return { message: "Order cancelled" };
  });
}

export async function deleteAddress(id: string) {
  return attempt(async () => {
    const { customer } = await assertCustomer();
    const db = await getDb();
    await db.delete(customerAddresses).where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, customer.id)));
    revalidatePath("/portal/addresses");
  });
}

/** Self sign-up for businesses. The account can browse straight away; prices and ordering open once staff approve it. */
export async function registerCustomer(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const business = str(form, "business", 120);
    const name = str(form, "name", 120);
    const email = (str(form, "email", 200) ?? "").toLowerCase();
    const password = String(form.get("password") ?? "");
    if (str(form, "website")) throw new UserError("Please try again.");
    if (!business || !name) throw new UserError("Enter your business and your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Enter a valid email address.");
    if (password.length < 8) throw new UserError("Choose a password of at least 8 characters.");

    const db = await getDb();
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    if ((await countAttempt(db, [{ key: `register:${ip}`, max: 5 }])) > 0) throw new UserError("Too many sign-ups from this network. Please try again later.");
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (taken) throw new UserError("An account with this email already exists. Sign in instead.");

    const { user, customer } = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(customers)
        .values({ name: business, email, phone: str(form, "phone", 40), address: str(form, "address", 300), abn: str(form, "abn", 20), approved: false })
        .returning();
      const [u] = await tx.insert(users).values({ email, name, role: "customer", customerId: c.id, passwordHash: await hashPassword(password) }).returning();
      return { user: u, customer: c };
    });
    after(() => accountRequested({ id: customer.id, name: business, contact: name, email, phone: customer.phone, address: customer.address }));
    const token = await signSession({ sub: user.id, role: "customer", name: user.name, driverId: null });
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);
    revalidatePath("/admin/customers");
    return { message: "registered" };
  });
}

/** Starts a fresh Stripe Checkout for a card order that's still waiting for payment. */
export async function payPendingOrder(salesOrderId: string) {
  return attempt<{ redirect: string }>(async () => {
    const { user, customer } = await assertCustomer();
    if (!stripeEnabled()) throw new UserError("Card payments aren't available right now.");
    const db = await getDb();
    const [so] = await db
      .select()
      .from(salesOrders)
      .where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.customerId, customer.id)))
      .limit(1);
    if (!so || so.status !== "pending" || so.paymentMethod !== "card" || so.paymentStatus === "paid") throw new UserError("This order doesn't need paying.");
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    const session = await createCheckoutSession({ id: so.id, number: so.number, totalCents: so.totalCents, email: customer.email ?? user.email }, origin);
    await db.update(salesOrders).set({ stripeSessionId: session.id }).where(eq(salesOrders.id, so.id));
    return { data: { redirect: session.url } };
  });
}

/** Customers keep their own contact details up to date. The business name stays with staff, since orders are matched on it. */
export async function updateMyBusiness(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const { customer } = await assertCustomer();
    const email = (str(form, "email", 200) ?? "").toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Enter a valid email address.");
    const db = await getDb();
    await db
      .update(customers)
      .set({ phone: str(form, "phone", 40), email: email || null, address: str(form, "address", 300), abn: str(form, "abn", 20) })
      .where(eq(customers.id, customer.id));
    revalidatePath("/portal", "layout");
    return { message: "Business details saved" };
  });
}
