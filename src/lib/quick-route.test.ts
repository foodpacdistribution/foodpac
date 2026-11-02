import { describe, expect, it } from "vitest";
import { parseAddressList, planSingleRoute, projectRemaining } from "./quick-route";

/** Points on a line: travel time = |a - b| × 60 s, distance = |a - b| × 1000 m. */
function lineMatrix(xs: number[]) {
  return {
    durations: xs.map((a) => xs.map((b) => Math.abs(a - b) * 60)),
    distances: xs.map((a) => xs.map((b) => Math.abs(a - b) * 1000)),
  };
}

/** Every permutation, for checking the exact search against brute force. */
function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  return permutations(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
}

describe("planSingleRoute", () => {
  it("visits stops on a line in order when the route ends at the last stop", () => {
    // Start at 0, stops entered scrambled.
    const plan = planSingleRoute(lineMatrix([0, 5, 2, 9, 1]), { stopCount: 4, endNode: null, startS: 8 * 3600, serviceS: 0 });
    expect(plan.order).toEqual([3, 1, 0, 2]); // positions 1, 2, 5, 9
    expect(plan.driveS).toBe(9 * 60);
    expect(plan.returnLeg).toBeNull();
    expect(plan.exact).toBe(true);
  });

  it("reports per-leg times, ETAs including service time, and the return leg", () => {
    // Stops at 3 and 1, depot at 5.
    const plan = planSingleRoute(lineMatrix([0, 3, 1, 5]), { stopCount: 2, endNode: 3, startS: 1000, serviceS: 300 });
    expect(plan.order).toEqual([1, 0]);
    expect(plan.legs.map((l) => l.durationS)).toEqual([60, 120]);
    expect(plan.legs[0].arrivalS).toBe(1060);
    expect(plan.legs[1].arrivalS).toBe(1060 + 300 + 120);
    expect(plan.returnLeg).toEqual({ durationS: 120, distanceM: 2000 });
    expect(plan.finishS).toBe(1060 + 300 + 120 + 300 + 120);
  });

  it("compares against the entered order", () => {
    const plan = planSingleRoute(lineMatrix([0, 9, 1, 8, 2]), { stopCount: 4, endNode: null, startS: 0, serviceS: 0 });
    expect(plan.driveS).toBe(9 * 60);
    expect(plan.entered.driveS).toBe((9 + 8 + 7 + 6) * 60);
  });

  it("finds the true optimum on an asymmetric matrix with a depot end node", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const size = 8; // start + 6 stops + depot
    const durations = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => (i === j ? 0 : Math.round(60 + rand() * 1200))));
    const matrix = { durations, distances: durations };
    const plan = planSingleRoute(matrix, { stopCount: 6, endNode: 7, startS: 0, serviceS: 0 });

    const cost = (p: number[]) => p.reduce((sum, s, i) => sum + durations[i === 0 ? 0 : p[i - 1] + 1][s + 1], 0) + durations[p[5] + 1][7];
    const best = Math.min(...permutations(6).map(cost));
    expect(plan.driveS).toBe(best);
  });

  it("falls back to the heuristic solver above the exact limit", () => {
    const xs = [0, ...Array.from({ length: 12 }, (_, i) => ((i * 7) % 12) + 1)];
    const plan = planSingleRoute(lineMatrix(xs), { stopCount: 12, endNode: null, startS: 0, serviceS: 0 });
    expect(plan.exact).toBe(false);
    expect(new Set(plan.order).size).toBe(12);
    expect(plan.driveS).toBe(12 * 60);
  });
});

describe("projectRemaining", () => {
  const stops = [
    { legDurationS: 600, arrivalS: 1600, departureS: 1900 },
    { legDurationS: 300, arrivalS: 2200, departureS: 2500 },
  ];

  it("matches the plan when the driver is on time", () => {
    expect(projectRemaining(stops, 1000, 1200)).toEqual([
      { arrivalS: 1600, departureS: 1900 },
      { arrivalS: 2200, departureS: 2500 },
    ]);
  });

  it("shifts later stops when the driver left the previous stop late", () => {
    expect(projectRemaining(stops, 1600, 1700).map((s) => s.arrivalS)).toEqual([2200, 2800]);
  });

  it("never puts the next arrival in the past", () => {
    // Left at 1000, should have arrived at 1600, but it is 2000 and still not there.
    expect(projectRemaining(stops, 1000, 2000).map((s) => s.arrivalS)).toEqual([2000, 2600]);
  });
});

describe("parseAddressList", () => {
  it("drops list markers but keeps street numbers", () => {
    const { addresses } = parseAddressList("1. 12 Mains Rd, Sunnybank\n2) 3/40 Logan Rd\n- 7 Queen St\n• 100 Eagle St\n12 Mains Rd North");
    expect(addresses).toEqual(["12 Mains Rd, Sunnybank", "3/40 Logan Rd", "7 Queen St", "100 Eagle St", "12 Mains Rd North"]);
  });

  it("joins spreadsheet cells and skips blank lines", () => {
    const { addresses } = parseAddressList("12 Mains Rd\tSunnybank\t4109\n\n  \n\t\n2 Clunies Ross Ct\tEight Mile Plains");
    expect(addresses).toEqual(["12 Mains Rd, Sunnybank, 4109", "2 Clunies Ross Ct, Eight Mile Plains"]);
  });

  it("keeps a repeated address once, ignoring case and spacing", () => {
    expect(parseAddressList("12 Mains Rd, Sunnybank\n12  mains rd sunnybank\n7 Queen St")).toEqual({
      addresses: ["12 Mains Rd, Sunnybank", "7 Queen St"],
      duplicates: 1,
    });
  });
});
