"use client";

import { X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useT } from "@/components/i18n";

/**
 * A product opened from a list, over the list: rises from the bottom on a phone, a centred
 * window on a computer. Closing (✕, the backdrop, Escape, or Back) returns to the list exactly
 * where it was. The page behind doesn't scroll while it's open.
 */
export function ProductSheet({ children, title }: { children: React.ReactNode; title: string }) {
  const tr = useT();
  const router = useRouter();
  // Going to another page leaves this slot as it was; it only shows on a product's address.
  const open = usePathname().startsWith("/products/");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && router.back();
    window.addEventListener("keydown", onKey);
    const html = document.documentElement;
    const was = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = was;
    };
  }, [router, open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={tr(title)}>
      <button type="button" aria-label={tr("Close")} onClick={() => router.back()} className="sheet-backdrop absolute inset-0 cursor-default bg-leaf-950/45 backdrop-blur-[2px]" />
      <div className="sheet-panel relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-cream text-leaf-950 shadow-[0_-12px_40px_-12px_rgb(11_42_28/0.45)] sm:max-w-3xl sm:rounded-2xl">
        {/* The grab handle a phone user expects on a sheet. */}
        <span aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-leaf-950/20 sm:hidden" />
        <button
          type="button"
          onClick={() => router.back()}
          aria-label={tr("Close")}
          className="absolute top-3 right-3 z-10 grid size-10 place-items-center rounded-full bg-white/90 text-leaf-950 shadow-sm ring-1 ring-leaf-950/10 transition-transform active:scale-90"
        >
          <X className="size-5" />
        </button>
        <div className="overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">{children}</div>
      </div>
    </div>
  );
}
