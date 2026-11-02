// Getting an accurate position from the browser. A phone's first fix is often a rough Wi-Fi or
// cell-tower guess (50–1000 m); GPS then settles to a few metres. So we watch for a while, keep
// the most precise fresh fix, and stop as soon as it's good enough.

export type Fix = { lat: number; lng: number; accuracy: number; at: number };

/** Thrown when the position can't be read, so the page can offer another starting point. */
export class LocationError extends Error {}

/** Accuracy (metres) we treat as a precise fix. */
export const GOOD_FIX_M = 25;
/** Beyond this the start point needs checking on the map. */
export const ROUGH_FIX_M = 100;

export function locateBest({
  goodEnoughM = GOOD_FIX_M,
  maxWaitMs = 15_000,
  onProgress,
}: { goodEnoughM?: number; maxWaitMs?: number; onProgress?: (best: Fix) => void } = {}): Promise<Fix> {
  if (typeof window === "undefined" || !window.isSecureContext) {
    return Promise.reject(new LocationError("Browsers only share location with secure (https://) pages. Start from the depot or an address instead."));
  }
  if (!("geolocation" in navigator)) return Promise.reject(new LocationError("This browser can't share its location."));

  return new Promise((resolve, reject) => {
    let best: Fix | null = null;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
      fn();
    };

    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        // Never use a cached position from a minute or more ago: the driver may have moved.
        if (Date.now() - pos.timestamp > 60_000) return;
        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy), at: pos.timestamp };
        if (!best || fix.accuracy <= best.accuracy) {
          best = fix;
          onProgress?.(fix);
        }
        if (best.accuracy <= goodEnoughM) finish(() => resolve(best!));
      },
      (err) => {
        if (err.code === 1) {
          finish(() => reject(new LocationError("Location permission was denied. Allow location for this site in the browser's address bar, then try again.")));
        }
        // Other errors (timeout, no signal yet) are retried by the watch until the deadline.
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWaitMs },
    );

    const timer = setTimeout(() => {
      if (best) return finish(() => resolve(best!));
      // No GPS fix at all (e.g. a laptop): fall back to Wi-Fi positioning, but only a recent one.
      finish(() =>
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy), at: pos.timestamp }),
          (err) =>
            reject(
              new LocationError(
                err.code === 1
                  ? "Location permission was denied. Allow location for this site in the browser's address bar, then try again."
                  : "Your device couldn't work out where you are. Turn on Location (on a Mac: System Settings → Privacy & Security → Location Services), or start from the depot or an address.",
              ),
            ),
          { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
        ),
      );
    }, maxWaitMs);
  });
}

export function describeAccuracy(m: number) {
  return m < 1000 ? `±${m} m` : `±${(m / 1000).toFixed(1)} km`;
}
