import { TrendingDown } from "lucide-react";
import { Badge, Card, CardHeader, cx } from "@/components/ui";
import type { PlanSummary } from "@/lib/db/schema";
import { formatClock, formatDuration, formatKm } from "@/lib/time";
import { T, Tx } from "@/components/i18n";

export function SummaryCard({ summary, matrixSource }: { summary: PlanSummary | null; matrixSource: "osrm" | "estimate" | null }) {
  if (!summary) return null;
  const items: [string, string, string?][] = [
    ["Orders on routes", `${summary.assigned} / ${summary.orders}`, summary.unassigned ? `${summary.unassigned} unassigned` : "All assigned"],
    ["All deliveries done by", formatClock(summary.fleetFinish), summary.fleetStart !== null ? `First departure ${formatClock(summary.fleetStart)}` : undefined],
    ["Driving distance", formatKm(summary.distance)],
    ["Driving time", formatDuration(summary.driveTime)],
    ["Unloading time", formatDuration(summary.serviceTime)],
    ["Waiting for windows", formatDuration(summary.waitTime)],
  ];
  return (
    <Card>
      <CardHeader
        title={<T>{"Optimisation results"}</T>}
        subtitle={`Total driver time ${formatDuration(summary.driverTime)} across all routes`}
        action={matrixSource === "estimate" ? <Badge tone="amber"><T>{"Estimated"}</T></Badge> : <Badge tone="green"><T>{"Road times"}</T></Badge>}
      />
      <dl className="grid grid-cols-2 gap-px bg-line">
        {items.map(([label, value, hint]) => (
          <div key={label} className="bg-white px-4 py-3">
            <dt className="text-[11px] text-slate-500">{<Tx>{label}</Tx>}</dt>
            <dd className="mt-0.5 text-lg font-semibold tracking-tight text-slate-900 tabular-nums">{<Tx>{value}</Tx>}</dd>
            {hint && <p className="text-[11px] text-slate-400">{<Tx>{hint}</Tx>}</p>}
          </div>
        ))}
      </dl>
      {(summary.lateStops > 0 || summary.overtimeRoutes > 0) && (
        <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-2.5">
          {summary.lateStops > 0 && <Badge tone="red">{summary.lateStops} {" "}<T>{"stop(s) outside their window"}</T></Badge>}
          {summary.overtimeRoutes > 0 && <Badge tone="red">{summary.overtimeRoutes} {" "}<T>{"route(s) over shift length"}</T></Badge>}
        </div>
      )}
    </Card>
  );
}

export function ComparisonCard({ before, after }: { before: PlanSummary | null; after: PlanSummary | null }) {
  if (!before || !after) return null;
  const rows: { label: string; b: number | null; a: number | null; fmt: (n: number | null) => string }[] = [
    { label: "Driving distance", b: before.distance, a: after.distance, fmt: formatKm },
    { label: "Driving time", b: before.driveTime, a: after.driveTime, fmt: formatDuration },
    { label: "Total driver time", b: before.driverTime, a: after.driverTime, fmt: formatDuration },
    { label: "All done by", b: before.fleetFinish, a: after.fleetFinish, fmt: formatClock },
    { label: "Late deliveries", b: before.lateStops, a: after.lateStops, fmt: (n) => String(n ?? 0) },
  ];
  const saved = before.driveTime - after.driveTime;
  return (
    <Card>
      <CardHeader
        title={<T>{"Before vs after"}</T>}
        subtitle={<T>{"“Before” = orders driven in spreadsheet order, split evenly between the same drivers, same road times."}</T>}
      />
      {saved > 0 && (
        <div className="flex items-center gap-2 border-b border-line bg-emerald-50/60 px-4 py-2.5 text-sm text-emerald-800">
          <TrendingDown className="size-4" />
          <span>
            <strong>{<Tx>{formatDuration(saved)}</Tx>}</strong> {" "}<T>{"less driving ("}</T>{Math.round((saved / Math.max(1, before.driveTime)) * 100)}<T>{"%) and"}</T>{" "}
            <strong>{formatKm(before.distance - after.distance)}</strong> {" "}<T>{"fewer"}</T></span>
        </div>
      )}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2"><T>{"Metric"}</T></th>
            <th className="px-2 py-2 text-right"><T>{"Before"}</T></th>
            <th className="px-2 py-2 text-right"><T>{"After"}</T></th>
            <th className="px-4 py-2 text-right"><T>{"Change"}</T></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const diff = r.a !== null && r.b !== null ? r.a - r.b : null;
            const pct = diff !== null && r.b && r.label !== "All done by" && r.label !== "Late deliveries" ? Math.round((diff / r.b) * 100) : null;
            return (
              <tr key={r.label}>
                <td className="px-4 py-2 text-slate-600">{<Tx>{r.label}</Tx>}</td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-500">{<Tx>{r.fmt(r.b)}</Tx>}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-900">{<Tx>{r.fmt(r.a)}</Tx>}</td>
                <td className={cx("px-4 py-2 text-right tabular-nums", diff !== null && diff < 0 ? "text-emerald-600" : diff ? "text-red-600" : "text-slate-400")}>
                  {diff === null || diff === 0
                    ? "—"
                    : pct !== null
                      ? `${pct > 0 ? "+" : ""}${pct}%`
                      : r.label === "All done by"
                        ? <Tx>{`${diff < 0 ? "−" : "+"}${formatDuration(Math.abs(diff))}`}</Tx>
                        : `${diff > 0 ? "+" : ""}${diff}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
