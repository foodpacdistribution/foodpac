import { CatalogListSkeleton } from "@/components/shop-skeleton";

// Switching category: only the products change, so only they show a placeholder.
export default function Loading() {
  return <CatalogListSkeleton />;
}
