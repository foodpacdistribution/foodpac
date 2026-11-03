// Single-driver "quick route": a start position plus a handful of addresses →
// the fastest visiting order with per-leg drive times. Matrix layout: node 0 is
// the start, nodes 1..n are the stops, and an optional extra node is where the
// route has to finish (a depot). Pure, so it runs in tests without a database.

import { evaluateRoute } from "./vrp/evaluate";
import { solve } from "./vrp/solver";
import type { Job, Matrix, Problem, Vehicle } from "./vrp/types";

/** Up to this many stops the order is solved exactly, so the result is the true optimum for the matrix. */
export const EXACT_LIMIT = 15;
export const MAX_QUICK_STOPS = 25;

export type QuickLeg = { stop: number; durationS: number; distanceM: number; arrivalS: number; departureS: number };

export type QuickPlan = {
  /** Visiting order as 0-based stop indices. */
  order: number[];
  legs: QuickLeg[];
  returnLeg: { durationS: number; distanceM: number } | null;
  driveS: number;
  distanceM: number;
  finishS: number;
  /** The same stops driven in the order they were entered, for the "time saved" figure. */
  entered: { driveS: number; distanceM: number; finishS: number };
  exact: boolean;
};

export type QuickPlanOptions = {
  stopCount: number;
  /** null = finish at the last stop; 0 = back to the start; n + 1 = the depot node. */
  endNode: number | null;
  startS: number;
  serviceS: number;
};

/**
 * Exact shortest visiting order (Held–Karp dynamic programming): for every set of visited stops
 * and every last stop, the quickest way to get there. 15 stops ≈ 7 million steps, well under a
 * second, and it's the true best order for the travel times given, not an approximation.
 * Nodes: 0 is the start, 1..n the stops; `endNode` is where the route must finish (null = anywhere).
 */
export function exactOrder(durations: number[][], n: number, endNode: number | null): number[] {
  if (n === 0) return [];
  const full = (1 << n) - 1;
  const cost = new Float64Array((full + 1) * n).fill(Infinity);
  const prev = new Int8Array((full + 1) * n).fill(-1);
  for (let j = 0; j < n; j++) cost[(1 << j) * n + j] = durations[0][j + 1];
  for (let mask = 1; mask <= full; mask++) {
    for (let j = 0; j < n; j++) {
      const here = cost[mask * n + j];
      if (here === Infinity || !(mask & (1 << j))) continue;
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue;
        const next = mask | (1 << k);
        const c = here + durations[j + 1][k + 1];
        if (c < cost[next * n + k]) {
          cost[next * n + k] = c;
          prev[next * n + k] = j;
        }
      }
    }
  }
  let last = 0;
  let best = Infinity;
  for (let j = 0; j < n; j++) {
    const c = cost[full * n + j] + (endNode !== null ? durations[j + 1][endNode] : 0);
    if (c < best) {
      best = c;
      last = j;
    }
  }
  const order: number[] = [];
  for (let mask = full, j = last; j !== -1; ) {
    order.push(j);
    const p = prev[mask * n + j];
    mask &= ~(1 << j);
    j = p;
  }
  return order.reverse();
}

export function planSingleRoute(matrix: Matrix, opts: QuickPlanOptions): QuickPlan {
  const n = opts.stopCount;
  const vehicle: Vehicle = {
    id: "me",
    startNode: 0,
    endNode: opts.endNode,
    startTime: opts.startS,
    maxDuration: 7 * 86400,
    capacity: null,
  };
  const jobs: Job[] = Array.from({ length: n }, (_, i) => ({
    id: String(i),
    node: i + 1,
    service: opts.serviceS,
    twStart: null,
    twEnd: null,
    demand: 0,
    priority: 0,
  }));
  const problem: Problem = { vehicles: [vehicle], jobs, matrix, objective: "time" };

  const exact = n <= EXACT_LIMIT;
  const order = exact
    ? exactOrder(matrix.durations, n, opts.endNode)
    : solve(problem, { timeLimitMs: Math.min(5000, 500 + n * 100) }).routes[0].jobIds.map(Number);

  const best = evaluateRoute(problem, vehicle, order);
  const entered = evaluateRoute(problem, vehicle, jobs.map((_, i) => i));
  return {
    order,
    legs: best.stops.map((s) => ({
      stop: Number(s.jobId),
      durationS: s.legDuration,
      distanceM: s.legDistance,
      arrivalS: s.arrival,
      departureS: s.departure,
    })),
    returnLeg: opts.endNode !== null && n > 0 ? { durationS: best.returnDuration, distanceM: best.returnDistance } : null,
    driveS: best.driveTime,
    distanceM: best.distance,
    finishS: best.end,
    entered: { driveS: entered.driveTime, distanceM: entered.distance, finishS: entered.end },
    exact,
  };
}

/**
 * Turns pasted text into one address per line. Drivers paste from notes, chats and
 * spreadsheets, so list markers ("1.", "2)", "-", "•") are dropped, spreadsheet cells
 * (tabs) are joined with commas, and repeated addresses are kept once.
 */
export function parseAddressList(text: string): { addresses: string[]; duplicates: number } {
  const seen = new Set<string>();
  const addresses: string[] = [];
  let duplicates = 0;
  for (const line of text.split(/\r?\n/)) {
    const address = line
      .split("\t")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(", ")
      .replace(/^(\d{1,2}[.)]|[-*•·])\s+/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!address) continue;
    const key = address.toLowerCase().replace(/[\s,]+/g, " ");
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    addresses.push(address);
  }
  return { addresses, duplicates };
}

export type TimedStop ={ legDurationS: number; arrivalS: number; departureS: number };

/**
 * Re-times the stops still to do from when the driver actually left the last
 * one (`leftS`), keeping each leg's drive time and each stop's service time.
 * The next stop can't be reached before `nowS`, so a driver who is behind sees
 * every later ETA move too instead of a plan that is already out of date.
 */
export function projectRemaining(stops: TimedStop[], leftS: number, nowS: number): { arrivalS: number; departureS: number }[] {
  let t = leftS;
  return stops.map((s, i) => {
    const arrivalS = Math.max(t + s.legDurationS, i === 0 ? nowS : 0);
    const departureS = arrivalS + (s.departureS - s.arrivalS);
    t = departureS;
    return { arrivalS, departureS };
  });
}
