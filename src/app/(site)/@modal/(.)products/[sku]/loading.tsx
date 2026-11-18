/** While the product loads: its shape, in the open sheet. */
export default function Loading() {
  const bone = "animate-pulse rounded-md bg-leaf-950/8";
  return (
    <div role="status" aria-busy="true" className="grid gap-5 p-4 pt-3 sm:grid-cols-[1fr_1.1fr] sm:gap-6 sm:p-6">
      <div className={`${bone} aspect-[5/2] sm:aspect-square`} />
      <div className="space-y-3">
        <div className={`${bone} h-3 w-24`} />
        <div className={`${bone} h-8 w-4/5`} />
        <div className={`${bone} h-4 w-1/2`} />
        <div className={`${bone} h-14 w-full`} />
        <div className={`${bone} h-12 w-full`} />
      </div>
    </div>
  );
}
