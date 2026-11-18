import { ViewTransition } from "react";
import { getDb } from "@/lib/db";
import { listCategories } from "@/lib/shop";
import { categoryHref } from "../content";
import { CategorySidebar } from "../category-nav";
import { T } from "@/components/i18n";

/**
 * All products and each category share this frame: the category menu stays where it is while
 * the products beside it change, so picking a category feels like switching a tab, not a page.
 * Only the list crossfades (its own view transition, so the page-wide one doesn't run).
 */
export default async function CatalogLayout({ children }: { children: React.ReactNode }) {
  const categories = await listCategories(await getDb());
  const total = categories.reduce((t, c) => t + c.n, 0);
  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-5 sm:px-6 sm:py-8 lg:grid-cols-[220px_1fr] lg:gap-8">
      {/* Phones have the categories in the header's row already, so the list starts right away. */}
      <aside className="min-w-0 max-lg:hidden">
        <p className="text-sm font-semibold max-lg:sr-only">
          <T>{"Categories"}</T>
        </p>
        <nav aria-label="Categories">
          <CategorySidebar
            items={[
              { href: "/products", label: "All products", n: total },
              ...categories.map((c) => ({ href: categoryHref(c.name), label: c.name, n: c.n, icon: true })),
            ]}
          />
        </nav>
      </aside>
      <ViewTransition update={{ nav: "list-nav", default: "none" }} default="none">
        <section className="min-w-0">{children}</section>
      </ViewTransition>
    </main>
  );
}
