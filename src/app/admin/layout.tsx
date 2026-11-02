import { count, eq } from "drizzle-orm";
import { ExternalLink, LogOut } from "lucide-react";
import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { BrandMark, Logo } from "@/components/brand";
import { initials } from "@/lib/account";
import { getDb } from "@/lib/db";
import { enquiries } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { AdminLive } from "./admin-live";
import { SideNav } from "./side-nav";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(STAFF);
  const db = await getDb();
  const [s, [{ n: newEnquiries }]] = await Promise.all([
    getSettings(db),
    db.select({ n: count() }).from(enquiries).where(eq(enquiries.status, "new")),
  ]);

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-navy-900 text-slate-300 lg:flex">
        <div className="px-4 pt-4 pb-2">
          <Logo badge className="h-11" />
          <p className="mt-2 truncate px-1 text-[11px] text-slate-400">Back office · {s.companyName}</p>
        </div>
        <SideNav role={user.role} newEnquiries={newEnquiries} />
        <Link href="/" target="_blank" className="mx-3 mb-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-400 hover:bg-white/5 hover:text-white">
          <ExternalLink className="size-3.5" /> View website
        </Link>
        <div className="mt-auto border-t border-white/10 p-3">
          <div className="flex items-center gap-1 rounded-lg">
            <Link href="/account" title="Profile & password" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy-700 text-xs font-semibold text-white">{initials(user.name)}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-medium text-white">{user.name}</span>
                <span className="block text-[11px] capitalize text-slate-400">{user.role} · profile</span>
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
        <div className="flex h-12 items-center justify-between px-4">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <BrandMark className="size-6" /> Foodpac Admin
          </span>
          <form action={logout}>
            <button className="text-xs text-slate-300">Sign out</button>
          </form>
        </div>
        <SideNav role={user.role} mobile newEnquiries={newEnquiries} />
      </header>

      <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">{children}</main>
      <AdminLive />
    </div>
  );
}
