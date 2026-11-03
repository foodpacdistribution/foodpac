"use client";

import { BarChart3, Boxes, Building2, Inbox, LayoutDashboard, Map, Package, PackageCheck, Radio, Settings, ShoppingBag, TrendingUp, Truck, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LinkPending } from "@/components/client-ui";
import { cx } from "@/components/ui";
import type { Role } from "@/lib/db/schema";
import { useT } from "@/components/i18n";

const SECTIONS = [
  { title: "Overview", items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard }] },
  {
    title: "Shop",
    items: [
      { href: "/admin/sales", label: "Sales Orders", icon: ShoppingBag },
      { href: "/admin/products", label: "Products & Stock", icon: Boxes },
    ],
  },
  {
    title: "Delivery",
    items: [
      { href: "/admin/orders", label: "Delivery Orders", icon: Package },
      { href: "/admin/shipments", label: "Shipments", icon: PackageCheck },
      { href: "/admin/planner", label: "Route Planner", icon: Map },
      { href: "/quick-route", label: "Quick Route", icon: Zap },
      { href: "/admin/tracking", label: "Live Tracking", icon: Radio },
    ],
  },
  {
    title: "People",
    items: [
      { href: "/admin/customers", label: "Customers", icon: Building2 },
      { href: "/admin/drivers", label: "Drivers", icon: Truck },
    ],
  },
  {
    title: "Analytics",
    items: [
      { href: "/admin/reports", label: "Sales Report", icon: TrendingUp },
      { href: "/admin/history", label: "Delivery History", icon: BarChart3 },
    ],
  },
  { title: "Website", items: [{ href: "/admin/enquiries", label: "Enquiries", icon: Inbox }] },
  { title: "System", items: [{ href: "/admin/settings", label: "Settings", icon: Settings, adminOnly: true }] },
];

/** Counts shown next to menu items, by link. */
export type NavBadges = Partial<Record<string, number>>;

export function SideNav({ role, mobile, badges = {} }: { role: Role; mobile?: boolean; badges?: NavBadges }) {
  const pathname = usePathname();
  const tr = useT();
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));
  const count = (href: string) => (badges[href] ? badges[href] : null);
  const sections = SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => !("adminOnly" in i) || role === "admin") })).filter(
    (s) => s.items.length,
  );

  if (mobile) {
    return (
      <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
        {sections.flatMap((s) => s.items).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cx(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium",
              isActive(href) ? "bg-white/15 text-white" : "text-slate-300",
            )}
          >
            <Icon className="size-3.5" />
            {tr(label)}
            {count(href) && <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">{count(href)}</span>}
            <LinkPending className="hidden" />
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="flex-1 space-y-3.5 overflow-y-auto px-3 py-2">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{tr(section.title)}</p>
          <div className="space-y-0.5">
            {section.items.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cx(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
                  isActive(href) ? "bg-blue-600 text-white shadow-sm" : "hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className="size-4" />
                {tr(label)}
                {count(href) && (
                  <span className="ml-auto rounded-full bg-red-500 px-1.5 py-px text-[10px] font-semibold tabular-nums text-white">{count(href)}</span>
                )}
                <LinkPending className="ml-auto" />
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
