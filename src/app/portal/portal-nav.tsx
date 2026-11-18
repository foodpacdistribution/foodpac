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
    <nav className="mx-auto flex max-w-5xl gap-6 overflow-x-auto px-4 text-sm [scrollbar-width:none]">
      {TABS.map((t) => {
        const on = active(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={cx(
              // An underline under the page you're on, like the shop's category row.
              "relative shrink-0 py-3 transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:origin-left after:bg-leaf-950 after:transition-transform after:duration-300 after:ease-[cubic-bezier(0.2,0.8,0.2,1)]",
              on ? "font-medium text-leaf-950 after:scale-x-100" : "text-leaf-900/60 after:scale-x-0 hover:text-leaf-950",
            )}
          >
            {tr(t.label)}
          </Link>
        );
      })}
    </nav>
  );
}
