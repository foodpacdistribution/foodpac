import { eq, sql } from "drizzle-orm";
import { Clock, ShoppingCart, Store } from "lucide-react";
import Link from "next/link";
import { AccountMenu } from "@/components/account-menu";
import { BrandMark } from "@/components/brand";
import { requireUser } from "@/lib/auth/dal";
import { accountLinks } from "@/lib/account";
import { getDb } from "@/lib/db";
import { cartItems, customers } from "@/lib/db/schema";
import { PortalNav } from "./portal-nav";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(["customer"]);
  const db = await getDb();
  const [c] = user.customerId ? await db.select().from(customers).where(eq(customers.id, user.customerId)).limit(1) : [];
  const [{ n: cartCount }] = c
    ? await db.select({ n: sql<number>`coalesce(sum(${cartItems.qty}), 0)::int` }).from(cartItems).where(eq(cartItems.customerId, c.id))
    : [{ n: 0 }];

  return (
    <div className="min-h-dvh bg-cream text-leaf-950">
      <header className="no-print sticky top-0 z-30 border-b border-leaf-950/10 bg-cream/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <BrandMark className="size-8" />
            <span className="min-w-0 leading-tight">
              <span className="block font-display text-sm font-semibold">Foodpac Distribution</span>
              <span className="block truncate text-[11px] text-leaf-900/60">{c?.name ?? user.name}</span>
            </span>
          </Link>
          <div className="flex items-center gap-1 text-xs font-medium">
            <Link href="/products" className="flex h-9 items-center gap-1.5 rounded-full px-3 text-leaf-900/80 hover:bg-leaf-950/5">
              <Store className="size-3.5" /> <span className="hidden sm:inline">Shop</span>
            </Link>
            <Link href="/cart" className="relative flex h-9 items-center gap-1.5 rounded-full px-3 text-leaf-900/80 hover:bg-leaf-950/5">
              <ShoppingCart className="size-3.5" /> <span className="hidden sm:inline">Cart</span>
              {cartCount > 0 && <span className="rounded-full bg-tomato px-1.5 text-[10px] font-semibold text-white">{cartCount}</span>}
            </Link>
            <AccountMenu name={user.name} email={user.email} role="customer" subtitle={c?.name} links={accountLinks("customer")} />
          </div>
        </div>
        <PortalNav />
      </header>
      {c && !c.approved && (
        <div className="no-print border-b border-amber-200 bg-amber-50">
          <p className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2.5 text-sm text-amber-900">
            <Clock className="size-4 shrink-0" /> Thanks for registering. We&apos;re checking your account; prices and ordering open as soon as it&apos;s approved.
          </p>
        </div>
      )}
      <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
