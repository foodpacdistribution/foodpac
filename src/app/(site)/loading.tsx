import { PageSkeleton } from "@/components/shop-skeleton";

// Shown at once while a shop page loads, so a click always gets an immediate response.
export default function Loading() {
  return <PageSkeleton wide />;
}
