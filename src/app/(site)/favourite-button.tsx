"use client";

import { Heart } from "lucide-react";
import { useState, useTransition } from "react";
import { setFavourite } from "@/app/actions/shop";
import { Toast, type ToastMessage } from "@/components/client-ui";
import Link from "@/components/link";
import { cx } from "@/components/ui";
import { useT } from "@/components/i18n";

/**
 * Heart that keeps a product on the customer's own list ("My list"). Fills straight away and
 * puts it back if saving fails. Signed out, it leads to sign-in and back to the product.
 */
export function FavouriteButton({
  productId,
  sku,
  favourite,
  signedIn,
  variant = "icon",
  className,
}: {
  productId: string;
  sku: string;
  favourite: boolean;
  signedIn: boolean;
  variant?: "icon" | "pill";
  className?: string;
}) {
  const tr = useT();
  const [on, setOn] = useState(favourite);
  // A fresh answer from the server (e.g. after navigating back) wins over the local state.
  const [seen, setSeen] = useState(favourite);
  if (seen !== favourite) {
    setSeen(favourite);
    setOn(favourite);
  }
  const [pop, setPop] = useState(0);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [, start] = useTransition();
  const label = tr(on ? "Remove from My list" : "Save to My list");

  const look =
    variant === "icon"
      ? "grid size-9 place-items-center rounded-full bg-white/90 shadow-sm ring-1 ring-leaf-950/10 backdrop-blur hover:bg-white"
      : "inline-flex h-11 items-center gap-2 rounded-full border border-leaf-950/15 bg-white px-4 text-sm font-semibold hover:border-leaf-700/40";
  const heart = (
    <Heart
      key={pop}
      className={cx("size-[18px] transition-colors", on ? "fill-tomato text-tomato" : "text-leaf-900/60", pop > 0 && on && "animate-bump")}
      strokeWidth={2}
    />
  );

  if (!signedIn) {
    return (
      <Link href={`/login?next=${encodeURIComponent(`/products/${sku}`)}`} aria-label={tr("Sign in to save products")} title={tr("Sign in to save products")} className={cx(look, "transition-[scale] active:scale-90", className)}>
        {heart}
        {variant === "pill" && tr("Save to My list")}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-pressed={on}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const next = !on;
          setOn(next);
          setPop((p) => p + 1);
          start(async () => {
            const r = await setFavourite(productId, next);
            if (!r.ok) {
              setOn(!next);
              setToast({ id: Date.now(), text: r.error, tone: "warn" });
            }
          });
        }}
        className={cx(look, "cursor-pointer transition-[scale] active:scale-90", className)}
      >
        {heart}
        {variant === "pill" && tr(on ? "Saved to My list" : "Save to My list")}
      </button>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}
