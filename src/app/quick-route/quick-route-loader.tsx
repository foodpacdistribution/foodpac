"use client";

import dynamic from "next/dynamic";
import { MobileSkeleton } from "@/components/skeleton";

// The route in progress is restored from localStorage, so render in the browser only.
export const QuickRouteLoader = dynamic(() => import("./quick-route-client").then((m) => m.QuickRouteClient), {
  ssr: false,
  loading: () => <MobileSkeleton />,
});
