import { evaluateRoute, isFeasible, vehicleAllowed } from "./evaluate";
import type { Problem, RouteEval, Solution, UnassignedReason } from "./types";

/**
 * Vehicle routing with time windows, capacity and shift limits.
 *
 * 1. Regret-2 insertion builds an initial solution (jobs that have few good
 *    options get placed first).
 * 2. Local search: relocate / or-opt (segments of 1–3), inter-route swap,
 *    intra-route 2-opt — first improvement until nothing helps.
 * 3. Ruin & recreate: repeatedly remove a cluster of nearby jobs, re-insert
 *    them, re-run local search, keep the best — until the time budget runs out.
 *
 * Every accepted move keeps all constraints satisfied; jobs that can't be
 * placed are returned as unassigned with a reason instead of being forced in.
 */

type Eval = RouteEval & { cost: number };

const UNASSIGNED_PENALTY = 1e7;

export type SolveOptions = { timeLimitMs?: number; seed?: number };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class State {
  routes: number[][];
  evals: Eval[];
  unassigned: Set<number>;

  constructor(
    private problem: Problem,
    routes?: number[][],
    unassigned?: Iterable<number>,
  ) {
    this.routes = routes ? routes.map((r) => [...r]) : problem.vehicles.map(() => []);
    this.evals = this.routes.map((r, v) => evaluateRoute(problem, problem.vehicles[v], r));
    this.unassigned = new Set(unassigned ?? problem.jobs.map((_, i) => i));
  }

  clone() {
    return new State(this.problem, this.routes, this.unassigned);
  }

  setRoute(v: number, seq: number[], ev?: Eval) {
    this.routes[v] = seq;
    this.evals[v] = ev ?? evaluateRoute(this.problem, this.problem.vehicles[v], seq);
  }
}

export function solve(problem: Problem, opts: SolveOptions = {}): Solution {
  const started = Date.now();
  const timeLimit = opts.timeLimitMs ?? 2000;
  const deadline = started + timeLimit;
  const rand = mulberry32(opts.seed ?? 1);
  const { vehicles, jobs } = problem;
  const balanceWeight = problem.objective === "balanced" ? vehicles.length : 0;

  if (vehicles.length === 0) {
    return {
      routes: [],
      unassigned: jobs.map((j) => ({ jobId: j.id, reason: "no_vehicles" as const })),
      cost: jobs.length * UNASSIGNED_PENALTY,
      iterations: 0,
      elapsedMs: 0,
    };
  }

  const penalty = (j: number) => UNASSIGNED_PENALTY * (1 + jobs[j].priority);

  // "Finish early" is measured from the start of the driver's shift, not from
  // their (possibly delayed) departure — otherwise a route that idles until a
  // 1pm window looks short and gets loaded with the whole afternoon.
  const finish = (e: RouteEval, v: number) => (e.jobIds.length ? e.end - vehicles[v].startTime : 0);

  // The latest finish alone gives no reason to share work once something else fixes it
  // (e.g. a 1pm window): one driver could then sit idle all day. The longest working day
  // breaks that tie. Half weight, so it never buys balance with a later finish.
  type Peaks = { finish: number; work: number };
  const balanceCost = (p: Peaks) => balanceWeight * (p.finish + 0.5 * p.work);

  function totalCost(s: State) {
    let sum = 0;
    s.evals.forEach((e) => (sum += e.cost));
    for (const j of s.unassigned) sum += penalty(j);
    return sum + balanceCost(currentPeaks(s));
  }

  /** Latest finish and longest working day across routes, with routes `skip` replaced by `extra` (same order). */
  function peaksExcept(s: State, skip: number[], extra: Eval[]): Peaks {
    const p = { finish: 0, work: 0 };
    const add = (e: RouteEval, v: number) => {
      p.finish = Math.max(p.finish, finish(e, v));
      p.work = Math.max(p.work, e.duration);
    };
    for (let v = 0; v < s.evals.length; v++) if (!skip.includes(v)) add(s.evals[v], v);
    extra.forEach((e, k) => add(e, skip[k]));
    return p;
  }

  function currentPeaks(s: State) {
    return peaksExcept(s, [], []);
  }

  // ---------- insertion ----------

  type Ins = { v: number; pos: number; ev: Eval; delta: number };

  function bestInsertionInRoute(s: State, j: number, v: number): Ins | null {
    if (!vehicleAllowed(jobs[j], vehicles[v])) return null;
    const seq = s.routes[v];
    const old = s.evals[v];
    let best: Ins | null = null;
    for (let pos = 0; pos <= seq.length; pos++) {
      const next = [...seq.slice(0, pos), j, ...seq.slice(pos)];
      const ev = evaluateRoute(problem, vehicles[v], next);
      if (!isFeasible(ev)) continue;
      const delta = ev.cost - old.cost;
      if (!best || delta < best.delta) best = { v, pos, ev, delta };
    }
    return best;
  }

  function regretInsert(s: State, candidates: number[]) {
    // cache[j][v] = best insertion of job j into route v (undefined = stale).
    const cache = new Map<number, (Ins | null | undefined)[]>();
    for (const j of candidates) cache.set(j, new Array(vehicles.length).fill(undefined));
    const pending = new Set(candidates);

    while (pending.size > 0) {
      if (Date.now() > deadline + 2000) break; // hard stop for huge inputs
      const peaksNow = currentPeaks(s);
      const balanceNow = balanceCost(peaksNow);
      let pick: { j: number; ins: Ins; regret: number; score: number } | null = null;

      for (const j of pending) {
        const row = cache.get(j)!;
        const options: { ins: Ins; score: number }[] = [];
        for (let v = 0; v < vehicles.length; v++) {
          if (row[v] === undefined) row[v] = bestInsertionInRoute(s, j, v);
          const ins = row[v];
          if (ins) {
            const peaks = { finish: Math.max(peaksNow.finish, finish(ins.ev, v)), work: Math.max(peaksNow.work, ins.ev.duration) };
            options.push({ ins, score: ins.delta + balanceCost(peaks) - balanceNow });
          }
        }
        if (options.length === 0) continue;
        options.sort((a, b) => a.score - b.score);
        const regret = options.length > 1 ? options[1].score - options[0].score : 1e9;
        const weighted = regret + jobs[j].priority * 1e6;
        if (
          !pick ||
          weighted > pick.regret ||
          (weighted === pick.regret && options[0].score < pick.score)
        ) {
          pick = { j, ins: options[0].ins, regret: weighted, score: options[0].score };
        }
      }

      if (!pick) break; // nothing left fits anywhere
      const { j, ins } = pick;
      const seq = [...s.routes[ins.v]];
      seq.splice(ins.pos, 0, j);
      s.setRoute(ins.v, seq, ins.ev);
      s.unassigned.delete(j);
      pending.delete(j);
      for (const row of cache.values()) row[ins.v] = undefined;
    }
  }

  // ---------- local search ----------

  /** Tries to replace routes `vs` with `seqs`; applies the move if it is feasible and cheaper. */
  function tryMove(s: State, vs: number[], seqs: number[][]): boolean {
    for (let k = 0; k < vs.length; k++) {
      for (const j of seqs[k]) if (!vehicleAllowed(jobs[j], vehicles[vs[k]])) return false;
    }
    const evs = vs.map((v, k) => evaluateRoute(problem, vehicles[v], seqs[k]));
    if (!evs.every(isFeasible)) return false;
    let oldSum = 0;
    let newSum = 0;
    for (let k = 0; k < vs.length; k++) {
      oldSum += s.evals[vs[k]].cost;
      newSum += evs[k].cost;
    }
    if (balanceWeight > 0) {
      oldSum += balanceCost(currentPeaks(s));
      newSum += balanceCost(peaksExcept(s, vs, evs));
    }
    if (newSum < oldSum - 1e-6) {
      vs.forEach((v, k) => s.setRoute(v, seqs[k], evs[k]));
      return true;
    }
    return false;
  }

  function relocateSegments(s: State): boolean {
    let improved = false;
    for (let a = 0; a < vehicles.length; a++) {
      for (let len = 1; len <= 3; len++) {
        for (let i = 0; i + len <= s.routes[a].length; i++) {
          if (Date.now() > deadline) return improved;
          const src = s.routes[a];
          const seg = src.slice(i, i + len);
          const rest = [...src.slice(0, i), ...src.slice(i + len)];
          let moved = false;
          for (let b = 0; b < vehicles.length && !moved; b++) {
            const target = a === b ? rest : s.routes[b];
            for (let p = 0; p <= target.length && !moved; p++) {
              if (a === b && p === i) continue;
              const next = [...target.slice(0, p), ...seg, ...target.slice(p)];
              moved = a === b ? tryMove(s, [a], [next]) : tryMove(s, [a, b], [rest, next]);
              // Reversed segment is sometimes better (e.g. two stops on the same street).
              if (!moved && len > 1) {
                const rev = [...target.slice(0, p), ...[...seg].reverse(), ...target.slice(p)];
                moved = a === b ? tryMove(s, [a], [rev]) : tryMove(s, [a, b], [rest, rev]);
              }
            }
          }
          if (moved) {
            improved = true;
            i = -1; // route a changed; rescan it
          }
        }
      }
    }
    return improved;
  }

  function swapJobs(s: State): boolean {
    let improved = false;
    for (let a = 0; a < vehicles.length; a++) {
      for (let b = a + 1; b < vehicles.length; b++) {
        for (let i = 0; i < s.routes[a].length; i++) {
          for (let k = 0; k < s.routes[b].length; k++) {
            if (Date.now() > deadline) return improved;
            const ra = [...s.routes[a]];
            const rb = [...s.routes[b]];
            [ra[i], rb[k]] = [rb[k], ra[i]];
            if (tryMove(s, [a, b], [ra, rb])) improved = true;
          }
        }
      }
    }
    return improved;
  }

  function twoOpt(s: State): boolean {
    let improved = false;
    for (let v = 0; v < vehicles.length; v++) {
      for (let i = 0; i < s.routes[v].length - 1; i++) {
        for (let k = i + 1; k < s.routes[v].length; k++) {
          if (Date.now() > deadline) return improved;
          const r = s.routes[v];
          const next = [...r.slice(0, i), ...r.slice(i, k + 1).reverse(), ...r.slice(k + 1)];
          if (tryMove(s, [v], [next])) improved = true;
        }
      }
    }
    return improved;
  }

  function localSearch(s: State) {
    let rounds = 0;
    while (rounds++ < 50 && Date.now() < deadline) {
      let improved = false;
      if (twoOpt(s)) improved = true;
      if (relocateSegments(s)) improved = true;
      if (swapJobs(s)) improved = true;
      if (s.unassigned.size > 0) {
        const before = s.unassigned.size;
        regretInsert(s, [...s.unassigned]);
        if (s.unassigned.size < before) improved = true;
      }
      if (!improved) break;
    }
  }

  // ---------- ruin & recreate ----------

  function ruin(s: State) {
    const assigned: number[] = [];
    s.routes.forEach((r) => assigned.push(...r));
    if (assigned.length === 0) return;
    const k = Math.max(2, Math.min(30, Math.round(assigned.length * (0.1 + rand() * 0.2))));
    let remove: number[];
    if (rand() < 0.7) {
      // Radial: a seed job plus its nearest neighbours by drive time.
      const seed = assigned[Math.floor(rand() * assigned.length)];
      const d = problem.matrix.durations;
      remove = [...assigned]
        .sort((x, y) => d[jobs[seed].node][jobs[x].node] - d[jobs[seed].node][jobs[y].node])
        .slice(0, k);
    } else {
      remove = [...assigned].sort(() => rand() - 0.5).slice(0, k);
    }
    const set = new Set(remove);
    s.routes.forEach((r, v) => {
      if (r.some((j) => set.has(j))) s.setRoute(v, r.filter((j) => !set.has(j)));
    });
    remove.forEach((j) => s.unassigned.add(j));
  }

  // ---------- main ----------

  let current = new State(problem);
  regretInsert(current, [...current.unassigned]);
  localSearch(current);
  let currentCost = totalCost(current);
  let best = current.clone();
  let bestCost = currentCost;
  let iterations = 0;

  while (Date.now() < deadline && jobs.length > 1) {
    iterations++;
    const trial = current.clone();
    ruin(trial);
    regretInsert(trial, [...trial.unassigned].sort(() => rand() - 0.5));
    localSearch(trial);
    const cost = totalCost(trial);
    const progress = (Date.now() - started) / timeLimit;
    const threshold = bestCost * 0.02 * Math.max(0, 1 - progress);
    if (cost < currentCost + threshold) {
      current = trial;
      currentCost = cost;
    }
    if (cost < bestCost - 1e-6) {
      best = trial.clone();
      bestCost = cost;
    }
  }

  return {
    routes: best.evals.map(({ cost: _cost, ...r }) => r),
    unassigned: [...best.unassigned].map((j) => ({ jobId: jobs[j].id, reason: unassignedReason(problem, best, j) })),
    cost: bestCost,
    iterations,
    elapsedMs: Date.now() - started,
  };
}

function unassignedReason(problem: Problem, s: State, j: number): UnassignedReason {
  const job = problem.jobs[j];
  const allowed = problem.vehicles.map((v, i) => ({ v, i })).filter(({ v }) => vehicleAllowed(job, v));
  if (allowed.length === 0) return "pinned_vehicle_unavailable";

  const tally = { time_window: 0, capacity: 0, shift_length: 0 };
  for (const { v, i } of allowed) {
    const seq = s.routes[i];
    for (let pos = 0; pos <= seq.length; pos++) {
      const ev = evaluateRoute(problem, v, [...seq.slice(0, pos), j, ...seq.slice(pos)]);
      if (ev.lateStops > 0) tally.time_window++;
      if (ev.overCapacity > 0) tally.capacity++;
      if (ev.overtime > 0) tally.shift_length++;
    }
    // Can't be served even on an empty route → it's the job itself, not crowding.
    const alone = evaluateRoute(problem, v, [j]);
    if (alone.lateStops > 0) return "time_window";
  }
  const top = (Object.entries(tally) as [UnassignedReason, number][]).sort((a, b) => b[1] - a[1])[0];
  return top[1] > 0 ? top[0] : "shift_length";
}

/**
 * The "before" scenario for the comparison card: orders driven in the order
 * they were entered, split into equal consecutive chunks per driver — roughly
 * what a dispatcher does by hand from a spreadsheet. Constraints are not
 * enforced; violations are reported on each route.
 */
export function naivePlan(problem: Problem): RouteEval[] {
  const n = problem.jobs.length;
  const V = problem.vehicles.length;
  if (V === 0) return [];
  const per = Math.ceil(n / V);
  return problem.vehicles.map((v, i) => {
    const seq: number[] = [];
    for (let j = i * per; j < Math.min(n, (i + 1) * per); j++) seq.push(j);
    const { cost: _cost, ...ev } = evaluateRoute(problem, v, seq);
    return ev;
  });
}
