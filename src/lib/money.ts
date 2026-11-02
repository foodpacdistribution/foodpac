// Client-safe money helpers. Amounts are integer cents; shop prices are ex GST.

export const GST_RATE = 0.1;

export function aud(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
}

/** "12.50" → 1250. Returns null for anything that isn't a non-negative amount. */
export function parseDollars(v: string | null | undefined): number | null {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export const PAYMENT_TERMS_LABEL = { prepay: "Pay up front", net7: "Invoice · 7 days", net14: "Invoice · 14 days", net30: "Invoice · 30 days" } as const;

export const PAYMENT_METHOD_LABEL = { card: "Credit / debit card", bank_transfer: "Bank transfer", invoice: "Pay by invoice" } as const;

export const PAYMENT_STATUS = {
  unpaid: { label: "Awaiting payment", tone: "amber" },
  paid: { label: "Paid", tone: "green" },
  failed: { label: "Payment failed", tone: "red" },
  refunded: { label: "Refunded", tone: "slate" },
} as const;

export const SALES_STATUS = {
  pending: { label: "Pending payment", tone: "slate" },
  confirmed: { label: "Confirmed", tone: "blue" },
  cancelled: { label: "Cancelled", tone: "red" },
} as const;

export const FULFILMENT = {
  new: { label: "To pick", tone: "slate" },
  picking: { label: "Picking", tone: "amber" },
  packed: { label: "Packed", tone: "violet" },
  loaded: { label: "Loaded", tone: "green" },
} as const;
