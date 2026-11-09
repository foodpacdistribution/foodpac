import type { Metadata } from "next";
import Link from "@/components/link";
import { Logo } from "@/components/brand";
import { T } from "@/components/i18n";

// One clear title (the default 404 page added a second <title> after the home page's), and a way
// back into the shop. Next.js marks 404 responses noindex by itself.
export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-cream px-4 py-16 text-leaf-950">
      <div className="max-w-md text-center">
        <Link href="/" aria-label="Foodpac Distribution home" className="inline-block">
          <Logo className="mx-auto h-12" />
        </Link>
        <p className="mt-10 text-sm font-semibold tracking-wide text-tomato">404</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">
          <T>{"We couldn't find that page"}</T>
        </h1>
        <p className="mt-3 text-leaf-900/70">
          <T>{"The link may be old or mistyped. Everything we stock is in the shop."}</T>
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/products" className="inline-flex h-11 items-center rounded-md bg-tomato px-5 text-sm font-semibold text-white hover:bg-tomato-dark">
            <T>{"Shop all products"}</T>
          </Link>
          <Link href="/" className="inline-flex h-11 items-center rounded-md px-5 text-sm font-semibold ring-1 ring-leaf-950/20 ring-inset hover:bg-white">
            <T>{"Home page"}</T>
          </Link>
          <Link href="/#contact" className="inline-flex h-11 items-center rounded-md px-5 text-sm font-semibold ring-1 ring-leaf-950/20 ring-inset hover:bg-white">
            <T>{"Contact us"}</T>
          </Link>
        </div>
      </div>
    </main>
  );
}
