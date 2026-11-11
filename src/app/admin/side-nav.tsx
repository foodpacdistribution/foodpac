"use client";

import { BadgeDollarSign, BarChart3, Boxes, Building2, ClipboardList, Factory, FileText, GalleryHorizontal, HandCoins, Inbox, LayoutDashboard, Map, MapPinned, Package, PackageCheck, PackagePlus, Radio, RotateCcw, Settings, ShoppingBag, Target, TrendingUp, Truck, Undo2, Wallet, Warehouse, Zap, ChevronDown, Menu as MenuIcon, X } from "lucide-react";
import Link from "@/components/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Drawer } from "@/components/drawer";
import { LinkPending } from "@/components/client-ui";
import { cx } from "@/components/ui";
import type { Role } from "@/lib/db/schema";
import { SALES_PAGES } from "@/lib/auth/sales-pages";
import { useT } from "@/components/i18n";

const SECTIONS = [
  { title: "Overview", items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard }] },
  {
    title: "Shop",
    items: [
      { href: "/admin/quotes", label: "Quotations", icon: FileText },
      { href: "/admin/sales", label: "Sales Orders", icon: ShoppingBag },
      { href: "/admin/products", label: "Products & Stock", icon: Boxes },
      { href: "/admin/customer-returns", label: "Customer Returns", icon: RotateCcw },
      { href: "/admin/customer-credit", label: "Store Credit", icon: BadgeDollarSign },
    ],
  },
  {
    title: "Purchasing",
    items: [
      { href: "/admin/purchase-orders", label: "Purchase Orders", icon: ClipboardList },
      { href: "/admin/goods-receipts", label: "Goods Receipts", icon: PackagePlus },
      { href: "/admin/purchase-returns", label: "Purchase Returns", icon: Undo2 },
      { href: "/admin/inventory", label: "Inventory", icon: Warehouse },
      { href: "/admin/supplier-payments", label: "Supplier Payments", icon: Wallet },
      { href: "/admin/supplier-refunds", label: "Supplier Refunds", icon: HandCoins },
      { href: "/admin/suppliers", label: "Suppliers", icon: Factory },
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
      { href: "/admin/pipeline", label: "Sales Pipeline", icon: Target },
      { href: "/admin/customers", label: "Customers", icon: Building2 },
      { href: "/admin/customer-map", label: "Customer Map", icon: MapPinned },
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
  {
    title: "Website",
    items: [
      { href: "/admin/posters", label: "Home Page Posters", icon: GalleryHorizontal },
      { href: "/admin/enquiries", label: "Enquiries", icon: Inbox },
    ],
  },
  { title: "System", items: [{ href: "/admin/settings", label: "Settings", icon: Settings, adminOnly: true }] },
];

/** Counts shown next to menu items, by link. */
export type NavBadges = Partial<Record<string, number>>;

/**
 * Counts that mean "something needs you" are red; the rest are plain to-do counts. Deliveries
 * not yet on a shipment are normal every morning, so that count isn't an alarm.
 */
const URGENT = new Set(["/admin/sales", "/admin/enquiries"]);

export type NavItem = (typeof SECTIONS)[number]["items"][number];

/** The menu this role sees: sales staff only get the pipeline and customer map; Settings is admin only. */
export function navFor(role: Role) {
  const allowed = (i: NavItem) => (role === "sales" ? SALES_PAGES.includes(i.href) : !("adminOnly" in i) || role === "admin");
  return SECTIONS.map((s) => ({ ...s, items: s.items.filter(allowed) })).filter((s) => s.items.length);
}

const COLLAPSED_KEY = "dp.nav.collapsed";

function useCollapsed() {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
      // Restored after the first paint, so the server and browser render the same menu.
      if (Array.isArray(saved) && saved.length) queueMicrotask(() => setCollapsed(saved));
    } catch {
      // Storage blocked: every section starts open.
    }
  }, []);
  const toggle = (title: string) =>
    setCollapsed((c) => {
      const next = c.includes(title) ? c.filter((t) => t !== title) : [...c, title];
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  return [collapsed, toggle] as const;
}

function Badge({ href, n, className }: { href: string; n: number; className?: string }) {
  return (
    <span
      className={cx(
        "rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums",
        URGENT.has(href) ? "bg-red-500 text-white" : "bg-white/15 text-slate-200",
        className,
      )}
    >
      {n}
    </span>
  );
}

export function SideNav({ role, mobile, badges = {} }: { role: Role; mobile?: boolean; badges?: NavBadges }) {
  const pathname = usePathname();
  const tr = useT();
  const [collapsed, toggle] = useCollapsed();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));
  const count = (href: string) => badges[href] || 0;
  const sections = navFor(role);
  // Close the phone menu once a page is picked.
  useEffect(() => {
    queueMicrotask(() => setMenuOpen(false));
  }, [pathname]);

  const list = (opts: { foldable: boolean; roomy?: boolean; onNavigate?: () => void }) => (
    <div className="space-y-2">
      {sections.map((section) => {
        const hasActive = section.items.some((i) => isActive(i.href));
        const single = section.items.length === 1 && section.title === "Overview";
        const open = !opts.foldable || single || hasActive || !collapsed.includes(section.title);
        const hidden = section.items.reduce((n, i) => n + count(i.href), 0);
        const urgentHidden = section.items.some((i) => URGENT.has(i.href) && count(i.href));
        return (
          <div key={section.title}>
            {!single && (
              <button
                type="button"
                onClick={() => opts.foldable && !hasActive && toggle(section.title)}
                aria-expanded={open}
                className="flex w-full items-center gap-1 rounded px-2.5 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-300"
              >
                {tr(section.title)}
                {opts.foldable && !open && hidden > 0 && (
                  <span className={cx("ml-1 rounded-full px-1.5 text-[10px] tracking-normal", urgentHidden ? "bg-red-500 text-white" : "bg-white/15 text-slate-200")}>{hidden}</span>
                )}
                {opts.foldable && !hasActive && <ChevronDown className={cx("ml-auto size-3 transition-transform", !open && "-rotate-90")} />}
              </button>
            )}
            {open && (
              <div className="space-y-0.5">
                {section.items.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={opts.onNavigate}
                    className={cx(
                      "flex items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors",
                      opts.roomy ? "py-2.5" : "py-1.5",
                      isActive(href) ? "bg-blue-600 text-white shadow-sm" : "hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon className="size-4" />
                    {tr(label)}
                    {count(href) > 0 && <Badge href={href} n={count(href)} className="ml-auto" />}
                    <LinkPending className="ml-auto" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  if (mobile) {
    const current = sections.flatMap((s) => s.items).find((i) => isActive(i.href));
    const total = sections.flatMap((s) => s.items).reduce((n, i) => n + count(i.href), 0);
    return (
      <>
        <div className="flex items-center gap-2 px-3 pb-2">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
            className="flex h-10 items-center gap-2 rounded-lg bg-white/10 px-3 text-sm font-medium text-white transition-transform duration-150 active:scale-95 active:bg-white/15"
          >
            <MenuIcon className="size-4" /> {tr("Menu")}
            {total > 0 && <span className="rounded-full bg-white/20 px-1.5 text-[10px] font-semibold tabular-nums">{total}</span>}
          </button>
          {current && (
            <span className="flex min-w-0 items-center gap-1.5 truncate text-sm text-slate-300">
              <current.icon className="size-4 shrink-0" /> <span className="truncate">{tr(current.label)}</span>
            </span>
          )}
        </div>
        <Drawer open={menuOpen} onClose={closeMenu} label={tr("Menu")} className="bg-navy-900 px-3 pt-[max(env(safe-area-inset-top),0.75rem)] pb-6 text-slate-300">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-sm font-semibold text-white">{tr("Menu")}</span>
            <button type="button" onClick={closeMenu} className="grid size-10 place-items-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 active:bg-white/15" aria-label={tr("Close")}>
              <X className="size-5" />
            </button>
          </div>
          {/* Closes on tap, before the next page has loaded, so the menu never seems stuck. */}
          {list({ foldable: false, roomy: true, onNavigate: closeMenu })}
        </Drawer>
      </>
    );
  }

  return <nav className="flex-1 overflow-y-auto px-3 py-1">{list({ foldable: true })}</nav>;
}
