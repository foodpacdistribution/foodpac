import Image from "next/image";
import { cx } from "./ui";

/** Square Foodpac "F" mark, for tight spots (mobile bars, small avatars). */
export function BrandMark({ className }: { className?: string }) {
  return <Image src="/brand/foodpac-icon.png" alt="" width={512} height={512} className={cx("shrink-0 rounded-[22%]", className)} />;
}

/**
 * The Foodpac wordmark (orange script with green drop and leaf). Size it by height,
 * e.g. className="h-10". On dark backgrounds pass `badge` so the green details stay visible.
 */
export function Logo({ className, badge, priority }: { className?: string; badge?: boolean; priority?: boolean }) {
  const img = (
    <Image
      src="/brand/foodpac-logo.png"
      alt="Foodpac Distribution"
      width={712}
      height={255}
      priority={priority}
      className={cx("w-auto shrink-0 select-none", badge ? "h-full" : className)}
    />
  );
  return badge ? <span className={cx("inline-flex shrink-0 items-center rounded-xl bg-cream px-2.5 py-1.5", className)}>{img}</span> : img;
}
