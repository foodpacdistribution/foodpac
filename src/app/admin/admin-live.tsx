"use client";

import { usePathname } from "next/navigation";
import { LiveRefresh } from "@/components/live-refresh";

/** Live updates for every back-office page; Live Tracking also follows GPS so vans move on the map. */
export function AdminLive() {
  const tracking = usePathname().startsWith("/admin/tracking");
  return <LiveRefresh scope={tracking ? "tracking" : "admin"} intervalMs={tracking ? 10_000 : 12_000} notify="staff" />;
}
