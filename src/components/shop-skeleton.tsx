import { cx } from "./ui";

// Loading placeholders for the shop and customer account, in the shop's colours. Each one
// mirrors the real page's layout so content drops into place instead of jumping.

export function Bone({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-xl bg-leaf-950/[0.07]", className)} />;
}

function Status({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

/** `catalog` matches the product grid (two across on phones); otherwise one across on phones. */
export function CardBones({ count = 6, className, catalog }: { count?: number; className?: string; catalog?: boolean }) {
  return (
    <div className={cx("grid", catalog ? "grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3" : "gap-4 sm:grid-cols-2 xl:grid-cols-3", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-leaf-950/10 bg-white">
          <Bone className="aspect-[4/3] rounded-none" />
          <div className="space-y-2 p-4">
            <Bone className="h-3 w-16" />
            <Bone className="h-4 w-3/4" />
            <Bone className="h-3 w-1/2" />
            <Bone className="mt-4 h-9 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CatalogSkeleton() {
  return (
    <Status className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[220px_1fr]">
      <div className="space-y-2">
        <Bone className="h-3 w-24" />
        {Array.from({ length: 7 }, (_, i) => (
          <Bone key={i} className="h-9 w-full max-lg:hidden" />
        ))}
      </div>
      <CatalogListSkeleton bare />
    </Status>
  );
}

/** The product list beside the category menu, for switching category: the menu stays put. */
export function CatalogListSkeleton({ bare }: { bare?: boolean }) {
  const body = (
    <>
      <Bone className="h-3 w-40" />
      <Bone className="mt-2.5 h-8 w-56 max-w-full" />
      <Bone className="mt-5 h-4 w-32" />
      <div className="mt-4 flex gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Bone key={i} className="h-8 w-20 rounded-md" />
        ))}
      </div>
      <CardBones catalog className="mt-5" />
    </>
  );
  return bare ? <div>{body}</div> : <Status>{body}</Status>;
}

export function ProductSkeleton() {
  return (
    <Status className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Bone className="h-4 w-32" />
      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <Bone className="aspect-square rounded-3xl" />
        <div className="space-y-3">
          <Bone className="h-3 w-24" />
          <Bone className="h-9 w-4/5" />
          <Bone className="h-16 w-full" />
          <Bone className="h-12 w-72 rounded-full" />
          <div className="grid grid-cols-2 gap-3 pt-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Bone key={i} className="h-16" />
            ))}
          </div>
        </div>
      </div>
    </Status>
  );
}

export function PageSkeleton({ wide, bare }: { wide?: boolean; bare?: boolean }) {
  return (
    <Status className={bare ? undefined : cx("mx-auto px-4 py-8 sm:px-6", wide ? "max-w-6xl" : "max-w-5xl")}>
      <Bone className="h-8 w-56" />
      <Bone className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Bone key={i} className="h-24" />
        ))}
      </div>
      <Bone className="mt-6 h-64 w-full" />
    </Status>
  );
}
