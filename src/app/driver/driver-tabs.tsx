"use client";

import { History, Route, UserRound, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const TABS = [
  { href: "/driver", label: "Today", icon: Route },
  { href: "/driver/history", label: "History", icon: History },
  { href: "/quick-route", label: "Quick route", icon: Zap },
  { href: "/account", label: "Profile", icon: UserRound },
];

/** Thumb-reach tab bar for the driver's phone. */
export function DriverTabs() {
  const pathname = usePathname();
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto grid max-w-lg grid-cols-4">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/driver" ? pathname === "/driver" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors active:scale-95", active ? "text-blue-600" : "text-slate-500")}
            >
              <Icon className={cx("size-5", active && "stroke-[2.4]")} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
