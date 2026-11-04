"use client";

import Link from "@/components/link";
import { usePathname } from "next/navigation";
import { useT } from "@/components/i18n";
import { cx } from "@/components/ui";

const TABS = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/orders", label: "Orders" },
  { href: "/portal/deliveries", label: "Deliveries" },
  { href: "/portal/invoices", label: "Invoices" },
  { href: "/portal/list", label: "My list" },
  { href: "/portal/quick-order", label: "Quick order" },
  { href: "/portal/addresses", label: "Addresses" },
  { href: "/portal/profile", label: "Profile" },
];

export function PortalNav() {
  const pathname = usePathname();
  const tr = useT();
  const active = (href: string) => (href === "/portal" ? pathname === "/portal" : pathname.startsWith(href) || (href === "/portal/deliveries" && pathname.startsWith("/portal/track")));
  return (
    <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cx(
            "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
            active(t.href) ? "bg-leaf-700 text-white" : "text-leaf-900/70 hover:bg-leaf-950/5",
          )}
        >
          {tr(t.label)}
        </Link>
      ))}
    </nav>
  );
}
