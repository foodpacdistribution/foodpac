import { Check, TriangleAlert } from "lucide-react";
import { T } from "@/components/i18n";
import { cx } from "@/components/ui";
import { type PortalStage, STAGES } from "@/lib/portal";

/** Each delivery stage's name and the colour of its dot. */
export const STAGE_LABEL: Record<PortalStage, { label: string; className: string }> = {
  received: { label: "Order received", className: "bg-leaf-900/30" },
  scheduled: { label: "Scheduled", className: "bg-violet-500" },
  out_for_delivery: { label: "Out for delivery", className: "bg-amber-500" },
  delivered: { label: "Delivered", className: "bg-leaf-600" },
  failed: { label: "Delivery issue", className: "bg-red-600" },
};

export function StageBadge({ stage }: { stage: PortalStage }) {
  const s = STAGE_LABEL[stage];
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", stage === "failed" ? "text-red-700" : "text-leaf-900/70")}>
      <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", s.className)} />
      <T>{s.label}</T>
    </span>
  );
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
              <span className={cx("absolute right-1/2 h-px w-full transition-colors duration-500", compact ? "top-[9px]" : "top-[13px]", i <= current ? "bg-leaf-700" : "bg-leaf-950/12")} />
            )}
            <span
              className={cx(
                "relative grid place-items-center rounded-full",
                compact ? "size-5" : "size-7",
                isFail ? "bg-red-600 text-white" : done ? "bg-leaf-700 text-white" : active ? "bg-leaf-700 ring-4 ring-leaf-700/15" : "bg-cream ring-1 ring-leaf-950/15",
              )}
            >
              {isFail ? <TriangleAlert className="size-3.5" /> : done ? <Check className={compact ? "size-3" : "size-4"} /> : null}
              {active && (
                <>
                  <span className="size-2 rounded-full bg-cream" />
                  <span className="absolute inset-0 animate-ping rounded-full bg-leaf-700/25 [animation-duration:2s]" />
                </>
              )}
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
