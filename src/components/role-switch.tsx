"use client";

import { ArrowLeftRight } from "lucide-react";
import { useFormStatus } from "react-dom";
import { switchRole } from "@/app/actions/auth";
import { useT } from "@/components/i18n";
import { cx, Spinner } from "@/components/ui";

const LABEL: Record<string, string> = { admin: "Admin", dispatcher: "Dispatcher", sales: "Salesperson", driver: "Driver" };

/**
 * For someone who does more than one job (a driver who also sells): one button per other job,
 * opening that job's pages on the same login. Nothing shows for a login with one role.
 */
export function RoleSwitch({ roles, current, tone = "dark", compact }: { roles: string[]; current: string; tone?: "dark" | "light"; compact?: boolean }) {
  const tr = useT();
  const others = roles.filter((r) => r !== current && LABEL[r]);
  if (!others.length) return null;
  return (
    <div className={cx("flex flex-wrap items-center gap-1.5", compact && "flex-nowrap")}>
      {others.map((r) => (
        <form key={r} action={switchRole.bind(null, r)}>
          <SwitchButton tone={tone} compact={compact} label={`${tr("Switch to")} ${tr(LABEL[r])}`} short={tr(LABEL[r])} />
        </form>
      ))}
    </div>
  );
}

function SwitchButton({ tone, compact, label, short }: { tone: "dark" | "light"; compact?: boolean; label: string; short: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      title={label}
      aria-label={label}
      className={cx(
        "flex items-center gap-1.5 rounded-full text-xs font-medium transition-[background-color,transform] active:scale-95 disabled:opacity-60",
        compact ? "h-8 px-2.5" : "h-8 px-3",
        tone === "dark" ? "bg-white/10 text-white hover:bg-white/20" : "bg-blue-50 text-blue-700 hover:bg-blue-100",
      )}
    >
      {pending ? <Spinner className="size-3.5" /> : <ArrowLeftRight className="size-3.5" />}
      {compact ? short : label}
    </button>
  );
}
