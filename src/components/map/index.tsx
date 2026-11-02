"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import type { MapProps } from "./types";

const loading = () => <div className="grid h-full w-full animate-pulse place-items-center bg-slate-100 text-sm text-slate-400">Loading map…</div>;

// With NEXT_PUBLIC_GOOGLE_MAPS_API_KEY set the app shows Google Maps; otherwise
// OpenStreetMap via Leaflet. Both touch `window`, so they only render in the browser.
const USE_GOOGLE = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const GoogleInner = dynamic(() => import("./google-map-inner"), { ssr: false, loading });
const LeafletInner = dynamic(() => import("./map-inner"), { ssr: false, loading });

// A rejected key (billing off, API not enabled, wrong referrer, …) makes Google cover
// the map with an error dialog. Switch to OpenStreetMap instead, and remember it for
// this tab so later pages skip Google. Google reports key problems through the global
// gm_authFailure hook, but some (e.g. BillingNotEnabledMapError) only as a console error.
const FAILED_KEY = "map:google-failed";
let googleFailed = false;
const listeners = new Set<() => void>();
if (typeof window !== "undefined" && USE_GOOGLE) {
  try {
    googleFailed = sessionStorage.getItem(FAILED_KEY) === "1";
  } catch {
    // Storage blocked: Google is retried on each page load.
  }
  const fail = (reason: string) => {
    if (googleFailed) return;
    console.warn(`Google Maps can't be used (${reason}); showing OpenStreetMap instead.`);
    googleFailed = true;
    try {
      sessionStorage.setItem(FAILED_KEY, "1");
    } catch {}
    listeners.forEach((l) => l());
  };
  (window as unknown as { gm_authFailure: () => void }).gm_authFailure = () => fail("authentication failed");
  const consoleError = console.error;
  console.error = (...args: unknown[]) => {
    const code = typeof args[0] === "string" && /Google Maps JavaScript API error: (\w+)/.exec(args[0])?.[1];
    if (code) fail(code);
    consoleError(...args);
  };
}
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function DeliveryMap(props: MapProps) {
  const failed = useSyncExternalStore(subscribe, () => googleFailed, () => false);
  const MapInner = USE_GOOGLE && !failed ? GoogleInner : LeafletInner;
  return <MapInner {...props} />;
}

export type { MapDepot, MapRoute, MapStop, MapVehicle } from "./types";
