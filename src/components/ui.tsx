import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { T } from "./i18n";

export { clsx as cx };

/** Plain text passed to these building blocks is shown in the viewer's language. */
const tx = (n: React.ReactNode) => (typeof n === "string" ? <T>{n}</T> : n);

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
// "icon" / "icon-sm" are square icon-only buttons (no horizontal padding).
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

export function btn(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return clsx(
    // active:scale gives a tap a physical "press", which matters most on the driver's phone.
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500",
    {
      primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
      secondary: "bg-white text-slate-700 border border-line hover:bg-slate-50 shadow-sm",
      ghost: "text-slate-600 hover:bg-slate-100",
      danger: "bg-white text-red-600 border border-red-200 hover:bg-red-50",
      success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
    }[variant],
    { sm: "h-8 px-3 text-xs", md: "h-9 px-3.5 text-sm", lg: "h-12 px-5 text-base", icon: "size-8", "icon-sm": "size-6" }[size],
    extra,
  );
}

/** Busy indicator for buttons and inline loading; takes the text colour. */
export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={clsx("inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent", className)} />;
}

/** Thin bar across the top of the window while a page or day is loading. */
export function TopProgress() {
  return <span aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 origin-left animate-progress bg-blue-500" />;
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={clsx("rounded-xl border border-line bg-white shadow-card", className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, action }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900">{tx(title)}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{tx(subtitle)}</p>}
      </div>
      {action}
    </div>
  );
}

const tones = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "slate", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap", tones[tone], className)}>
      {tx(children)}
    </span>
  );
}

export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Unplanned", tone: "slate" },
  planned: { label: "Planned", tone: "violet" },
  dispatched: { label: "Dispatched", tone: "blue" },
  delivered: { label: "Delivered", tone: "green" },
  failed: { label: "Failed", tone: "red" },
};

export const GEOCODE_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Not checked", tone: "slate" },
  ok: { label: "Verified", tone: "green" },
  approximate: { label: "Approximate", tone: "amber" },
  failed: { label: "Not found", tone: "red" },
};

export const UNASSIGNED_REASON: Record<string, string> = {
  time_window: "Delivery window can't be reached",
  capacity: "No vehicle capacity left",
  shift_length: "Would exceed drivers' shift length",
  pinned_vehicle_unavailable: "No selected driver matches its pinned driver / depot",
  no_vehicles: "No drivers selected",
  not_geocoded: "Address not located",
  manual: "Removed by dispatcher",
};

export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone = "blue",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "blue" | "green" | "amber" | "violet" | "slate" | "red";
}) {
  const iconTone = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    violet: "bg-violet-50 text-violet-600",
    slate: "bg-slate-100 text-slate-600",
    red: "bg-red-50 text-red-600",
  }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{tx(label)}</p>
        {Icon && (
          <span className={clsx("grid size-8 place-items-center rounded-lg", iconTone)}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{tx(hint)}</p>}
    </Card>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{tx(title)}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{tx(subtitle)}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-slate-100 text-slate-500">
        <Icon className="size-6" />
      </span>
      <p className="mt-3 text-sm font-semibold text-slate-900">{tx(title)}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-slate-500">{tx(children)}</div>}
    </div>
  );
}

export const inputCls =
  "h-9 w-full rounded-lg border border-line bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50";

export function Field({ label, hint, children, className }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{tx(label)}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{tx(hint)}</span>}
    </label>
  );
}

export function ColorDot({ color, className }: { color: string; className?: string }) {
  return <span className={clsx("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: color }} />;
}
