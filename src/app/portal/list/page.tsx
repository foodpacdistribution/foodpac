import { Download, Heart } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { canSeePrices, listFavourites } from "@/lib/shop";
import { T } from "@/components/i18n";
import { MyList } from "./my-list";

export const metadata: Metadata = { title: "My list" };

export default async function MyListPage() {
  const viewer = await getCurrentCustomer();
  if (!viewer) return null;
  const items = await listFavourites(await getDb(), viewer.customer);
  const priced = canSeePrices(viewer.customer);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            <T>{"My list"}</T>
          </h1>
          <p className="mt-1 text-sm text-leaf-900/60">
            <T>{"The products you order again and again. Set the quantities and add them to your cart in one go."}</T>
          </p>
        </div>
        {priced && (
          <a href="/portal/price-list" className="inline-flex h-10 items-center gap-2 rounded-full border border-leaf-950/15 bg-white px-4 text-sm font-semibold hover:border-leaf-700/40">
            <Download className="size-4" /> <T>{"Download my price list"}</T>
          </a>
        )}
      </div>
      {items.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-leaf-950/15 bg-white px-6 py-14 text-center">
          <Heart className="mx-auto size-10 text-tomato/70" />
          <p className="mt-3 font-semibold">
            <T>{"Nothing on your list yet"}</T>
          </p>
          <p className="mt-1 text-sm text-leaf-900/60">
            <T>{"Tap the heart on any product to keep it here."}</T>
          </p>
          <Link href="/products" className="mt-4 inline-flex h-10 items-center rounded-full bg-leaf-700 px-5 text-sm font-semibold text-white hover:bg-leaf-800">
            <T>{"Browse products"}</T>
          </Link>
        </div>
      ) : (
        <MyList items={items} priced={priced} />
      )}
    </>
  );
}
