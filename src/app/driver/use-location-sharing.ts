"use client";

import { useEffect, useRef, useState } from "react";

export type SharingStatus = "off" | "starting" | "on" | "denied" | "unavailable" | "stopped";

type Fix = { lat: number; lng: number; accuracy: number | null; speed: number | null; heading: number | null; ts: number };

const SEND_EVERY_MS = 20_000;
const PREF_KEY = "dp.shareLocation";

export function readSharePref() {
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

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        buffer.current.push({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
          speed: pos.coords.speed ?? null,
          heading: pos.coords.heading ?? null,
          ts: pos.timestamp,
        });
        setStatus((s) => (s === "stopped" ? s : "on"));
        // Send the first fix straight away so dispatch sees the driver immediately.
        if (!firstSent) {
          firstSent = true;
          void flush();
        }
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    const timer = setInterval(flush, SEND_EVERY_MS);
    const onHide = () => document.visibilityState === "hidden" && void flush();
    document.addEventListener("visibilitychange", onHide);

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
      document.removeEventListener("visibilitychange", onHide);
      document.removeEventListener("visibilitychange", relock);
      void wakeLock?.release().catch(() => {});
      setStatus("off");
    };
  }, [active]);

  return { status: active ? status : "off", lastSentAt };
}
