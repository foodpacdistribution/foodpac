// Stock is kept in the unit a product is sold by (packet, sleeve, bottle… or carton). Counting the
// warehouse is done in cartons plus loose packs ("20 ctn + 7 pk"), so these convert between the two
// using the product's pack size ("8 packets / carton").

/** Units in a carton, from a pack size like "8 packets / carton" or "5 per carton"; null when unknown. */
export function perCarton(packSize: string | null | undefined): number | null {
  const m = (packSize ?? "").trim().match(/^(\d+)\s*(?:[a-z]+\s*)?(?:\/|per)\s*(?:carton|ctn)\b/i);
  const n = m ? Number(m[1]) : NaN;
  return n > 1 ? n : null;
}

/**
 * Units in a carton when the product can also be ordered by the whole carton: sold by the pack
 * (packet, sleeve…) with a carton size in its pack size. Null for products sold by the carton
 * already, whose stock can't be split into packs.
 */
export function cartonSize(packSize: string | null | undefined, unit: string): number | null {
  return /^(carton|ctn)s?$/i.test(unit.trim()) ? null : perCarton(packSize);
}

/**
 * An order line as the customer bought it: cartons at the carton price for lines ordered by the
 * carton, otherwise the product's own unit. `qty` on a line is always in stock units (packs), so
 * picking, stock and returns don't need to know; `units` is that count for carton lines.
 */
export function asSold(it: { qty: number; unit: string; unitPriceCents: number; perCarton: number | null; cartonPriceCents: number | null }) {
  if (it.perCarton && it.cartonPriceCents !== null && it.qty % it.perCarton === 0) {
    return { qty: it.qty / it.perCarton, unit: "carton", priceCents: it.cartonPriceCents, units: it.qty, packUnit: it.unit };
  }
  return { qty: it.qty, unit: it.unit, priceCents: it.unitPriceCents, units: null, packUnit: it.unit };
}

/** Stock shown as cartons and loose packs ("20 ctn + 7 pk"), or just the number when there's no carton size. */
export function cartonsAndPacks(stock: number, per: number | null): { ctn: number; pk: number } | null {
  if (!per || stock < 0) return null;
  return { ctn: Math.floor(stock / per), pk: stock % per };
}

export function formatCartons(stock: number, per: number | null): string {
  const c = cartonsAndPacks(stock, per);
  if (!c) return String(stock);
  if (!c.ctn) return `${c.pk} pk`;
  return c.pk ? `${c.ctn} ctn + ${c.pk} pk` : `${c.ctn} ctn`;
}

const CARTON = /^(ctns?|cartons?|cs|箱)$/i;
const PACK = /^(pks?|p|pkts?|packs?|packets?|pcs?|bags?|sle|sleeves?|rolls?|bottles?|btls?|ea|each|boxes|box|tins?|cans?|reams?|包|袋|卷|瓶|个|条)$/i;

export type ParsedCount = { ok: true; units: number; dropped: number } | { ok: false; error: string };

/**
 * A counted quantity as written on a stocktake sheet: "20ctn+7pk", "21 CTN + 3 P + 3 CTN", "14P", "0".
 * A bare number is in the unit the product is sold by. For a product sold by the carton, loose packs
 * can't be held as stock: they are left out and reported as `dropped`.
 */
export function parseCount(text: string, per: number | null, unit: string): ParsedCount {
  const s = text.trim();
  if (!s) return { ok: false, error: "No count" };
  const soldByCarton = /^(carton|ctn)$/i.test(unit.trim());
  let units = 0;
  let dropped = 0;
  for (const raw of s.split("+")) {
    const term = raw.trim();
    const m = term.match(/^(\d+)\s*([^\d\s].*)?$/);
    if (!m) return { ok: false, error: `Can't read "${term || s}"` };
    const n = Number(m[1]);
    const word = (m[2] ?? "").trim().replace(/\.$/, "");
    if (!word) {
      units += n;
    } else if (CARTON.test(word)) {
      if (soldByCarton) units += n;
      else if (per) units += n * per;
      else return { ok: false, error: "Set how many are in a carton (pack size) to count in cartons" };
    } else if (PACK.test(word)) {
      if (soldByCarton) dropped += n;
      else units += n;
    } else return { ok: false, error: `Unknown unit "${word}"` };
  }
  return { ok: true, units, dropped };
}
