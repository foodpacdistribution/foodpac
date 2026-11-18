import { T, Tx } from "@/components/i18n";
import { cx } from "@/components/ui";
import { FULFILMENT, PAYMENT_STATUS, SALES_STATUS } from "@/lib/money";
import type { PodStatus } from "@/lib/portal";

/** The dot's colour for each tone; the words stay quiet. */
const TONE = {
  slate: "bg-leaf-900/30",
  blue: "bg-sky-600",
  green: "bg-leaf-600",
  amber: "bg-amber-500",
  red: "bg-red-600",
  violet: "bg-violet-500",
} as const;

/** A status: a small coloured dot and its name, so a row of them reads calmly. */
export function Pill({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", tone === "red" ? "text-red-700" : "text-leaf-900/70")}>
      <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", TONE[tone])} />
      {typeof children === "string" ? <T>{children}</T> : children}
    </span>
  );
}

export const OrderPill = ({ s }: { s: keyof typeof SALES_STATUS }) => <Pill tone={SALES_STATUS[s].tone}>{<Tx>{SALES_STATUS[s].label}</Tx>}</Pill>;
export const PaymentPill = ({ s }: { s: keyof typeof PAYMENT_STATUS }) => <Pill tone={PAYMENT_STATUS[s].tone}>{<Tx>{PAYMENT_STATUS[s].label}</Tx>}</Pill>;
export const WarehousePill = ({ s }: { s: keyof typeof FULFILMENT }) => <Pill tone={FULFILMENT[s].tone}>{<Tx>{FULFILMENT[s].label}</Tx>}</Pill>;

export const POD_LABEL: Record<PodStatus, { label: string; tone: keyof typeof TONE }> = {
  pending: { label: "Not delivered yet", tone: "slate" },
  signed: { label: "Signed", tone: "green" },
  photo: { label: "Photo confirmed", tone: "green" },
  not_obtained: { label: "No proof collected", tone: "amber" },
};
