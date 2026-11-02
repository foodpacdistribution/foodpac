import { describe, expect, it } from "vitest";
import { evaluateRoute, isFeasible } from "./evaluate";
import { naivePlan, solve } from "./solver";
import type { Job, Problem, Vehicle } from "./types";

const H = 3600;

function grid(n: number, seed = 7) {
  let a = seed;
  const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  const pts: [number, number][] = [[15000, 15000]]; // depot at the centre
  for (let i = 0; i < n; i++) pts.push([rnd() * 30000, rnd() * 30000]);
  const distances = pts.map((p) => pts.map((q) => Math.round((Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1])) * 1.1)));
  const durations = distances.map((row) => row.map((d) => Math.round(d / 11)));
  return { durations, distances };
}

function problem(n: number, vehicles: number, patch: (jobs: Job[], vs: Vehicle[]) => void = () => {}): Problem {
  const jobs: Job[] = Array.from({ length: n }, (_, i) => ({
    id: `o${i}`,
    node: i + 1,
    service: 300,
    twStart: null,
    twEnd: null,
    demand: 1,
    priority: 0,
  }));
  const vs: Vehicle[] = Array.from({ length: vehicles }, (_, i) => ({
    id: `d${i}`,
    startNode: 0,
    endNode: 0,
    startTime: 8 * H,
    maxDuration: 10 * H,
    capacity: null,
  }));
  patch(jobs, vs);
  return { jobs, vehicles: vs, matrix: grid(n), objective: "balanced" };
}

const allFeasible = (p: Problem, s: ReturnType<typeof solve>) =>
  s.routes.every((r, i) => {
    const seq = r.jobIds.map((id) => p.jobs.findIndex((j) => j.id === id));
    return isFeasible(evaluateRoute(p, p.vehicles[i], seq));
  });

describe("solve", () => {
  it("assigns every job and beats the naive split on drive time", () => {
    const p = problem(40, 3);
    const s = solve(p, { timeLimitMs: 800 });
    expect(s.unassigned).toEqual([]);
    expect(s.routes.flatMap((r) => r.jobIds).sort()).toEqual(p.jobs.map((j) => j.id).sort());
    expect(allFeasible(p, s)).toBe(true);
    const drive = (rs: { driveTime: number }[]) => rs.reduce((a, r) => a + r.driveTime, 0);
    expect(drive(s.routes)).toBeLessThan(drive(naivePlan(p)) * 0.7);
  });

  it("balanced objective spreads work across drivers", () => {
    const s = solve(problem(30, 3), { timeLimitMs: 600 });
    const durations = s.routes.map((r) => r.duration);
    expect(durations.every((d) => d > 0)).toBe(true);
    expect(Math.max(...durations) / Math.min(...durations)).toBeLessThan(2);
  });

  it("balances finish times even when some stops only open in the afternoon", () => {
    // Regression: with delayed departure, a route idling until a 1pm window used to
    // look "short", so one driver got the whole afternoon and finished last by hours.
    const p = problem(30, 3, (jobs) => {
      for (const i of [3, 8, 14, 20, 26]) {
        jobs[i].twStart = 13 * H;
        jobs[i].twEnd = 16 * H;
      }
    });
    const balanced = solve(p, { timeLimitMs: 800 });
    const fastest = solve({ ...p, objective: "time" }, { timeLimitMs: 800 });
    const latest = (s: typeof balanced) => Math.max(...s.routes.filter((r) => r.jobIds.length).map((r) => r.end));
    expect(balanced.unassigned).toEqual([]);
    expect(latest(balanced)).toBeLessThanOrEqual(latest(fastest));
    expect(latest(balanced)).toBeLessThan(16 * H + 30 * 60);
  });

  it("still shares work when an afternoon window already sets the latest finish", () => {
    // Regression: the latest finish was the only balance term, so once one driver's
    // 1pm stop fixed it, two drivers did everything and the third was left idle.
    const p = problem(30, 3, (jobs) => {
      jobs[5].twStart = 13 * H;
      jobs[5].twEnd = 16 * H;
      jobs[5].allowedVehicles = ["d2"];
    });
    const s = solve(p, { timeLimitMs: 800 });
    const fastest = solve({ ...p, objective: "time" }, { timeLimitMs: 800 });
    const latest = (x: typeof s) => Math.max(...x.routes.map((r) => r.end));
    expect(s.unassigned).toEqual([]);
    expect(s.routes.every((r) => r.jobIds.length >= 5)).toBe(true);
    const work = s.routes.map((r) => r.duration);
    expect(Math.max(...work) / Math.min(...work)).toBeLessThan(1.5);
    expect(latest(s)).toBeLessThanOrEqual(latest(fastest));
  });

  it("respects time windows and reports impossible ones", () => {
    const p = problem(20, 2, (jobs) => {
      jobs[0].twStart = 13 * H;
      jobs[0].twEnd = 14 * H;
      jobs[1].twStart = 8 * H;
      jobs[1].twEnd = 8 * H + 60; 
    });
    const s = solve(p, { timeLimitMs: 500 });
    expect(s.unassigned).toEqual([{ jobId: "o1", reason: "time_window" }]);
    const stop = s.routes.flatMap((r) => r.stops).find((x) => x.jobId === "o0")!;
    expect(stop.arrival + stop.wait).toBeGreaterThanOrEqual(13 * H);
    expect(stop.arrival).toBeLessThanOrEqual(14 * H);
    expect(allFeasible(p, s)).toBe(true);
  });

  it("respects capacity and leaves overflow unassigned", () => {
    const p = problem(12, 2, (_jobs, vs) => vs.forEach((v) => (v.capacity = 5)));
    const s = solve(p, { timeLimitMs: 400 });
    expect(s.routes.every((r) => r.load <= 5)).toBe(true);
    expect(s.unassigned).toHaveLength(2);
    expect(s.unassigned.every((u) => u.reason === "capacity")).toBe(true);
  });

  it("serves overflow with depot reload trips when allowed", () => {
    const p = problem(12, 2, (_jobs, vs) =>
      vs.forEach((v) => {
        v.capacity = 5;
        v.maxTrips = 2;
        v.reloadTime = 900;
      }),
    );
    const s = solve(p, { timeLimitMs: 500 });
    expect(s.unassigned).toEqual([]);
    expect(s.routes.some((r) => r.trips === 2)).toBe(true);
    for (const r of s.routes) {
      expect(r.overCapacity).toBe(0);
      expect(r.reloads).toHaveLength(r.trips - 1);
      // No trip carries more than the vehicle holds.
      const perTrip = new Map<number, number>();
      r.stops.forEach((st) => perTrip.set(st.trip, (perTrip.get(st.trip) ?? 0) + 1));
      expect(Math.max(...perTrip.values())).toBeLessThanOrEqual(5);
      // The reload takes time: the next stop can't be reached before the depot departure.
      for (const rl of r.reloads) expect(r.stops[rl.afterIndex + 1].arrival).toBeGreaterThanOrEqual(rl.departure);
    }
  });

  it("starts each vehicle from its own depot", () => {
    // Node 0 is the centre depot; give vehicle 1 a depot at job node 5's location instead.
    const p = problem(10, 2, (jobs, vs) => {
      vs[1].startNode = vs[1].endNode = vs[1].depotNode = 5;
      jobs[4].allowedVehicles = ["d1"]; // job on node 5 itself
    });
    const s = solve(p, { timeLimitMs: 300 });
    const r1 = s.routes[1];
    expect(r1.jobIds).toContain("o4");
    const first = r1.stops[0];
    expect(first.legDuration).toBe(p.matrix.durations[5][p.jobs.find((j) => j.id === r1.jobIds[0])!.node]);
  });

  it("respects shift length", () => {
    const p = problem(30, 1, (_jobs, vs) => (vs[0].maxDuration = 2 * H));
    const s = solve(p, { timeLimitMs: 400 });
    expect(s.routes[0].duration).toBeLessThanOrEqual(2 * H);
    expect(s.unassigned.length).toBeGreaterThan(0);
    expect(s.unassigned[0].reason).toBe("shift_length");
  });

  it("keeps pinned jobs on their driver", () => {
    const p = problem(15, 3, (jobs) => {
      jobs[3].allowedVehicles = ["d2"];
      jobs[4].allowedVehicles = ["nobody"];
    });
    const s = solve(p, { timeLimitMs: 400 });
    expect(s.routes[2].jobIds).toContain("o3");
    expect(s.unassigned).toEqual([{ jobId: "o4", reason: "pinned_vehicle_unavailable" }]);
  });
});

describe("evaluateRoute", () => {
  it("delays departure instead of waiting at the first stop", () => {
    const p = problem(1, 1, (jobs) => {
      jobs[0].twStart = 13 * H;
      jobs[0].twEnd = 15 * H;
    });
    const ev = evaluateRoute(p, p.vehicles[0], [0]);
    expect(ev.waitTime).toBe(0);
    expect(ev.stops[0].arrival).toBe(13 * H);
    expect(ev.start).toBe(13 * H - ev.stops[0].legDuration);
  });

  it("reports lateness for manual sequences instead of hiding it", () => {
    const p = problem(2, 1, (jobs) => {
      jobs[1].twEnd = 8 * H;
    });
    const ev = evaluateRoute(p, p.vehicles[0], [0, 1]);
    expect(ev.lateStops).toBe(1);
    expect(isFeasible(ev)).toBe(false);
  });
});
