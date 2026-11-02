import { StaffPageSkeleton } from "@/components/skeleton";

// Shown instantly while a staff page loads (pages without their own loading.tsx use this one).
export default function Loading() {
  return <StaffPageSkeleton />;
}
