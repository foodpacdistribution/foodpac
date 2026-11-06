// Labels and arithmetic shared by the purchasing pages and the server. No database here.
import type { Tone } from "@/components/ui";
import type {
  GoodsReceiptStatus,
  MovementType,
  PurchaseOrderStatus,
  PurchaseReturnStatus,
  ReturnResolution,
  SupplierPayMethod,
  SupplierResponseStatus,
} from "@/lib/db/schema";

export const GST_RATE = 0.1;

/** Dollars to whole cents, the unit all totals are added up in (no floating-point drift). */
export const toCents = (dollars: number) => Math.round(dollars * 100);
export const fromCents = (cents: number) => cents / 100;

/** "$1,234.56" for a NUMERIC dollar amount. */
export function money(dollars: number | null | undefined) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(dollars ?? 0);
}

/** Unit costs can have up to 4 decimals; show at least 2. */
export function unitMoney(dollars: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(dollars);
}

/** "12" or "12.5": quantities without trailing zeros. */
export const qtyText = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(Number(n.toFixed(3))));

/** qty × unit cost, to the cent. */
export const lineTotal = (qty: number, unitCost: number) => fromCents(Math.round(qty * unitCost * 100));

/** Subtotal ex GST, GST (10% on taxable lines) and total, from ex-GST line totals. */
export function purchaseTotals(lines: { lineTotal: number; gst: boolean }[]) {
  const sub = lines.reduce((t, l) => t + toCents(l.lineTotal), 0);
  const gst = Math.round(lines.filter((l) => l.gst).reduce((t, l) => t + toCents(l.lineTotal), 0) * GST_RATE);
  return { subtotal: fromCents(sub), gst: fromCents(gst), total: fromCents(sub + gst) };
}

/** What a supplier owes back for goods that went back to them, incl. GST. */
export const returnValue = (lines: { qty: number; unitCost: number; gst: boolean }[]) =>
  purchaseTotals(lines.map((l) => ({ lineTotal: lineTotal(l.qty, l.unitCost), gst: l.gst }))).total;

export const PO_STATUS: Record<PurchaseOrderStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "slate" },
  sent: { label: "Sent to supplier", tone: "blue" },
  confirmed: { label: "Confirmed by supplier", tone: "violet" },
  partially_received: { label: "Partly received", tone: "amber" },
  received: { label: "Received", tone: "green" },
  closed: { label: "Closed short", tone: "slate" },
  cancelled: { label: "Cancelled", tone: "red" },
};

export const GRN_STATUS: Record<GoodsReceiptStatus, { label: string; tone: Tone }> = {
  draft: { label: "Checking", tone: "amber" },
  posted: { label: "In stock", tone: "green" },
  cancelled: { label: "Cancelled", tone: "red" },
};

export const SUPPLIER_RESPONSE: Record<SupplierResponseStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending supplier confirmation", tone: "amber" },
  accepted: { label: "Accepted", tone: "green" },
  partially_accepted: { label: "Partially accepted", tone: "violet" },
  rejected: { label: "Rejected", tone: "red" },
};

export const RETURN_STATUS: Record<PurchaseReturnStatus, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "blue" },
  dispatched: { label: "Sent back", tone: "violet" },
  closed: { label: "Closed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "slate" },
};

export const RESOLUTION_LABEL: Record<ReturnResolution, string> = { refund: "Refund", exchange: "Exchange (replacement goods)" };

export const PAY_METHOD_LABEL: Record<SupplierPayMethod, string> = { bank_transfer: "Bank transfer", card: "Card", cash: "Cash", other: "Other" };
export const PAY_METHODS = Object.keys(PAY_METHOD_LABEL) as SupplierPayMethod[];

export const MOVEMENT_LABEL: Record<MovementType, { label: string; tone: Tone }> = {
  opening: { label: "Opening balance", tone: "slate" },
  purchase_receipt: { label: "Goods received", tone: "green" },
  purchase_return: { label: "Returned to supplier", tone: "red" },
  customer_return: { label: "Returned by customer", tone: "green" },
  sale_reserved: { label: "Customer order", tone: "blue" },
  sale_released: { label: "Order cancelled / reduced", tone: "violet" },
  adjustment: { label: "Adjustment", tone: "amber" },
  count: { label: "Stock count", tone: "amber" },
  import: { label: "Import", tone: "slate" },
  other: { label: "Other", tone: "slate" },
};

/** A PO's payment position. There's no supplier credit, so anything short of the total is simply still to pay. */
export function paymentState(total: number, paid: number): { label: string; tone: Tone } {
  if (toCents(paid) <= 0) return { label: "Not paid", tone: "amber" };
  if (toCents(paid) < toCents(total)) return { label: "Part paid", tone: "violet" };
  return { label: "Paid", tone: "green" };
}
