import { evaluateRoute, isFeasible, vehicleAllowed } from "./evaluate";
import type { Problem, RouteEval, UnassignedReason } from "./types";

type Eval = RouteEval & { cost: number };

/**
 * Adds jobs to routes that are already planned without re-ordering what's there: each job goes
 * into the gap where it adds the least time, and the stops already on a route keep their order.
 * For orders that come in after the day was planned (and maybe sent to the drivers): the drivers'
 * lists only grow, they don't get shuffled.
 *
 * A job is only added where it doesn't make the route break a rule it kept before (a delivery
 * window, the van's capacity, the driver's shift). High-priority jobs are placed first; among the
 * rest, the one with the cheapest insertion goes next, so jobs near a route get first pick.
 *
 * @param seqs  each vehicle's current stops (indices into problem.jobs), in order
 * @param candidates  the jobs to add (indices into problem.jobs)
 */
export function insertJobs(problem: Problem, seqs: number[][], candidates: number[]) {
  const routes = problem.vehicles.map((_, v) => [...(seqs[v] ?? [])]);
  const evals: Eval[] = routes.map((seq, v) => evaluateRoute(problem, problem.vehicles[v], seq));
  const pending = new Set(candidates);

  /** No new breach: a route that was already late or over is allowed to stay as it was, not get worse. */
  const keepsRules = (ev: RouteEval, old: RouteEval) =>
    isFeasible(ev) || (ev.lateStops <= old.lateStops && ev.totalLateness <= old.totalLateness && ev.overCapacity <= old.overCapacity && ev.overtime <= old.overtime);

  function best(j: number) {
    let pick: { v: number; pos: number; ev: Eval; delta: number } | null = null;
    problem.vehicles.forEach((vehicle, v) => {
      if (!vehicleAllowed(problem.jobs[j], vehicle)) return;
      const seq = routes[v];
      for (let pos = 0; pos <= seq.length; pos++) {
        const ev = evaluateRoute(problem, vehicle, [...seq.slice(0, pos), j, ...seq.slice(pos)]);
        if (!keepsRules(ev, evals[v])) continue;
        const delta = ev.cost - evals[v].cost;
        if (!pick || delta < pick.delta) pick = { v, pos, ev, delta };
      }
    });
    return pick as { v: number; pos: number; ev: Eval; delta: number } | null;
  }

  while (pending.size) {
    let next: { j: number; ins: NonNullable<ReturnType<typeof best>> } | null = null;
    for (const j of pending) {
      const ins = best(j);
      if (!ins) continue;
      const better =
        !next ||
        problem.jobs[j].priority > problem.jobs[next.j].priority ||
        (problem.jobs[j].priority === problem.jobs[next.j].priority && ins.delta < next.ins.delta);
      if (better) next = { j, ins };
    }
    if (!next) break; // nothing left fits anywhere
    const { j, ins } = next;
    routes[ins.v].splice(ins.pos, 0, j);
    evals[ins.v] = ins.ev;
    pending.delete(j);
  }

  return {
    routes: evals.map(({ cost: _cost, ...r }) => r),
    unassigned: [...pending].map((j) => ({ jobId: problem.jobs[j].id, reason: whyNot(problem, routes, j) })),
  };
}

/** Why a job couldn't go anywhere: the rule most of its possible places would break. */
function whyNot(problem: Problem, routes: number[][], j: number): UnassignedReason {
  const allowed = problem.vehicles.map((v, i) => ({ v, i })).filter(({ v }) => vehicleAllowed(problem.jobs[j], v));
  if (!allowed.length) return "pinned_vehicle_unavailable";
  const tally = { time_window: 0, capacity: 0, shift_length: 0 };
  for (const { v, i } of allowed) {
    if (evaluateRoute(problem, v, [j]).lateStops > 0) return "time_window";
    const seq = routes[i];
    for (let pos = 0; pos <= seq.length; pos++) {
      const ev = evaluateRoute(problem, v, [...seq.slice(0, pos), j, ...seq.slice(pos)]);
      if (ev.lateStops > 0) tally.time_window++;
      if (ev.overCapacity > 0) tally.capacity++;
      if (ev.overtime > 0) tally.shift_length++;
    }
  }
  const top = (Object.entries(tally) as [UnassignedReason, number][]).sort((a, b) => b[1] - a[1])[0];
  return top[1] > 0 ? top[0] : "shift_length";
}
