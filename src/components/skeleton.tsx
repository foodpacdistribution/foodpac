import { cx } from "./ui";

// Loading placeholders shown while a page's data is fetched. Each mirrors the real
// page's grid, so the content drops into place instead of jumping around.

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-md bg-slate-200/70", className)} />;
}

/** Screen readers hear "Loading…" once instead of a pile of empty boxes. */
function Loading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

function HeaderSkeleton({ actions = 1 }: { actions?: number }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-72 max-w-[70vw]" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: actions }, (_, i) => (
          <Skeleton key={i} className={cx("h-9", i === 0 ? "w-40" : "w-24")} />
        ))}
      </div>
    </div>
  );
}

function CardSkeleton({ className, rows = 0 }: { className?: string; rows?: number }) {
  return (
    <div className={cx("rounded-xl border border-line bg-white shadow-card", className)}>
      <div className="border-b border-line px-4 py-3">
        <Skeleton className="h-4 w-32" />
      </div>
      {rows > 0 && (
        <div className="space-y-3 p-4">
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className={cx("h-4", i % 3 === 2 ? "w-2/3" : "w-full")} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Dashboard-shaped: header, stat tiles, a large panel and a side column. Used by most staff pages. */
export function StaffPageSkeleton() {
  return (
    <Loading>
      <HeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[120px] rounded-xl border border-line bg-white p-4 shadow-card">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-5 h-7 w-12" />
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
          <div className="border-b border-line px-4 py-3">
            <Skeleton className="h-4 w-36" />
          </div>
          <Skeleton className="h-[420px] rounded-none" />
        </div>
        <div className="space-y-4">
          <CardSkeleton rows={4} />
          <CardSkeleton rows={3} />
        </div>
      </div>
    </Loading>
  );
}

export function OrdersSkeleton() {
  return (
    <Loading>
      <HeaderSkeleton actions={3} />
      <div className="rounded-xl border border-line bg-white shadow-card">
        <div className="flex items-center gap-2 border-b border-line px-3 py-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-20" />
          ))}
          <Skeleton className="ml-auto hidden h-9 w-64 md:block" />
        </div>
        <div className="divide-y divide-line">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <Skeleton className="size-4" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="hidden h-4 flex-1 md:block" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}

export function ImportSkeleton() {
  return (
    <Loading>
      <HeaderSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton className="h-72" />
        <CardSkeleton className="h-72" />
      </div>
    </Loading>
  );
}

export function PlannerSkeleton() {
  return (
    <Loading>
      <HeaderSkeleton actions={2} />
      <div className="grid gap-4 xl:grid-cols-[18.5rem_minmax(0,1fr)_25rem]">
        <div className="space-y-4">
          <CardSkeleton rows={2} />
          <CardSkeleton rows={6} />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-9 w-52" />
          <Skeleton className="h-[460px] rounded-xl xl:h-[calc(100dvh-11rem)] xl:min-h-[560px]" />
        </div>
        <div className="space-y-4">
          <CardSkeleton rows={4} />
          <CardSkeleton rows={2} />
          <CardSkeleton rows={2} />
        </div>
      </div>
    </Loading>
  );
}

/** The phone layouts (driver page, quick route): dark header with cards overlapping it. */
export function MobileSkeleton() {
  return (
    <Loading className="min-h-dvh pb-10">
      <div className="bg-navy-900 px-4 pb-16 pt-5">
        <div className="mx-auto max-w-lg space-y-2">
          <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
          <div className="h-6 w-48 animate-pulse rounded bg-white/15" />
        </div>
      </div>
      <div className="mx-auto -mt-12 max-w-lg space-y-4 px-4">
        <div className="space-y-4 rounded-2xl bg-white p-4 shadow-card">
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="mx-auto h-10 w-12" />
            ))}
          </div>
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-card">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
          </div>
        </div>
      </div>
    </Loading>
  );
}
