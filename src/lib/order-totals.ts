import { GST_RATE } from "./money";

// Totals for orders staff enter by hand, shared by the form's live preview and the server, so the
// two can't disagree. Same rules as the shop: GST on taxable lines and on delivery.

export type TotalLine = { qty: number; unitPriceCents: number; gst: boolean };

export function orderTotals(lines: TotalLine[], deliveryFeeCents: number) {
  const subtotalCents = lines.reduce((t, l) => t + l.qty * l.unitPriceCents, 0);
  const taxable = lines.filter((l) => l.gst).reduce((t, l) => t + l.qty * l.unitPriceCents, 0) + deliveryFeeCents;
  const gstCents = Math.round(taxable * GST_RATE);
  return { subtotalCents, deliveryFeeCents, gstCents, totalCents: subtotalCents + deliveryFeeCents + gstCents };
}

/** The shop's delivery fee for this subtotal: free above the threshold. */
export function defaultDeliveryFee(subtotalCents: number, s: { deliveryFeeCents: number; freeDeliveryOverCents: number }) {
  return subtotalCents === 0 || (s.freeDeliveryOverCents > 0 && subtotalCents >= s.freeDeliveryOverCents) ? 0 : s.deliveryFeeCents;
}

/** How many of a line will have to wait for stock: what's asked for beyond what this order can still take. */
export function waitingFor(qty: number, available: number) {
  return Math.max(0, qty - Math.max(0, available));
}
