"use client";

import { useEffect, useRef, useState } from "react";

/** Further than this (in degrees, ~3 km) the marker jumps instead of sliding across the map. */
const MAX_GLIDE_DEG = 0.03;

/**
 * A driver's marker position that slides to each new GPS fix instead of jumping, so the van
 * looks like it is moving along the road between the live updates.
 */
export function useGlide(lat: number, lng: number, ms = 1500) {
  const [pos, setPos] = useState({ lat, lng });
  const shown = useRef({ lat, lng });
  useEffect(() => {
    const from = { ...shown.current };
    const far = Math.hypot(lat - from.lat, lng - from.lng) > MAX_GLIDE_DEG;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = far ? 1 : Math.min(1, (t - start) / ms);
      const e = 1 - (1 - k) ** 3; // ease out
      const p = { lat: from.lat + (lat - from.lat) * e, lng: from.lng + (lng - from.lng) * e };
      shown.current = p;
      setPos(p);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [lat, lng, ms]);
  return pos;
}

/** A coarse fix (worse than this) gets an accuracy circle so nobody trusts the exact spot. */
export const SHOW_ACCURACY_ABOVE_M = 30;

/** The route's driven part (grey) and the part still to drive (route colour). */
export function splitPath(path: [number, number][], doneUpTo: number | undefined) {
  if (doneUpTo === undefined || doneUpTo <= 0) return { done: [] as [number, number][], todo: path };
  const i = Math.min(doneUpTo, path.length - 1);
  return { done: path.slice(0, i + 1), todo: path.slice(i) };
}
