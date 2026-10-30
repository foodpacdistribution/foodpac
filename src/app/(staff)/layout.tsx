import { LogOut, Route as RouteIcon } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/planning";
import { SideNav } from "./side-nav";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(STAFF);
  const s = await getSettings(await getDb());

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-navy-900 text-slate-300 lg:flex">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <span className="grid size-8 place-items-center rounded-lg bg-blue-600 text-white">
            <RouteIcon className="size-4.5" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-semibold text-white">Delivery Planner</p>
            <p className="truncate text-[11px] text-slate-400">{s.companyName}</p>
          </div>
        </div>
        <SideNav role={user.role} />
        <div className="mt-auto border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy-700 text-xs font-semibold text-white">
              {user.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium text-white">{user.name}</p>
              <p className="text-[11px] capitalize text-slate-400">{user.role}</p>
            </div>
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
        <div className="flex h-12 items-center justify-between px-4">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <RouteIcon className="size-4 text-blue-400" /> Delivery Planner
          </span>
          <form action={logout}>
            <button className="text-xs text-slate-300">Sign out</button>
          </form>
        </div>
        <SideNav role={user.role} mobile />
      </header>

      <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">{children}</main>
    </div>
  );
}
