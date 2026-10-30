import { getCurrentUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getPlanView } from "@/lib/planning";
import { formatClock, formatMinutesClock } from "@/lib/time";

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote everything; neutralise spreadsheet formula injection.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replaceAll('"', '""')}"`;
};

export async function GET(_req: Request, ctx: RouteContext<"/api/plans/[date]/export">) {
  const user = await getCurrentUser();
  if (!user || !STAFF.includes(user.role)) return new Response("Unauthorised", { status: 401 });
  const { date } = await ctx.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response("Bad date", { status: 400 });

  const view = await getPlanView(await getDb(), date);
  const header = ["Driver", "Vehicle", "Stop", "Order", "Customer", "Address", "Phone", "Window", "ETA", "Depart", "Leg km", "Leg drive min", "Status", "Notes"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of view.routes) {
    for (const s of r.stops) {
      const w =
        s.order.windowStartMin === null && s.order.windowEndMin === null
          ? ""
          : `${formatMinutesClock(s.order.windowStartMin)}-${formatMinutesClock(s.order.windowEndMin)}`;
      lines.push(
        [
          r.driverName,
          r.vehicle,
          s.seq,
          s.order.orderNumber,
          s.order.customerName,
          s.order.address,
          s.order.phone,
          w,
          formatClock(s.etaS),
          formatClock(s.etdS),
          (s.legDistanceM / 1000).toFixed(1),
          Math.round(s.legDriveS / 60),
          s.status,
          s.order.notes,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="delivery-plan-${date}.csv"`,
    },
  });
}
