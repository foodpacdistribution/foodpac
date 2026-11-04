import { eq, sql } from "drizzle-orm";
import { Clock, ShoppingCart, Store } from "lucide-react";
import Link from "@/components/link";
import { ViewTransition } from "react";
import { AccountMenu } from "@/components/account-menu";
import { LiveRefresh } from "@/components/live-refresh";
import { Logo } from "@/components/brand";
import { requireUser } from "@/lib/auth/dal";
import { accountLinks } from "@/lib/account";
import { getDb } from "@/lib/db";
import { cartItems, customers } from "@/lib/db/schema";
import { CartBadge } from "@/app/(site)/cart-badge";
import { PortalNav } from "./portal-nav";
import { T } from "@/components/i18n";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(["customer"]);
  const db = await getDb();
  const [c] = user.customerId ? await db.select().from(customers).where(eq(customers.id, user.customerId)).limit(1) : [];
  const [{ n: cartCount }] = c
    ? await db.select({ n: sql<number>`coalesce(sum(${cartItems.qty}), 0)::int` }).from(cartItems).where(eq(cartItems.customerId, c.id))
    : [{ n: 0 }];

  return (
    <div className="min-h-dvh bg-cream text-leaf-950">
      <header className="site-header no-print sticky top-0 z-30 border-b border-leaf-950/10 bg-cream/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <Logo className="h-9" />
            <span className="min-w-0 border-l border-leaf-950/15 pl-2.5 leading-tight">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-leaf-800"><T>{"My account"}</T></span>
              <span className="block truncate text-xs text-leaf-900/60">{c?.name ?? user.name}</span>
            </span>
          </Link>
          <div className="flex items-center gap-1 text-xs font-medium">
            <Link href="/products" className="flex h-9 items-center gap-1.5 rounded-full px-3 text-leaf-900/80 hover:bg-leaf-950/5">
              <Store className="size-3.5" /> <span className="hidden sm:inline"><T>{"Shop"}</T></span>
            </Link>
            <Link href="/cart" className="relative flex h-9 items-center gap-1.5 rounded-full px-3 text-leaf-900/80 hover:bg-leaf-950/5">
              <ShoppingCart className="size-3.5" /> <span className="hidden sm:inline"><T>{"Cart"}</T></span>
              <CartBadge count={cartCount} />
            </Link>
            <AccountMenu name={user.name} email={user.email} role="customer" subtitle={c?.name} links={accountLinks("customer")} />
          </div>
        </div>
        <PortalNav />
      </header>
      {c && !c.approved && (
        <div className="no-print border-b border-amber-200 bg-amber-50">
          <p className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2.5 text-sm text-amber-900">
            <Clock className="size-4 shrink-0" /> {" "}<T>{"Thanks for registering. We're checking your account; prices and ordering open as soon as it's approved."}</T></p>
        </div>
      )}
      <main className="mx-auto w-full max-w-5xl px-4 py-6">
        <ViewTransition>{children}</ViewTransition>
      </main>
      <LiveRefresh scope="customer" />
    </div>
  );
}
