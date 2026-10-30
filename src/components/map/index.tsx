"use client";

import dynamic from "next/dynamic";
import type { MapProps } from "./types";

const loading = () => <div className="grid h-full w-full place-items-center bg-slate-100 text-sm text-slate-400">Loading map…</div>;

// With NEXT_PUBLIC_GOOGLE_MAPS_API_KEY set the app shows Google Maps; otherwise
// OpenStreetMap via Leaflet. Both touch `window`, so they only render in the browser.
const USE_GOOGLE = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MapInner = USE_GOOGLE
  ? dynamic(() => import("./google-map-inner"), { ssr: false, loading })
  : dynamic(() => import("./map-inner"), { ssr: false, loading });

export function DeliveryMap(props: MapProps) {
  return <MapInner {...props} />;
}

export type { MapDepot, MapRoute, MapStop, MapVehicle } from "./types";
