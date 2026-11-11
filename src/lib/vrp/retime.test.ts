import { describe, expect, it } from "vitest";
import { evaluateRoute } from "./evaluate";
import { retimeStops, type RetimeStop } from "./retime";
import type { Job, Problem, Vehicle } from "./types";

const H = 3600;

// depot = node 0, three customers along a line, 10 minutes apart.
const durations = [
  [0, 600, 1200, 1800],
  [600, 0, 600, 1200],
  [1200, 600, 0, 600],
  [1800, 1200, 600, 0],
];
const job = (i: number, patch: Partial<Job> = {}): Job => ({ id: `o${i}`, node: i, service: 300, twStart: null, twEnd: null, demand: 1, priority: 0, ...patch });
const vehicle = (patch: Partial<Vehicle> = {}): Vehicle => ({ id: "d", startNode: 0, endNode: 0, startTime: 8 * H, maxDuration: 10 * H, capacity: null, ...patch });

function planned(jobs: Job[], v: Vehicle) {
  const p: Problem = { vehicles: [v], jobs, matrix: { durations, distances: durations }, objective: "time" };
  const ev = evaluateRoute(p, v, jobs.map((_, i) => i));
  const stops: RetimeStop[] = ev.stops.map((st, i) => ({
    id: st.jobId,
    seq: i + 1,
    etaS: st.arrival,
    etdS: st.departure,
    waitS: st.wait,
    legDriveS: st.legDuration,
    twStart: jobs[i].twStart,
    twEnd: jobs[i].twEnd,
  }));
  const reloads = ev.reloads.map((r) => ({ afterSeq: r.afterIndex + 1, arrivalS: r.arrival, departureS: r.departure }));
  return { ev, stops, reloads, problem: p };
}

describe("retimeStops", () => {
  it("gives the planned times back when the driver leaves on time", () => {
    const { ev, stops, reloads } = planned([job(1), job(2), job(3)], vehicle());
    const r = retimeStops(ev.start, stops, reloads, ev.end);
    expect(r.stops.map((s) => [s.etaS, s.etdS])).toEqual(stops.map((s) => [s.etaS, s.etdS]));
    expect(r.endS).toBe(ev.end);
  });

  it("counts every arrival from when the driver really set off", () => {
    const { ev, stops, reloads } = planned([job(1), job(2), job(3)], vehicle());
    const late = 8 * H + 47 * 60;
    const r = retimeStops(late, stops, reloads, ev.end);
    // Same as planning the route again with that start time.
    const again = planned([job(1), job(2), job(3)], vehicle({ startTime: late })).ev;
    expect(r.stops.map((s) => s.etaS)).toEqual(again.stops.map((s) => s.arrival));
    expect(r.endS).toBe(again.end);
    expect(r.stops[0].etaS).toBe(late + 600);
  });

  it("an early start waits for a delivery window instead of arriving before it opens", () => {
    const jobs = [job(1), job(2, { twStart: 9 * H, twEnd: 10 * H }), job(3)];
    const { ev, stops, reloads } = planned(jobs, vehicle());
    const r = retimeStops(7 * H, stops, reloads, ev.end);
    expect(r.stops[1].etaS).toBe(7 * H + 600 + 300 + 600);
    expect(r.stops[1].waitS).toBe(9 * H - r.stops[1].etaS);
    expect(r.stops[2].etaS).toBe(9 * H + 300 + 600);
  });

  it("marks a stop late when the real start pushes it past its window", () => {
    const jobs = [job(1, { twEnd: 8 * H + 30 * 60 }), job(2)];
    const { ev, stops, reloads } = planned(jobs, vehicle());
    const r = retimeStops(8 * H + 40 * 60, stops, reloads, ev.end);
    expect(r.stops[0].lateS).toBe(20 * 60);
    expect(r.stops[1].lateS).toBe(0);
  });

  it("moves depot reloads with the rest of the route", () => {
    const jobs = [job(1), job(2), job(3)];
    const v = vehicle({ capacity: 2, maxTrips: 2, reloadTime: 900, depotNode: 0 });
    const { ev, stops, reloads } = planned(jobs, v);
    expect(reloads).toHaveLength(1);
    const late = 9 * H;
    const r = retimeStops(late, stops, reloads, ev.end);
    const again = planned(jobs, vehicle({ capacity: 2, maxTrips: 2, reloadTime: 900, depotNode: 0, startTime: late })).ev;
    expect(r.stops.map((s) => s.etaS)).toEqual(again.stops.map((s) => s.arrival));
    expect(r.reloads).toEqual(again.reloads.map((x) => ({ afterSeq: x.afterIndex + 1, arrivalS: x.arrival, departureS: x.departure })));
    expect(r.endS).toBe(again.end);
  });

  it("keeps a route with nothing left at its start", () => {
    expect(retimeStops(8 * H, [], [], 12 * H)).toEqual({ stops: [], reloads: [], endS: 8 * H });
  });
});
