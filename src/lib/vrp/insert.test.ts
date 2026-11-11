import { describe, expect, it } from "vitest";
import { insertJobs } from "./insert";
import type { Job, Problem, Vehicle } from "./types";

const H = 3600;

// Points on a line, 1 km apart; node 0 is the depot. 1 km = 100 s.
function line(n: number) {
  const xs = Array.from({ length: n + 1 }, (_, i) => i);
  const distances = xs.map((a) => xs.map((b) => Math.abs(a - b) * 1000));
  const durations = distances.map((row) => row.map((d) => d / 10));
  return { durations, distances };
}
const job = (i: number, patch: Partial<Job> = {}): Job => ({ id: `o${i}`, node: i, service: 60, twStart: null, twEnd: null, demand: 1, priority: 0, ...patch });
const van = (id: string, patch: Partial<Vehicle> = {}): Vehicle => ({ id, startNode: 0, endNode: 0, startTime: 8 * H, maxDuration: 10 * H, capacity: null, ...patch });

describe("insertJobs", () => {
  it("keeps the stops already on a route in their order and slots new ones in between", () => {
    const jobs = [1, 2, 3, 4, 5, 6].map((i) => job(i));
    const p: Problem = { vehicles: [van("a")], jobs, matrix: line(6), objective: "time" };
    // Planned: 2, 4, 6 (indices 1, 3, 5). New: 1, 3, 5.
    const r = insertJobs(p, [[1, 3, 5]], [0, 2, 4]);
    expect(r.unassigned).toEqual([]);
    expect(r.routes[0].jobIds).toEqual(["o1", "o2", "o3", "o4", "o5", "o6"]);
  });

  it("never reorders existing stops, even when that would be shorter", () => {
    const jobs = [1, 2, 3].map((i) => job(i));
    const p: Problem = { vehicles: [van("a")], jobs, matrix: line(3), objective: "time" };
    // The dispatched order is 3 then 1 (a zig-zag); adding 2 must keep 3 before 1.
    const r = insertJobs(p, [[2, 0]], [1]);
    const ids = r.routes[0].jobIds;
    expect(ids.indexOf("o3")).toBeLessThan(ids.indexOf("o1"));
    expect(ids).toHaveLength(3);
  });

  it("gives a new order to the driver it fits best, and respects pinned drivers", () => {
    // Van a works east of the depot, van b north. Grid km, 100 s per km.
    const pts = [[0, 0], [1, 0], [0, 9], [2, 0], [0, 8]];
    const distances = pts.map(([x1, y1]) => pts.map(([x2, y2]) => (Math.abs(x1 - x2) + Math.abs(y1 - y2)) * 1000));
    const matrix = { distances, durations: distances.map((row) => row.map((d) => d / 10)) };
    const jobs = [job(1), { ...job(2), id: "o9" }, { ...job(3), id: "o2" }, { ...job(4, { allowedVehicles: ["a"] }), id: "o8" }];
    const p: Problem = { vehicles: [van("a"), van("b")], jobs, matrix, objective: "time" };
    const r = insertJobs(p, [[0], [1]], [2, 3]);
    expect(r.routes[0].jobIds).toContain("o2");
    expect(r.routes[1].jobIds).not.toContain("o2");
    expect(r.routes[0].jobIds).toContain("o8"); // pinned to a, though b is closer
  });

  it("leaves out an order that would break a delivery window or the van's capacity, and says why", () => {
    const jobs = [job(1), job(2), job(3, { twEnd: 8 * H })];
    const p: Problem = { vehicles: [van("a", { capacity: 2 })], jobs, matrix: line(3), objective: "time" };
    const r = insertJobs(p, [[0, 1]], [2]);
    expect(r.routes[0].jobIds).toEqual(["o1", "o2"]);
    expect(r.unassigned).toEqual([{ jobId: "o3", reason: "time_window" }]);
    const full = insertJobs({ ...p, jobs: [job(1), job(2), job(3)] }, [[0, 1]], [2]);
    expect(full.unassigned).toEqual([{ jobId: "o3", reason: "capacity" }]);
  });

  it("places high-priority orders first", () => {
    // Room for one more stop on the shift: the urgent one gets it.
    const jobs = [job(1), job(5), job(6, { priority: 1 })];
    const p: Problem = { vehicles: [van("a", { maxDuration: 1350 })], jobs, matrix: line(6), objective: "time" };
    const r = insertJobs(p, [[0]], [1, 2]);
    expect(r.routes[0].jobIds).toContain("o6");
    expect(r.unassigned.map((u) => u.jobId)).toEqual(["o5"]);
  });
});
