import { CATEGORIES, categoryHref, SITE } from "@/app/(site)/content";
import { siteInfo } from "@/app/(site)/site-info";
import { getDb } from "@/lib/db";
import { aud } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { listCategories } from "@/lib/shop";
import { siteUrl } from "@/lib/site-url";
import { formatMinutesClock } from "@/lib/time";

// Rebuilt hourly, like the sitemap.
export const revalidate = 3600;

/**
 * /llms.txt: a plain summary of the business for AI assistants and AI search (an informal
 * convention, like robots.txt for language models). The same facts as the About page.
 */
export async function GET() {
  const base = siteUrl();
  let body: string;
  try {
    const db = await getDb();
    const [s, counts] = await Promise.all([getSettings(db), listCategories(db)]);
    const site = siteInfo(s);
    const stocked = CATEGORIES.filter((c) => counts.some((x) => x.name === c.title && x.n > 0));
    const ranges = (stocked.length ? stocked : CATEGORIES).map((c) => `- [${c.title}](${base}${categoryHref(c.title)}): ${c.text}`).join("\n");
    const days = [...s.deliveryDays].sort().join() === "1,2,3,4,5" ? "Monday to Friday" : `days ${s.deliveryDays.join(", ")} (1 = Monday)`;
    body = `# ${SITE.name}

> Wholesale food packaging and kitchen supplies for cafés, restaurants, takeaway shops and caterers in Brisbane and ${SITE.serviceArea}, Australia: takeaway containers and food boxes, cups and lids, bags, cutlery, cleaning supplies and pantry staples, delivered by our own drivers. 布里斯班食品打包盒、外卖餐盒及餐饮包装批发。

## What we supply
${ranges}

## Delivery and ordering
- Deliveries ${days} across Brisbane and ${SITE.serviceArea}, by our own drivers.
- Orders placed by ${formatMinutesClock(s.orderCutoffMin)} go out on the next delivery day.
- ${s.deliveryFeeCents > 0 ? (s.freeDeliveryOverCents > 0 ? `Free delivery on orders over ${aud(s.freeDeliveryOverCents)}; otherwise ${aud(s.deliveryFeeCents)}.` : `Delivery fee ${aud(s.deliveryFeeCents)}.`) : "Free delivery."} Prices exclude GST.
- Trade (business) customers only. Prices are per account: open a free trade account at ${base}/register.
- Every delivery is recorded with a photo and signature; customers can follow the van on the day.

## Contact
- Hours: ${site.hours}
${site.phone ? `- Phone: ${site.phone}\n` : ""}${site.email ? `- Email: ${site.email}\n` : ""}${site.address ? `- Address: ${site.address}\n` : ""}- Contact form: ${base}/#contact

## Pages
- [About us](${base}/about) · [关于我们 (中文)](${base}/zh/about)
- [All products](${base}/products) · [全部商品 (中文)](${base}/zh/products)
- [Open a trade account](${base}/register)
`;
  } catch {
    body = `# ${SITE.name}\n\n> Wholesale food packaging and kitchen supplies for food businesses in Brisbane and ${SITE.serviceArea}, Australia.\n\n- [About us](${base}/about)\n- [All products](${base}/products)\n`;
  }
  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
