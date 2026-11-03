// Learns how long deliveries really take from drivers' "Delivered" taps. Between two taps in a
// row the driver drove one leg and unloaded once, so across many legs
//   time between taps ≈ trafficFactor × free-flow road time + unloading time per stop.
// A least-squares fit gives both numbers; legs far off the line (a lunch break, taps made
// all at once at the end of the day) are dropped and the line is fitted again.

/** One leg between consecutive taps: free-flow road time and the actual time between taps (seconds). */
export type Leg = { driveS: number; gapS: number };

export type Timing = {
  /** Multiplier on free-flow road times (1.2 = driving takes 20% longer). */
  trafficFactor: number;
  /** Unloading minutes per stop. */
  serviceMin: number;
  /** Legs the numbers are based on. */
  legs: number;
};

export const MIN_LEGS = 20;
const FACTOR = { min: 1, max: 2 };
const SERVICE_S = { min: 60, max: 45 * 60 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Least squares gap = a·drive + b, with `a` kept inside FACTOR (b is then the best fit for that a). */
function fit(legs: Leg[]) {
  const n = legs.length;
  const mx = legs.reduce((s, l) => s + l.driveS, 0) / n;
  const my = legs.reduce((s, l) => s + l.gapS, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const l of legs) {
    sxx += (l.driveS - mx) ** 2;
    sxy += (l.driveS - mx) * (l.gapS - my);
  }
  // All legs about the same length: the slope can't be told apart from the intercept.
  const a = clamp(sxx > 0 ? sxy / sxx : 1, FACTOR.min, FACTOR.max);
  return { a, b: my - a * mx };
}

function median(xs: number[]) {
  const s = [...xs].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function fitTiming(input: Leg[]): Timing | null {
  // Under a minute between taps means tapping through stops; over 3 hours isn't one leg.
  let legs = input.filter((l) => l.driveS >= 0 && l.gapS >= 60 && l.gapS <= 3 * 3600);
  if (legs.length < MIN_LEGS) return null;

  let { a, b } = fit(legs);
  const residuals = legs.map((l) => l.gapS - (a * l.driveS + b));
  const mad = median(residuals.map((r) => Math.abs(r - median(residuals))));
  if (mad > 0) {
    const kept = legs.filter((_, i) => Math.abs(residuals[i]) <= 3 * 1.4826 * mad);
    if (kept.length >= MIN_LEGS) {
      legs = kept;
      ({ a, b } = fit(legs));
    }
  }
  return {
    trafficFactor: Math.round(a * 100) / 100,
    serviceMin: Math.round(clamp(b, SERVICE_S.min, SERVICE_S.max) / 60),
    legs: legs.length,
  };
}
