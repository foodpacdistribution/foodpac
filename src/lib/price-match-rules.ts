// Price match rules, shared by the form (live preview on the salesperson's phone) and the server
// (which decides for real). No server code here. Money is integer cents ex GST.

/**
 * The price to suggest: `beatPct` percent under what they pay now, never above our list price
 * (when we're already cheaper, the list price is the offer).
 */
export function suggestedPrice(competitorCents: number, listCents: number, beatPct: number) {
  const beat = Number.isFinite(beatPct) ? Math.min(50, Math.max(0, beatPct)) : 0;
  return Math.max(1, Math.min(listCents, Math.floor(competitorCents * (1 - beat / 100))));
}

/**
 * The lowest price that still keeps `minMarginPct` gross margin over `costCents`, rounded up to
 * the cent. Null when the cost isn't known (then nothing can be checked).
 */
export function marginFloor(costCents: number | null, minMarginPct: number) {
  if (costCents === null || !(costCents > 0)) return null;
  const pct = Math.min(95, Math.max(0, minMarginPct));
  return Math.ceil(costCents / (1 - pct / 100) - 1e-9);
}

/**
 * Whether an offered price applies straight away or waits for the office. The office's own
 * matches always apply. Sales staff's apply when they're no lower than the list price, or no
 * lower than the margin floor; with no cost known, a price under list waits.
 */
export function needsApproval(o: { office: boolean; priceCents: number; listCents: number; floorCents: number | null }) {
  if (o.office || o.priceCents >= o.listCents) return false;
  return o.floorCents === null || o.priceCents < o.floorCents;
}

/** Per unit and, with a monthly quantity, per month: what the store saves at our price. */
export function savings(competitorCents: number, priceCents: number, monthlyQty: number | null) {
  const perUnit = competitorCents - priceCents;
  return {
    perUnitCents: perUnit,
    pct: competitorCents > 0 ? Math.round((perUnit / competitorCents) * 1000) / 10 : 0,
    monthlyCents: monthlyQty ? perUnit * monthlyQty : null,
  };
}

/** Gross margin as a whole percentage of the price (same as lib/costs, usable in the browser). */
export function marginPctOf(priceCents: number, costCents: number) {
  return priceCents > 0 ? Math.round(((priceCents - costCents) / priceCents) * 100) : null;
}
