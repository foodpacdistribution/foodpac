// Single-driver "quick route": a start position plus a handful of addresses →
// the fastest visiting order with per-leg drive times. Matrix layout: node 0 is
// the start, nodes 1..n are the stops, and an optional extra node is where the
// route has to finish (a depot). Pure, so it runs in tests without a database.

import { evaluateRoute } from "./vrp/evaluate";
import { solve } from "./vrp/solver";
import type { Job, Matrix, Problem, Vehicle } from "./vrp/types";

/** Up to this many stops every visiting order is checked, so the result is the true optimum for the matrix. */
export const EXACT_LIMIT = 9;
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

/** Depth-first search over all orders, pruning any partial route already slower than the best found. */
function exactOrder(durations: number[][], n: number, endNode: number | null) {
  let best = Infinity;
  let bestSeq: number[] = [];
  const seq: number[] = [];
  const used = new Array<boolean>(n + 1).fill(false);
  const visit = (node: number, cost: number) => {
    if (cost >= best) return;
    if (seq.length === n) {
      const total = cost + (endNode !== null ? durations[node][endNode] : 0);
      if (total < best) {
        best = total;
        bestSeq = [...seq];
      }
      return;
    }
    for (let s = 1; s <= n; s++) {
      if (used[s]) continue;
      used[s] = true;
      seq.push(s);
      visit(s, cost + durations[node][s]);
      seq.pop();
      used[s] = false;
    }
  };
  visit(0, 0);
  return bestSeq.map((node) => node - 1);
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

export type TimedStop = { legDurationS: number; arrivalS: number; departureS: number };

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
