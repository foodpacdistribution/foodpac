import { eq, sql } from "drizzle-orm";
import { ShoppingCart, UserRound } from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { LanguageSwitch } from "@/components/language-switch";
import Link from "next/link";
import { ViewTransition } from "react";
import { Logo } from "@/components/brand";
import { getCurrentCustomer, getCurrentUser } from "@/lib/auth/dal";
import { accountLinks } from "@/lib/account";
import { getDb } from "@/lib/db";
import { cartItems } from "@/lib/db/schema";
import { CATEGORIES, categoryHref, SITE } from "./content";
import { CartBadge } from "./cart-badge";
import { SearchBox } from "./search-box";
import { T } from "@/components/i18n";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [user, viewer] = await Promise.all([getCurrentUser(), getCurrentCustomer()]);
  const [{ n: cartCount }] = viewer
    ? await (await getDb())
        .select({ n: sql<number>`coalesce(sum(${cartItems.qty}), 0)::int` })
        .from(cartItems)
        .where(eq(cartItems.customerId, viewer.customer.id))
    : [{ n: 0 }];

  return (
    // A column the height of the window: on short pages the content grows and the footer sits at the bottom.
    <div className="flex min-h-dvh flex-col bg-cream text-leaf-950">
      <header className="site-header sticky top-0 z-40 border-b border-leaf-950/10 bg-cream/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Foodpac Distribution home">
            <Logo className="h-9 sm:h-11" priority />
            <span className="hidden border-l border-leaf-950/15 pl-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-leaf-800 lg:block"><T>{"Distribution"}</T></span>
          </Link>
          <SearchBox className="hidden flex-1 md:flex" />
          <nav className="ml-auto flex items-center gap-1 text-sm font-medium">
            {user ? (
              <AccountMenu name={user.name} email={user.email} role={user.role} subtitle={viewer?.customer.name} links={accountLinks(user.role)} />
            ) : (
              <>
                <LanguageSwitch className="mr-1 hidden sm:inline-flex" />
                <Link href="/login" className="flex h-10 items-center gap-1.5 rounded-full px-3 hover:bg-leaf-950/5">
                  <UserRound className="size-4" /> {" "}<T>{"Sign in"}</T></Link>
                <Link href="/register" className="hidden h-10 items-center rounded-full bg-leaf-700 px-4 font-semibold text-white hover:bg-leaf-800 sm:flex">
                  <T>{"Open an account"}</T></Link>
              </>
            )}
            {viewer && (
              <Link href="/cart" className="relative flex h-10 items-center gap-1.5 rounded-full px-3 hover:bg-leaf-950/5" aria-label={`Cart, ${cartCount} items`}>
                <ShoppingCart className="size-4" />
                <span className="hidden sm:inline"><T>{"Cart"}</T></span>
                <CartBadge count={cartCount} />
              </Link>
            )}
          </nav>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-3 md:hidden">
          <SearchBox className="flex" />
        </div>
        <nav className="border-t border-leaf-950/5">
          <div className="mx-auto flex max-w-6xl gap-5 overflow-x-auto px-4 py-2.5 text-sm whitespace-nowrap text-leaf-900/75 sm:px-6">
            <Link href="/products" className="font-semibold text-leaf-950 hover:text-leaf-700">
              <T>{"All products"}</T></Link>
            {CATEGORIES.map((c) => (
              <Link key={c.title} href={categoryHref(c.title)} className="hover:text-leaf-700">
                <T>{c.title}</T>
              </Link>
            ))}
            {viewer && (
              <Link href="/portal/quick-order" className="hover:text-leaf-700">
                <T>{"Quick order"}</T></Link>
            )}
            <Link href="/#contact" className="hover:text-leaf-700">
              <T>{"Contact"}</T></Link>
          </div>
        </nav>
      </header>

      {/* Crossfades page content on navigation; the header and footer stay put. */}
      <ViewTransition>
        <div className="flex-1">{children}</div>
      </ViewTransition>

      <footer className="bg-leaf-950 text-leaf-100/70">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[1.5fr_1fr_1fr] sm:px-6">
          <div className="flex items-start gap-2.5">
            <div className="leading-tight">
              <Logo badge className="h-12" />
              <p className="mt-3 font-display font-semibold text-white">{SITE.name}</p>
              <p className="mt-1 text-xs">
                <T>{SITE.tagline}</T> <T>{"Serving"}</T> <T>{SITE.serviceArea}</T>.
              </p>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-white"><T>{"Shop"}</T></p>
            <Link href="/products" className="block hover:text-white">
              <T>{"All products"}</T></Link>
            <Link href="/register" className="block hover:text-white">
              <T>{"Open an account"}</T></Link>
            <Link href="/#contact" className="block hover:text-white">
              <T>{"Contact us"}</T></Link>
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-white"><T>{"Account"}</T></p>
            <Link href="/portal" className="block hover:text-white">
              <T>{"My orders"}</T></Link>
            <Link href="/login" className="block hover:text-white">
              <T>{"Staff & driver login"}</T></Link>
          </div>
        </div>
        <div className="border-t border-white/10">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-leaf-100/50 sm:px-6">
            © {new Date().getFullYear()} {SITE.name}<T>{". Prices exclude GST unless shown otherwise."}</T></p>
        </div>
      </footer>
    </div>
  );
}
