"use client";

import { useEffect, useRef, useState } from "react";

export type SharingStatus = "off" | "starting" | "on" | "denied" | "unavailable" | "stopped";

export type Fix = { lat: number; lng: number; accuracy: number | null; speed: number | null; heading: number | null; ts: number };

const SEND_EVERY_MS = 10_000;
/** A new fix is only kept if the van moved this far, … */
const MIN_MOVE_M = 15;
/** … or this long has passed (so a parked van still shows as reporting), … */
const MAX_GAP_MS = 30_000;
/** … and fixes rougher than this are dropped while precise ones are coming in. */
const MAX_ACCURACY_M = 200;

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6_371_000;
}

/** Keeps the fixes that add something: movement, time, or a much better reading of the same spot. */
export function worthKeeping(f: Fix, prev: Fix | null) {
  if (!prev) return true;
  const gap = f.ts - prev.ts;
  if (f.accuracy !== null && f.accuracy > MAX_ACCURACY_M && gap < 60_000) return false;
  if (metres(prev, f) >= MIN_MOVE_M || gap >= MAX_GAP_MS) return true;
  return f.accuracy !== null && prev.accuracy !== null && f.accuracy < prev.accuracy / 2;
}
const PREF_KEY = "dp.shareLocation";

export function readSharePref() {
  // Also runs while the page renders on the server, where there is no storage (and newer Node
  // logs a warning for touching it): same default as before.
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeSharePref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    // Preference only; ignore storage failures.
  }
}

/**
 * Streams the phone's GPS position to the server while `active`. Fixes are
 * buffered and sent in batches so short signal drops don't lose the trail.
 * Browsers pause this when the page is in the background, so the driver page
 * also asks to keep the screen awake.
 */
export function useLocationSharing(active: boolean) {
  const [status, setStatus] = useState<SharingStatus>("off");
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const buffer = useRef<Fix[]>([]);

  useEffect(() => {
    if (!active) return;
    if (!("geolocation" in navigator)) {
      queueMicrotask(() => setStatus("unavailable"));
      return;
    }
    let stopped = false;
    let firstSent = false;
    let kept: Fix | null = null;
    queueMicrotask(() => setStatus("starting"));

    const flush = async (final = false) => {
      if (!buffer.current.length || (stopped && !final)) return;
      const points = buffer.current.splice(0, buffer.current.length);
      try {
        const res = await fetch("/api/driver/location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points }),
          keepalive: true,
        });
        if (res.status === 409 || res.status === 401) {
          stopped = true;
          setStatus("stopped");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        setLastSentAt(Date.now());
      } catch {
        // Offline: put the fixes back and retry on the next tick (cap memory use).
        buffer.current = [...points, ...buffer.current].slice(-500);
      }
    };

    const onFix = (pos: GeolocationPosition) => {
      const fix: Fix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
        speed: pos.coords.speed ?? null,
        heading: pos.coords.heading ?? null,
        ts: pos.timestamp,
      };
      setStatus((s) => (s === "stopped" ? s : "on"));
      if (!worthKeeping(fix, kept)) return;
      kept = fix;
      buffer.current.push(fix);
      // Send the first fix (and the first after coming back to the app) straight away, so
      // dispatch sees the driver immediately instead of at the next batch.
      if (!firstSent) {
        firstSent = true;
        void flush();
      }
    };
    const onError = (err: GeolocationPositionError) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
    const watchId = navigator.geolocation.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 });
    const timer = setInterval(flush, SEND_EVERY_MS);
    // Phones stop reporting while the app is in the background. Send what we have on the way out,
    // and on the way back ask for a fresh fix at once rather than waiting for the next one.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") return void flush();
      firstSent = false;
      kept = null;
      navigator.geolocation.getCurrentPosition(onFix, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Keep the screen on while sharing; a locked phone stops reporting location.
    let wakeLock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const lock = () => nav.wakeLock?.request("screen").then((l) => (wakeLock = l)).catch(() => {});
    lock();
    const relock = () => document.visibilityState === "visible" && lock();
    document.addEventListener("visibilitychange", relock);

    return () => {
      void flush(true);
      stopped = true;
      navigator.geolocation.clearWatch(watchId);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("visibilitychange", relock);
      void wakeLock?.release().catch(() => {});
      setStatus("off");
    };
  }, [active]);

  return { status: active ? status : "off", lastSentAt };
}

export type BestFix = { lat: number; lng: number; accuracy: number };

/**
 * Watches GPS at high accuracy while mounted and keeps the most precise fix. Used on the
 * Delivered / Problem sheet: by the time the photo and signature are done the phone has
 * usually settled to a few metres, and that fix is saved with the delivery as proof of place.
 */
export function useBestFix() {
  const [fix, setFix] = useState<BestFix | null>(null);
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        setFix((best) => (!best || next.accuracy <= best.accuracy ? next : best));
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return fix;
}
