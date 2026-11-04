import { eq, sql } from "drizzle-orm";
import { Clock, Mail, Phone, ShoppingCart, Truck, UserRound } from "lucide-react";
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
import { CATEGORIES, categoryHref, SITE } from "./content";
import { BackToTop } from "./back-to-top";
import { CartBadge } from "./cart-badge";
import { DeliveryPromiseText, FreeDeliveryText } from "./delivery-promise";
import { CategoryNav } from "./category-nav";
import { NavProgress } from "./nav-progress";
import { SearchBox } from "./search-box";
import { T } from "@/components/i18n";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const db = await getDb();
  const [user, viewer, settings] = await Promise.all([getCurrentUser(), getCurrentCustomer(), getSettings(db)]);
  const promise = deliveryPromise(settings);
  const [{ n: cartCount }] = viewer
    ? await db
        .select({ n: sql<number>`coalesce(sum(${cartItems.qty}), 0)::int` })
        .from(cartItems)
        .where(eq(cartItems.customerId, viewer.customer.id))
    : [{ n: 0 }];

  return (
    // A column the height of the window: on short pages the content grows and the footer sits at the bottom.
    <div className="flex min-h-dvh flex-col bg-cream text-leaf-950">
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
              <T>{SITE.hours}</T>
            </p>
          </div>
        </div>
      )}
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
        <nav className="border-t border-leaf-950/5" aria-label="Categories">
          <CategoryNav
            items={[
              { href: "/products", label: "All products" },
              ...CATEGORIES.map((c) => ({ href: categoryHref(c.title), label: c.title })),
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
            <Logo badge className="h-12" />
            <p className="mt-3 font-display font-semibold text-white">{SITE.name}</p>
            <p className="mt-1 text-xs">
              <T>{SITE.tagline}</T> <T>{"Serving"}</T> <T>{SITE.serviceArea}</T>.
            </p>
            <ul className="mt-4 space-y-1.5 text-xs">
              <li className="flex items-center gap-2">
                <Clock className="size-3.5 text-tomato" /> <T>{SITE.hours}</T>
              </li>
              {SITE.phone && (
                <li>
                  <a href={`tel:${SITE.phone.replace(/\s/g, "")}`} className="flex items-center gap-2 hover:text-white">
                    <Phone className="size-3.5 text-tomato" /> {SITE.phone}
                  </a>
                </li>
              )}
              {SITE.email && (
                <li>
                  <a href={`mailto:${SITE.email}`} className="flex items-center gap-2 hover:text-white">
                    <Mail className="size-3.5 text-tomato" /> {SITE.email}
                  </a>
                </li>
              )}
            </ul>
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-white"><T>{"Categories"}</T></p>
            {CATEGORIES.map((c) => (
              <Link key={c.title} href={categoryHref(c.title)} className="block hover:text-white">
                <T>{c.title}</T>
              </Link>
            ))}
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-white"><T>{"Shop"}</T></p>
            <Link href="/products" className="block hover:text-white">
              <T>{"All products"}</T></Link>
            <Link href="/#how-it-works" className="block hover:text-white">
              <T>{"How it works"}</T></Link>
            <Link href="/#delivery" className="block hover:text-white">
              <T>{"Delivery"}</T></Link>
            <Link href="/#contact" className="block hover:text-white">
              <T>{"Contact us"}</T></Link>
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-white"><T>{"Account"}</T></p>
            {!viewer && (
              <Link href="/register" className="block hover:text-white">
                <T>{"Open an account"}</T></Link>
            )}
            <Link href="/portal" className="block hover:text-white">
              <T>{"My orders"}</T></Link>
            {viewer && (
              <Link href="/portal/quick-order" className="block hover:text-white">
                <T>{"Quick order"}</T></Link>
            )}
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
