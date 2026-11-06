// Labels for customer returns and store credit, shared by pages and the server. No database here.
import type { Tone } from "@/components/ui";
import type { CreditTransactionType, CustomerRefundMethod, CustomerReturnReason, CustomerReturnResolution, CustomerReturnStatus, ReturnedCondition } from "@/lib/db/schema";

export const CUSTOMER_RETURN_STATUS: Record<CustomerReturnStatus, { label: string; tone: Tone }> = {
  requested: { label: "Waiting for the goods", tone: "amber" },
  received: { label: "Goods checked in", tone: "violet" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "slate" },
};

export const CUSTOMER_RETURN_REASON: Record<CustomerReturnReason, string> = {
  ordered_by_mistake: "Ordered by mistake",
  no_longer_needed: "No longer needed",
  wrong_product: "Wrong product sent",
  damaged: "Damaged",
  defective: "Faulty / defective",
  other: "Other",
};

export const CUSTOMER_RESOLUTION: Record<CustomerReturnResolution, { label: string; hint: string }> = {
  credit: { label: "Store credit", hint: "Kept on their account and taken off a future order." },
  refund: { label: "Refund", hint: "Money back to how they paid (card refunds go through Stripe)." },
  exchange: { label: "Exchange", hint: "Credit put straight towards replacement goods on a new order." },
};

export const RETURNED_CONDITION: Record<ReturnedCondition, string> = {
  restock: "Back on the shelf",
  damaged: "Damaged, not sellable",
  write_off: "Written off / disposed",
};

export const REFUND_METHOD: Record<CustomerRefundMethod, string> = { card: "Card (Stripe)", bank_transfer: "Bank transfer", cash: "Cash", other: "Other" };

export const CREDIT_TYPE: Record<CreditTransactionType, { label: string; tone: Tone }> = {
  return_credit: { label: "Return credit", tone: "green" },
  manual_credit: { label: "Credit given", tone: "green" },
  promotion_credit: { label: "Promotion credit", tone: "violet" },
  order_redemption: { label: "Used on order", tone: "blue" },
  redemption_reversal: { label: "Back from order", tone: "amber" },
  credit_reversal: { label: "Credit reversed", tone: "red" },
};
