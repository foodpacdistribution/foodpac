import { and, count, eq, gte, ne, or } from "drizzle-orm";
import { ExternalLink, LogOut } from "lucide-react";
import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { Logo } from "@/components/brand";
import { LanguageSwitch } from "@/components/language-switch";
import { initials } from "@/lib/account";
import { getDb } from "@/lib/db";
import { restoreDeliveries } from "@/lib/deliveries";
import { enquiries, orders, salesOrders } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { todayIn } from "@/lib/time";
import { AdminLive } from "./admin-live";
import { SideNav } from "./side-nav";
import { T } from "@/components/i18n";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(STAFF);
  const db = await getDb();
  const s = await getSettings(db);
  await restoreDeliveries(db, s.timezone);
  // Sidebar badges. They update with the page's live refresh, so new orders show up without reloading.
  const [[{ n: newEnquiries }], [{ n: newSales }], [{ n: toShip }]] = await Promise.all([
    db.select({ n: count() }).from(enquiries).where(eq(enquiries.status, "new")),
    // Shop orders waiting on the office: not yet confirmed, or confirmed and not yet picked.
    db
      .select({ n: count() })
      .from(salesOrders)
      .where(or(eq(salesOrders.status, "pending"), and(eq(salesOrders.status, "confirmed"), eq(salesOrders.fulfilment, "new")))),
    // Deliveries from today on that aren't on any shipment yet.
    db
      .select({ n: count() })
      .from(orders)
      .where(and(eq(orders.status, "pending"), gte(orders.deliveryDate, todayIn(s.timezone)), ne(orders.source, "quick_route"))),
  ]);
  const badges = { "/admin/enquiries": newEnquiries, "/admin/sales": newSales, "/admin/shipments": toShip };

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-navy-900 text-slate-300 lg:flex">
        <div className="px-4 pt-4 pb-2">
          <Logo badge className="h-11" />
          <p className="mt-2 truncate px-1 text-[11px] text-slate-400"><T>{"Back office ·"}</T>{" "}{s.companyName}</p>
        </div>
        <SideNav role={user.role} badges={badges} />
        <Link href="/" target="_blank" className="mx-3 mb-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-400 hover:bg-white/5 hover:text-white">
          <ExternalLink className="size-3.5" /> {" "}<T>{"View website"}</T></Link>
        <div className="px-4 pb-2">
          <LanguageSwitch tone="dark" />
        </div>
        <div className="mt-auto border-t border-white/10 p-3">
          <div className="flex items-center gap-1 rounded-lg">
            <Link href="/account" title="Profile & password" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy-700 text-xs font-semibold text-white">{initials(user.name)}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-medium text-white">{user.name}</span>
                <span className="block text-[11px] capitalize text-slate-400"><T>{user.role}</T> {" "}<T>{"· profile"}</T></span>
              </span>
            </Link>
            <form action={logout}>
              <button className="grid size-8 place-items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="no-print sticky top-0 z-30 border-b border-white/10 bg-navy-900 text-white lg:hidden">
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          <Link href="/admin" aria-label="Dashboard">
            <Logo badge className="h-9" />
          </Link>
          <div className="flex items-center gap-1.5">
            <LanguageSwitch tone="dark" />
            <Link href="/account" aria-label="Profile & password" className="grid size-8 place-items-center rounded-full bg-navy-700 text-xs font-semibold text-white">
              {initials(user.name)}
            </Link>
            <form action={logout}>
              <button className="grid size-8 place-items-center rounded-md text-slate-300 hover:bg-white/10" aria-label="Sign out">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </div>
        <SideNav role={user.role} mobile badges={badges} />
      </header>

      <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">{children}</main>
      <AdminLive />
    </div>
  );
}
