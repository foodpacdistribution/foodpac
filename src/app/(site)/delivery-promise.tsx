"use client";

import { useLocale, useT } from "@/components/i18n";
import type { DeliveryPromise } from "@/lib/shop";

/** "2pm" / "2:30pm" in English, "14:00" in Chinese. */
function clock(min: number, zh: boolean) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (zh) return `${h}:${String(m).padStart(2, "0")}`;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h >= 12 ? "pm" : "am"}`;
}

/** "Thu 6 Nov" (the translator turns it into "11月6日 周四"). */
const shortDay = (date: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`)).replace(",", "");

/** "Order by 2pm for delivery tomorrow" / "Order now for delivery Mon 9 Nov". */
export function DeliveryPromiseText({ promise: p }: { promise: DeliveryPromise }) {
  const tr = useT();
  const zh = useLocale() === "zh";
  const day = p.tomorrow ? tr("tomorrow") : tr(shortDay(p.day));
  return p.beforeCutoff ? tr("Order by {time} for delivery {day}", { time: clock(p.cutoffMin, zh), day }) : tr("Order now for delivery {day}", { day });
}

/** "Free delivery over $300", "Free delivery on every order", or nothing. */
export function FreeDeliveryText({ promise: p }: { promise: DeliveryPromise }) {
  const tr = useT();
  if (p.deliveryFeeCents <= 0) return tr("Free delivery on every order");
  if (p.freeDeliveryOverCents <= 0) return null;
  const amount = `$${(p.freeDeliveryOverCents / 100).toLocaleString("en-AU", { maximumFractionDigits: 2 })}`;
  return tr("Free delivery on orders over {amount}", { amount });
}
