import { desc, eq, ilike, or } from "drizzle-orm";
import { getCurrentUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customers, orders, products, purchaseOrders, quotes, salesOrders, suppliers } from "@/lib/db/schema";

export type SearchHit = { kind: "sale" | "quote" | "delivery" | "customer" | "product" | "purchase"; title: string; detail: string; href: string };

const PER_KIND = 5;

/**
 * The back office's search box: order and quote numbers, customers (code, name, phone, email),
 * products (name, SKU, barcode), delivery orders and purchase orders, a few of each. Staff only.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !STAFF.includes(user.role)) return Response.json({ hits: [] }, { status: user ? 403 : 401 });
  const raw = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  if (raw.length < 2) return Response.json({ hits: [] });
  // Typed text, not a pattern: % and _ match themselves.
  const like = `%${raw.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const db = await getDb();

  const [sales, deliveries, people, items, purchases, quoted] = await Promise.all([
    db
      .select({ id: salesOrders.id, number: salesOrders.number, customer: customers.name, date: salesOrders.deliveryDate, status: salesOrders.status })
      .from(salesOrders)
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(or(ilike(salesOrders.number, like), ilike(customers.name, like), ilike(salesOrders.phone, like)))
      .orderBy(desc(salesOrders.createdAt))
      .limit(PER_KIND),
    db
      .select({ number: orders.orderNumber, customer: orders.customerName, address: orders.address, date: orders.deliveryDate })
      .from(orders)
      .where(or(ilike(orders.orderNumber, like), ilike(orders.customerName, like), ilike(orders.address, like)))
      .orderBy(desc(orders.deliveryDate))
      .limit(PER_KIND),
    db
      .select({ id: customers.id, code: customers.code, name: customers.name, phone: customers.phone, email: customers.email })
      .from(customers)
      .where(or(ilike(customers.code, like), ilike(customers.name, like), ilike(customers.phone, like), ilike(customers.email, like)))
      .orderBy(customers.name)
      .limit(PER_KIND),
    db
      .select({ sku: products.sku, name: products.name, stock: products.stock })
      .from(products)
      .where(or(ilike(products.name, like), ilike(products.sku, like), ilike(products.barcode, like)))
      .orderBy(products.name)
      .limit(PER_KIND),
    db
      .select({ id: purchaseOrders.id, number: purchaseOrders.poNumber, supplier: suppliers.name, status: purchaseOrders.status })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(or(ilike(purchaseOrders.poNumber, like), ilike(suppliers.name, like), ilike(purchaseOrders.supplierReference, like)))
      .orderBy(desc(purchaseOrders.orderDate))
      .limit(PER_KIND),
    db
      .select({ id: quotes.id, number: quotes.number, customer: customers.name, status: quotes.status, validUntil: quotes.validUntil })
      .from(quotes)
      .innerJoin(customers, eq(customers.id, quotes.customerId))
      .where(or(ilike(quotes.number, like), ilike(customers.name, like), ilike(customers.code, like)))
      .orderBy(desc(quotes.createdAt))
      .limit(PER_KIND),
  ]);

  const hits: SearchHit[] = [
    ...sales.map((s) => ({ kind: "sale" as const, title: `${s.number} · ${s.customer}`, detail: `Sales order · ${s.status} · delivery ${s.date}`, href: `/admin/sales/${s.id}` })),
    ...quoted.map((q) => ({ kind: "quote" as const, title: `${q.number} · ${q.customer}`, detail: `Quote · ${q.status} · valid until ${q.validUntil}`, href: `/admin/quotes/${q.id}` })),
    ...people.map((c) => ({ kind: "customer" as const, title: `${c.name} · ${c.code}`, detail: ["Customer", c.phone, c.email].filter(Boolean).join(" · "), href: `/admin/customers/${c.id}` })),
    ...deliveries.map((o) => ({
      kind: "delivery" as const,
      title: `${o.number} · ${o.customer || "—"}`,
      detail: `Delivery ${o.date} · ${o.address}`,
      href: `/admin/orders?date=${o.date}&q=${encodeURIComponent(o.number)}`,
    })),
    ...items.map((p) => ({ kind: "product" as const, title: p.name, detail: `Product · ${p.sku} · ${p.stock} in stock`, href: `/admin/products?q=${encodeURIComponent(p.sku)}` })),
    ...purchases.map((p) => ({ kind: "purchase" as const, title: `${p.number} · ${p.supplier}`, detail: `Purchase order · ${p.status}`, href: `/admin/purchase-orders/${p.id}` })),
  ];
  return Response.json({ hits }, { headers: { "Cache-Control": "private, no-store" } });
}
