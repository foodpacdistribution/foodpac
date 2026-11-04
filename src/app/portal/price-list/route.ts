import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { GST_RATE } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { toCsv } from "@/lib/product-import";
import { canSeePrices, listCatalog } from "@/lib/shop";
import { todayIn } from "@/lib/time";

/** The signed-in customer's own price list, every product in the shop, as a spreadsheet (CSV). */
export async function GET() {
  const viewer = await getCurrentCustomer();
  if (!viewer) redirect("/login?next=%2Fportal%2Flist");
  if (!canSeePrices(viewer.customer)) return new Response("Your account is waiting for approval.", { status: 403 });
  const db = await getDb();
  const [items, s] = await Promise.all([listCatalog(db, viewer.customer, { limit: 20000 }), getSettings(db)]);
  const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
  const csv = toCsv([
    ["SKU", "Product", "Category", "Pack size", "Sold by", "Minimum order", "Your price ex GST", "GST", "Your price inc GST", "List price ex GST", "Availability"],
    ...items.map((p) => [
      p.sku,
      p.name,
      p.category,
      p.packSize,
      p.unit,
      p.minQty,
      dollars(p.priceCents),
      p.gst ? `${GST_RATE * 100}%` : "GST free",
      dollars(p.priceCents === null ? null : p.gst ? Math.round(p.priceCents * (1 + GST_RATE)) : p.priceCents),
      dollars(p.listPriceCents),
      p.stock > 0 ? "In stock" : "Out of stock",
    ]),
  ]);
  const name = `foodpac-price-list-${todayIn(s.timezone)}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      // Prices are this customer's own: never cached anywhere shared.
      "Cache-Control": "private, no-store",
    },
  });
}
