import { and, count, eq, gte, ne, or } from "drizzle-orm";
import { ExternalLink, LogOut } from "lucide-react";
import Link from "@/components/link";
import { logout } from "@/app/actions/auth";
import { PIPELINE, requireUser } from "@/lib/auth/dal";
import { homeFor } from "@/lib/auth/session";
import { Logo } from "@/components/brand";
import { LanguageSwitch } from "@/components/language-switch";
import { initials } from "@/lib/account";
import { getDb } from "@/lib/db";
import { restoreDeliveries } from "@/lib/deliveries";
import { enquiries, orders, salesOrders } from "@/lib/db/schema";
import { missedDelivery } from "@/lib/staff-orders";
import { getSettings } from "@/lib/planning";
import { dueFollowUpCount } from "@/lib/pipeline";
import { pendingMatchCount } from "@/lib/price-match";
import { todayIn } from "@/lib/time";
import { AdminLive } from "./admin-live";
import { AdminSearch } from "./admin-search";
import { SideNav } from "./side-nav";
import { T } from "@/components/i18n";
import { RoleSwitch } from "@/components/role-switch";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  // Pages check their own roles too; sales staff only get the pipeline and the customer map.
  const db = await getDb();
  const [user, s] = await Promise.all([requireUser(PIPELINE), getSettings(db)]);
  await restoreDeliveries(db, s.timezone);
  // Sidebar badges. They update with the page's live refresh, so new orders show up without reloading.
  // Only badges: one that can't be counted is left off (and logged) rather than failing every page.
  const n = (rows: { n: number }[]) => rows[0]?.n ?? 0;
  const office = user.role !== "sales";
  const [newEnquiries, newSales, toShip, followUps, priceMatches] = await Promise.all(
    (
      [
        ["enquiries", () => db.select({ n: count() }).from(enquiries).where(eq(enquiries.status, "new")).then(n)],
        // Shop orders waiting on the office: not yet confirmed, confirmed and not yet picked for a
        // day still to come, or their day passed without a delivery.
        [
          "sales",
          () =>
            db
              .select({ n: count() })
              .from(salesOrders)
              .where(
                or(
                  eq(salesOrders.status, "pending"),
                  and(eq(salesOrders.status, "confirmed"), eq(salesOrders.fulfilment, "new"), gte(salesOrders.deliveryDate, todayIn(s.timezone))),
                  missedDelivery(todayIn(s.timezone)),
                ),
              )
              .then(n),
        ],
        // Deliveries from today on that aren't on any shipment yet.
        [
          "shipments",
          () =>
            db
              .select({ n: count() })
              .from(orders)
              .where(and(eq(orders.status, "pending"), gte(orders.deliveryDate, todayIn(s.timezone)), ne(orders.source, "quick_route")))
              .then(n),
        ],
        // Customers due a follow-up today (reminders set, or gone quiet).
        ["follow-ups", () => dueFollowUpCount(db, user)],
        // Price matches waiting for the office to approve.
        ["price-matches", () => (office ? pendingMatchCount(db) : Promise.resolve(0))],
      ] as const
    ).map(([name, run]) =>
      run().catch((err: unknown) => {
        console.error(`[admin] couldn't count the ${name} badge:`, err);
        return 0;
      }),
    ),
  );
  const badges = { "/admin/enquiries": newEnquiries, "/admin/sales": newSales, "/admin/shipments": toShip, "/admin/pipeline": followUps, "/admin/price-matches": priceMatches };

  return (
    <div className="print-plain min-h-dvh lg:pl-[16.5rem]">
      {/* A faint wash of colour behind everything, for the glass menu to pick up. */}
      <div aria-hidden className="app-ambient no-print pointer-events-none fixed inset-0 -z-10" />
      <aside className="glass no-print fixed top-3 bottom-3 left-3 z-30 hidden w-60 flex-col overflow-hidden rounded-2xl text-slate-600 lg:flex">
        <div className="px-4 pt-5 pb-3">
          <Logo className="h-9" />
          <p className="mt-2 truncate px-0.5 text-[11px] text-slate-400"><T>{"Back office ·"}</T>{" "}{s.companyName}</p>
        </div>
        <AdminSearch role={user.role} variant="sidebar" />
        <SideNav role={user.role} badges={badges} />
        <Link href="/" target="_blank" className="mx-3 mb-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-500 transition-colors duration-150 hover:bg-white/60 hover:text-slate-800">
          <ExternalLink className="size-3.5" /> {" "}<T>{"View website"}</T></Link>
        <div className="px-4 pb-3">
          <LanguageSwitch tone="neutral" />
        </div>
        <div className="mt-auto border-t border-slate-900/[0.06] p-3">
          {/* Someone who also drives (or sells): switch jobs without signing out. */}
          {user.roles.length > 1 && (
            <div className="mb-2 px-1">
              <RoleSwitch roles={user.roles} current={user.role} tone="light" />
            </div>
          )}
          <div className="flex items-center gap-1 rounded-lg">
            <Link href="/account" title="Profile & password" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-white/60">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">{initials(user.name)}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-medium text-slate-900">{user.name}</span>
                <span className="block text-[11px] capitalize text-slate-500"><T>{user.role}</T> {" "}<T>{"· profile"}</T></span>
              </span>
            </Link>
            <form action={logout}>
              <button className="grid size-8 place-items-center rounded-md text-slate-400 transition-colors duration-150 hover:bg-slate-200/60 hover:text-slate-800" aria-label="Sign out" title="Sign out">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      {/* Glass: pages scroll softly blurred beneath it. (The menu drawer renders into <body>, so the bar's blur can't confine it.) */}
      <header className="glass no-print sticky top-0 z-30 text-slate-900 lg:hidden">
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          <Link href={homeFor(user.role)} aria-label="Dashboard" className="shrink-0">
            <Logo className="h-8" />
          </Link>
          <div className="flex min-w-0 items-center gap-1">
            <AdminSearch role={user.role} variant="icon" />
            {user.roles.length > 1 && <RoleSwitch roles={user.roles} current={user.role} tone="light" compact />}
            <LanguageSwitch tone="neutral" />
            <Link href="/account" aria-label="Profile & password" className="ml-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">
              {initials(user.name)}
            </Link>
            <form action={logout}>
              <button className="grid size-9 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-100" aria-label="Sign out">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </div>
        <SideNav role={user.role} mobile badges={badges} />
      </header>

      <main className="print-plain mx-auto w-full max-w-[1600px] p-4 sm:p-6">{children}</main>
      <AdminLive />
    </div>
  );
}
