"use client";

import dynamic from "next/dynamic";

// The route in progress is restored from localStorage, so render in the browser only.
export const QuickRouteLoader = dynamic(() => import("./quick-route-client").then((m) => m.QuickRouteClient), {
  ssr: false,
  loading: () => <div className="min-h-dvh bg-navy-900" />,
});
