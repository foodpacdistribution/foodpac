import { cx } from "@/components/ui";
import { FULFILMENT, PAYMENT_STATUS, SALES_STATUS } from "@/lib/money";
import type { PodStatus } from "@/lib/portal";

const TONE = {
  slate: "bg-slate-100 text-slate-700",
  blue: "bg-blue-50 text-blue-700",
  green: "bg-leaf-50 text-leaf-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
  violet: "bg-violet-50 text-violet-700",
} as const;

export function Pill({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", TONE[tone])}>{children}</span>;
}

export const OrderPill = ({ s }: { s: keyof typeof SALES_STATUS }) => <Pill tone={SALES_STATUS[s].tone}>{SALES_STATUS[s].label}</Pill>;
export const PaymentPill = ({ s }: { s: keyof typeof PAYMENT_STATUS }) => <Pill tone={PAYMENT_STATUS[s].tone}>{PAYMENT_STATUS[s].label}</Pill>;
export const WarehousePill = ({ s }: { s: keyof typeof FULFILMENT }) => <Pill tone={FULFILMENT[s].tone}>{FULFILMENT[s].label}</Pill>;

export const POD_LABEL: Record<PodStatus, { label: string; tone: keyof typeof TONE }> = {
  pending: { label: "Not delivered yet", tone: "slate" },
  signed: { label: "Signed", tone: "green" },
  photo: { label: "Photo confirmed", tone: "green" },
  not_obtained: { label: "No proof collected", tone: "amber" },
};
