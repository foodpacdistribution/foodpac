"use client";

import { BarChart3, LayoutDashboard, Map, Package, Radio, Settings, Truck, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import type { Role } from "@/lib/db/schema";

const SECTIONS = [
  { title: "Overview", items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    title: "Operations",
    items: [
      { href: "/orders", label: "Orders", icon: Package },
      { href: "/planner", label: "Route Planner", icon: Map },
      { href: "/quick-route", label: "Quick Route", icon: Zap },
      { href: "/tracking", label: "Live Tracking", icon: Radio },
    ],
  },
  { title: "Fleet", items: [{ href: "/drivers", label: "Drivers", icon: Truck }] },
  { title: "Analytics", items: [{ href: "/history", label: "Delivery History", icon: BarChart3 }] },
  { title: "System", items: [{ href: "/settings", label: "Settings", icon: Settings, adminOnly: true }] },
];

export function SideNav({ role, mobile }: { role: Role; mobile?: boolean }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
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
            {label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{section.title}</p>
          <div className="space-y-0.5">
            {section.items.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cx(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                  isActive(href) ? "bg-blue-600 text-white shadow-sm" : "hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
