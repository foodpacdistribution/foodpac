import { sql } from "drizzle-orm";
import { getCurrentUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/planning";
import { todayIn } from "@/lib/time";

// "Has anything changed?" for live screens. Returns a short fingerprint of the data a screen
// shows; the page polls it every few seconds and only re-renders when it changes. Each role
// only gets a fingerprint of what it's allowed to see.

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { rows?: Row[] }).rows ?? []));

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "signed out" }, { status: 401 });
  const scope = new URL(req.url).searchParams.get("scope") ?? "";
  const db = await getDb();
  let row: Row | undefined;

  if (STAFF.includes(user.role) && (scope === "admin" || scope === "tracking")) {
    const today = todayIn((await getSettings(db)).timezone);
    row = rowsOf(
      await db.execute(sql`
        select
          (select count(*) from orders)::int as orders,
          (select coalesce(max(updated_at), 'epoch') from orders)::text as orders_at,
          (select count(*) from sales_orders)::int as sales,
          (select count(*) from sales_orders where status = 'confirmed' and fulfilment = 'new')::int as to_pick,
          (select coalesce(max(greatest(created_at, coalesce(paid_at, created_at), coalesce(cancelled_at, created_at))), 'epoch') from sales_orders)::text as sales_at,
          (select count(*) from routes)::int as routes,
          (select coalesce(max(dispatched_at), 'epoch') from routes)::text as sent_at,
          (select count(*) from route_stops)::int as stops,
          (select coalesce(max(completed_at), 'epoch') from route_stops)::text as done_at,
          (select coalesce(max(updated_at), 'epoch') from plans)::text as plans_at,
          (select count(*) from enquiries)::int as enquiries,
          (select count(*) from customers)::int as customers,
          ${scope === "tracking" ? sql`(select coalesce(max(recorded_at), 'epoch') from vehicle_locations where recorded_at > ${today}::date - 1)::text` : sql`''`} as gps_at
      `),
    )[0];
  } else if (user.role === "driver" && user.driverId) {
    const today = todayIn((await getSettings(db)).timezone);
    row = rowsOf(
      await db.execute(sql`
        select r.id, r.status, r.end_s, coalesce(r.dispatched_at, 'epoch')::text as sent_at,
          (select count(*) from route_stops s where s.route_id = r.id)::int as stops,
          (select string_agg(s.order_id::text || s.seq || s.status, ',' order by s.seq) from route_stops s where s.route_id = r.id) as seq
        from routes r join plans p on p.id = r.plan_id
        where r.driver_id = ${user.driverId} and p.delivery_date = ${today} and r.dispatched_at is not null
        limit 1
      `),
    )[0] ?? { none: true };
    // Shipments sent for later days (and stops added to them) count as a change too.
    const [later] = rowsOf(
      await db.execute(sql`
        select coalesce(string_agg(p.delivery_date::text || r.dispatched_at::text ||
          (select coalesce(string_agg(s.order_id::text || s.seq || s.status, ',' order by s.seq), '') from route_stops s where s.route_id = r.id),
          ',' order by p.delivery_date), '') as later
        from routes r join plans p on p.id = r.plan_id
        where r.driver_id = ${user.driverId} and p.delivery_date > ${today} and r.dispatched_at is not null
      `),
    );
    row = { ...row, later: later?.later ?? "" };
  } else if (user.role === "customer" && user.customerId) {
    row = rowsOf(
      await db.execute(sql`
        select
          (select count(*) from orders where customer_id = ${user.customerId})::int as orders,
          (select coalesce(max(updated_at), 'epoch') from orders where customer_id = ${user.customerId})::text as orders_at,
          (select count(*) from sales_orders where customer_id = ${user.customerId})::int as sales,
          (select coalesce(max(greatest(created_at, coalesce(paid_at, created_at))), 'epoch') || string_agg(status || fulfilment || payment_status, '') from sales_orders where customer_id = ${user.customerId}) as sales_at,
          (select coalesce(max(s.completed_at), 'epoch')::text || count(*) from route_stops s join orders o on o.id = s.order_id where o.customer_id = ${user.customerId}) as stops,
          (select coalesce(max(v.recorded_at), 'epoch')::text from vehicle_locations v
             join routes r on r.id = v.route_id and r.status = 'in_progress'
             join route_stops s on s.route_id = r.id and s.status = 'pending'
             join orders o on o.id = s.order_id and o.customer_id = ${user.customerId}
           where v.recorded_at > now() - interval '30 minutes') as gps_at
      `),
    )[0];
  } else {
    return Response.json({ v: "" });
  }

  const v = JSON.stringify(row ?? {});
  return Response.json(
    { v, sales: Number(row?.sales ?? 0), stops: Number(row?.stops ?? 0), enquiries: Number(row?.enquiries ?? 0) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
