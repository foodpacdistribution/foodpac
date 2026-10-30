import type { Job, Problem, Reload, RouteEval, StopTiming, Vehicle } from "./types";

const PRIORITY_EARLINESS_WEIGHT = 0.1;

function forwardPass(problem: Problem, vehicle: Vehicle, seq: number[], start: number) {
  const { durations, distances } = problem.matrix;
  const stops: StopTiming[] = [];
  const reloads: Reload[] = [];
  const maxTrips = Math.max(1, vehicle.maxTrips ?? 1);
  const depot = vehicle.depotNode ?? vehicle.endNode ?? vehicle.startNode;
  let t = start;
  let node = vehicle.startNode;
  let drive = 0;
  let dist = 0;
  let wait = 0;
  let service = 0;
  let load = 0;
  let trip = 1;
  let tripLoad = 0;
  let tripCapacity = vehicle.firstTripCapacity !== undefined ? vehicle.firstTripCapacity : vehicle.capacity;
  let overCapacity = 0;
  let lateStops = 0;
  let totalLateness = 0;
  let priorityArrival = 0;

  for (let i = 0; i < seq.length; i++) {
    const job = problem.jobs[seq[i]];
    let detourDuration = 0;
    let detourDistance = 0;
    // Greedy trip split: reload before the stop that would overflow this trip.
    if (tripCapacity !== null && tripLoad > 0 && tripLoad + job.demand > tripCapacity && trip < maxTrips) {
      detourDuration = durations[node][depot];
      detourDistance = distances[node][depot];
      const arrival = t + detourDuration;
      const departure = arrival + (vehicle.reloadTime ?? 0);
      reloads.push({ afterIndex: i - 1, arrival, departure });
      overCapacity += Math.max(0, tripLoad - tripCapacity);
      t = departure;
      node = depot;
      trip++;
      tripLoad = 0;
      tripCapacity = vehicle.capacity;
    }
    const legDuration = detourDuration + durations[node][job.node];
    const legDistance = detourDistance + distances[node][job.node];
    const arrival = t + durations[node][job.node];
    const w = job.twStart !== null && arrival < job.twStart ? job.twStart - arrival : 0;
    const late = job.twEnd !== null && arrival > job.twEnd ? arrival - job.twEnd : 0;
    const departure = arrival + w + job.service;
    stops.push({ jobId: job.id, arrival, wait: w, departure, legDuration, legDistance, late, trip });
    drive += legDuration;
    dist += legDistance;
    wait += w;
    service += job.service;
    load += job.demand;
    tripLoad += job.demand;
    if (late > 0) {
      lateStops++;
      totalLateness += late;
    }
    if (job.priority > 0) priorityArrival += arrival - start;
    t = departure;
    node = job.node;
  }
  if (tripCapacity !== null) overCapacity += Math.max(0, tripLoad - tripCapacity);

  let returnDuration = 0;
  let returnDistance = 0;
  if (vehicle.endNode !== null && seq.length > 0) {
    returnDuration = durations[node][vehicle.endNode];
    returnDistance = distances[node][vehicle.endNode];
  }
  const end = seq.length > 0 ? t + returnDuration : start;

  return {
    stops,
    end,
    drive: drive + returnDuration,
    dist: dist + returnDistance,
    wait,
    service,
    load,
    trips: trip,
    reloads,
    overCapacity,
    lateStops,
    totalLateness,
    priorityArrival,
    returnDuration,
    returnDistance,
  };
}

/**
 * Simulates a vehicle driving `seq` (indices into problem.jobs). Departure is
 * pushed later when that only removes waiting time without making any stop
 * late, so a route whose first window opens at 1pm doesn't "start" at 8am.
 */
export function evaluateRoute(problem: Problem, vehicle: Vehicle, seq: number[]): RouteEval & { cost: number } {
  let pass = forwardPass(problem, vehicle, seq, vehicle.startTime);

  if (pass.wait > 0 && pass.lateStops === 0) {
    let delay = pass.wait;
    let waitBefore = 0;
    for (let i = 0; i < pass.stops.length; i++) {
      const job = problem.jobs[seq[i]];
      if (job.twEnd !== null) delay = Math.min(delay, waitBefore + (job.twEnd - pass.stops[i].arrival));
      waitBefore += pass.stops[i].wait;
    }
    if (delay > 0) pass = forwardPass(problem, vehicle, seq, vehicle.startTime + delay);
  }

  const start = pass.stops.length ? pass.stops[0].arrival - pass.stops[0].legDuration : vehicle.startTime;
  const duration = pass.end - start;
  const overtime = Math.max(0, duration - vehicle.maxDuration);

  return {
    vehicleId: vehicle.id,
    jobIds: seq.map((i) => problem.jobs[i].id),
    stops: pass.stops,
    start,
    end: pass.end,
    duration,
    driveTime: pass.drive,
    serviceTime: pass.service,
    waitTime: pass.wait,
    distance: pass.dist,
    load: pass.load,
    trips: pass.stops.length ? pass.trips : 0,
    reloads: pass.reloads,
    returnDuration: pass.returnDuration,
    returnDistance: pass.returnDistance,
    lateStops: pass.lateStops,
    totalLateness: pass.totalLateness,
    overCapacity: pass.overCapacity,
    overtime,
    cost: routeCost(problem, duration, pass.dist, pass.priorityArrival, seq.length),
  };
}

function routeCost(problem: Problem, duration: number, distance: number, priorityArrival: number, n: number) {
  if (n === 0) return 0;
  const base = problem.objective === "distance" ? distance / 10 + duration * 0.1 : duration;
  return base + priorityArrival * PRIORITY_EARLINESS_WEIGHT;
}

export function isFeasible(r: RouteEval) {
  return r.lateStops === 0 && r.overCapacity === 0 && r.overtime === 0;
}

export function vehicleAllowed(job: Job, vehicle: Vehicle) {
  return !job.allowedVehicles || job.allowedVehicles.includes(vehicle.id);
}
