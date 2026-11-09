import { eq, sql } from "drizzle-orm";
import { Clock, Heart, Mail, Phone, ShoppingCart, Truck, UserRound } from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { LanguageSwitch } from "@/components/language-switch";
import Link from "@/components/link";
import { Suspense, ViewTransition } from "react";
import { Logo } from "@/components/brand";
import { getCurrentCustomer, getCurrentUser } from "@/lib/auth/dal";
import { accountLinks } from "@/lib/account";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/planning";
import { deliveryPromise } from "@/lib/shop";
import { cartItems } from "@/lib/db/schema";
import { categoryHref, SITE } from "./content";
import { categoryCounts, stockedCategories } from "./live-categories";
import { siteInfo } from "./site-info";
import { BackToTop } from "./back-to-top";
import { CartBadge } from "./cart-badge";
import { DeliveryPromiseText, FreeDeliveryText } from "./delivery-promise";
import { CategoryNav } from "./category-nav";
import { NavProgress } from "./nav-progress";
import { SearchBox } from "./search-box";
import { T } from "@/components/i18n";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const db = await getDb();
  const [user, viewer, settings, counts] = await Promise.all([getCurrentUser(), getCurrentCustomer(), getSettings(db), categoryCounts(db)]);
  const ranges = stockedCategories(counts);
  const promise = deliveryPromise(settings);
  const site = siteInfo(settings);
  const [{ n: cartCount }] = viewer
    ? await db
        .select({ n: sql<number>`coalesce(sum(${cartItems.qty}), 0)::int` })
        .from(cartItems)
        .where(eq(cartItems.customerId, viewer.customer.id))
    : [{ n: 0 }];

  return (
    // A column the height of the window: on short pages the content grows and the footer sits at the bottom.
    <div className="shop flex min-h-dvh flex-col bg-cream text-leaf-950">
      {/* The delivery promise, on every shop page (scrolls away with the page). */}
      {promise && (
        <div className="bg-leaf-950 text-[12px] text-cream/85 sm:text-xs">
          <div className="mx-auto flex h-8 max-w-6xl items-center justify-center gap-2 px-4 sm:justify-between sm:px-6">
            <p className="flex min-w-0 items-center gap-2">
              <Truck className="size-3.5 shrink-0 text-tomato" />
              <span className="truncate font-medium text-white">
                <DeliveryPromiseText promise={promise} />
              </span>
              <span className="hidden truncate text-cream/60 md:inline">
                · <FreeDeliveryText promise={promise} />
              </span>
            </p>
            <p className="hidden shrink-0 items-center gap-1.5 text-cream/60 sm:flex">
              <Clock className="size-3.5" />
              <T>{site.hours}</T>
            </p>
          </div>
        </div>
      )}
      <header className="site-header sticky top-0 z-40 border-b border-leaf-950/15 bg-cream">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Foodpac Distribution home">
            <Logo className="h-9 sm:h-11" priority />
                      </Link>
          <SearchBox className="hidden flex-1 md:flex" />
          <nav className="ml-auto flex items-center gap-1 text-sm font-medium">
            {user ? (
              <AccountMenu name={user.name} email={user.email} role={user.role} subtitle={viewer?.customer.name} links={accountLinks(user.role)} />
            ) : (
              <>
                <LanguageSwitch className="mr-1 hidden sm:inline-flex" />
                <Link href="/login" className="flex h-10 items-center gap-1.5 rounded-md px-3 hover:bg-leaf-950/5">
                  <UserRound className="size-4" /> {" "}<T>{"Sign in"}</T></Link>
                <Link href="/register" className="hidden h-10 items-center rounded-md bg-leaf-800 px-4 font-semibold text-white hover:bg-leaf-900 sm:flex">
                  <T>{"Open an account"}</T></Link>
              </>
            )}
            {viewer && (
              <Link href="/portal/list" className="flex size-10 items-center justify-center rounded-md hover:bg-leaf-950/5" aria-label="My list" title="My list">
                <Heart className="size-4" />
              </Link>
            )}
            {viewer && (
              <Link href="/cart" className="relative flex h-10 items-center gap-1.5 rounded-md px-3 hover:bg-leaf-950/5" aria-label={`Cart, ${cartCount} items`}>
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
        <nav className="border-t border-leaf-950/10" aria-label="Categories">
          <CategoryNav
            items={[
              { href: "/products", label: "All products" },
              ...ranges.map((c) => ({ href: categoryHref(c.title), label: c.title })),
              ...(viewer ? [{ href: "/portal/quick-order", label: "Quick order" }] : []),
              { href: "/#contact", label: "Contact" },
            ]}
          />
        </nav>
      </header>

      <Suspense>
        <NavProgress />
      </Suspense>

      {/* On a link click the new page rises in as the old one fades (other updates just crossfade);
          the header and footer stay put. Links carry the "nav" type (components/link.tsx). */}
      <ViewTransition update={{ nav: "page-nav", default: "auto" }}>
        <div className="flex-1">{children}</div>
      </ViewTransition>

      <BackToTop />

      <footer className="bg-leaf-950 text-leaf-100/70">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="leading-tight">
            <Logo badge className="h-11" />
            <p className="mt-4 max-w-xs text-sm">
              <T>{SITE.tagline}</T> <T>{"Serving"}</T> <T>{SITE.serviceArea}</T>.
            </p>
            <ul className="mt-4 space-y-1.5 text-sm">
              <li className="flex items-center gap-2">
                <Clock className="size-3.5 text-leaf-100/50" /> <T>{site.hours}</T>
              </li>
              {site.phone && (
                <li>
                  <a href={`tel:${site.phone.replace(/\s/g, "")}`} className="flex items-center gap-2 py-2 hover:text-white sm:py-0">
                    <Phone className="size-3.5 text-leaf-100/50" /> {site.phone}
                  </a>
                </li>
              )}
              {site.email && (
                <li>
                  <a href={`mailto:${site.email}`} className="flex items-center gap-2 py-2 hover:text-white sm:py-0">
                    <Mail className="size-3.5 text-leaf-100/50" /> {site.email}
                  </a>
                </li>
              )}
            </ul>
          </div>
          <div className="space-y-0 text-sm sm:space-y-2">
            <p className="pb-1 text-xs font-semibold text-white"><T>{"Categories"}</T></p>
            {ranges.map((c) => (
              <Link key={c.title} href={categoryHref(c.title)} className="block py-2 hover:text-white sm:py-0">
                <T>{c.title}</T>
              </Link>
            ))}
          </div>
          <div className="space-y-0 text-sm sm:space-y-2">
            <p className="pb-1 text-xs font-semibold text-white"><T>{"Shop"}</T></p>
            <Link href="/products" className="block py-2 hover:text-white sm:py-0">
              <T>{"All products"}</T></Link>
            <Link href="/#how-it-works" className="block py-2 hover:text-white sm:py-0">
              <T>{"How it works"}</T></Link>
            <Link href="/#delivery" className="block py-2 hover:text-white sm:py-0">
              <T>{"Delivery"}</T></Link>
            <Link href="/#contact" className="block py-2 hover:text-white sm:py-0">
              <T>{"Contact us"}</T></Link>
          </div>
          <div className="space-y-0 text-sm sm:space-y-2">
            <p className="pb-1 text-xs font-semibold text-white"><T>{"Account"}</T></p>
            {!viewer && (
              <Link href="/register" className="block py-2 hover:text-white sm:py-0">
                <T>{"Open an account"}</T></Link>
            )}
            <Link href="/portal" className="block py-2 hover:text-white sm:py-0">
              <T>{"My orders"}</T></Link>
            {viewer && (
              <Link href="/portal/quick-order" className="block py-2 hover:text-white sm:py-0">
                <T>{"Quick order"}</T></Link>
            )}
            <Link href="/login" className="block py-2 hover:text-white sm:py-0">
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
