import { Check, TriangleAlert } from "lucide-react";
import { T } from "@/components/i18n";
import { cx } from "@/components/ui";
import { type PortalStage, STAGES } from "@/lib/portal";

export const STAGE_LABEL: Record<PortalStage, { label: string; className: string }> = {
  received: { label: "Order received", className: "bg-slate-100 text-slate-700" },
  scheduled: { label: "Scheduled", className: "bg-violet-50 text-violet-700" },
  out_for_delivery: { label: "Out for delivery", className: "bg-amber-50 text-amber-800" },
  delivered: { label: "Delivered", className: "bg-leaf-50 text-leaf-700" },
  failed: { label: "Delivery issue", className: "bg-red-50 text-red-700" },
};

export function StageBadge({ stage }: { stage: PortalStage }) {
  const s = STAGE_LABEL[stage];
  return <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", s.className)}><T>{s.label}</T></span>;
}

/** Four-step progress: received → scheduled → out for delivery → delivered. */
export function StageSteps({ stage, compact }: { stage: PortalStage; compact?: boolean }) {
  const failed = stage === "failed";
  const current = failed ? 3 : STAGES.findIndex((s) => s.key === stage);
  return (
    <ol className="grid grid-cols-4">
      {STAGES.map((s, i) => {
        const done = i < current || (i === current && stage === "delivered");
        const active = i === current && !done && !failed;
        const isFail = failed && i === 3;
        return (
          <li key={s.key} className="relative flex flex-col items-center text-center">
            {i > 0 && (
              <span className={cx("absolute right-1/2 h-0.5 w-full", compact ? "top-[9px]" : "top-[13px]", i <= current ? "bg-leaf-600" : "bg-leaf-950/10")} />
            )}
            <span
              className={cx(
                "relative grid place-items-center rounded-full",
                compact ? "size-5" : "size-7",
                isFail ? "bg-red-600 text-white" : done ? "bg-leaf-600 text-white" : active ? "bg-amber-400 text-white ring-4 ring-amber-200" : "bg-[#e6e1d6]",
              )}
            >
              {isFail ? <TriangleAlert className="size-3.5" /> : done ? <Check className={compact ? "size-3" : "size-4"} /> : null}
              {active && <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/50" />}
            </span>
            {!compact && (
              <span className={cx("mt-2 px-1 text-[11px] font-medium leading-tight", done || active || isFail ? "text-leaf-950" : "text-leaf-900/45")}>
                <T>{isFail ? "Couldn't deliver" : s.label}</T>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
