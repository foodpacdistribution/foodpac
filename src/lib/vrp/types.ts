// Core types for the vehicle routing solver. All times are seconds since local
// midnight on the delivery date; all distances are metres. Node indices point
// into the travel matrix.

export type Matrix = {
  durations: number[][];
  distances: number[][];
};

export type Vehicle = {
  id: string;
  startNode: number;
  /** null = route ends at the last stop (no return leg). */
  endNode: number | null;
  /** Earliest departure from startNode. */
  startTime: number;
  /** Hard limit on (end - start) in seconds. */
  maxDuration: number;
  /** null = unlimited. Per trip when maxTrips > 1. */
  capacity: number | null;
  /** Depot used for reloads. Defaults to endNode ?? startNode. */
  depotNode?: number;
  /**
   * >1 lets the vehicle return to its depot to reload. Trips are split
   * automatically: a reload is inserted before the stop that would overflow
   * the current load, so the optimiser only has to choose the stop order.
   */
  maxTrips?: number;
  /** Seconds spent at the depot per reload. */
  reloadTime?: number;
  /** Capacity left on the first trip (e.g. part already delivered mid-day). Defaults to capacity. */
  firstTripCapacity?: number | null;
};

export type Job = {
  id: string;
  node: number;
  service: number;
  twStart: number | null;
  twEnd: number | null;
  demand: number;
  /** 0 = normal, 1 = high. High priority is served earlier when cheap and dropped last. */
  priority: number;
  /** If set, only these vehicles may serve the job (e.g. pinned to a driver). */
  allowedVehicles?: string[];
};

export type Objective = "balanced" | "time" | "distance";

export type Problem = {
  vehicles: Vehicle[];
  jobs: Job[];
  matrix: Matrix;
  objective: Objective;
};

export type StopTiming = {
  jobId: string;
  arrival: number;
  wait: number;
  departure: number;
  legDuration: number;
  legDistance: number;
  late: number;
  /** 1-based trip number (increments after each depot reload). */
  trip: number;
};

export type Reload = { afterIndex: number; arrival: number; departure: number };

export type RouteEval = {
  vehicleId: string;
  jobIds: string[];
  stops: StopTiming[];
  start: number;
  end: number;
  duration: number;
  driveTime: number;
  serviceTime: number;
  waitTime: number;
  distance: number;
  load: number;
  trips: number;
  reloads: Reload[];
  /** Return leg (last stop → end node). */
  returnDuration: number;
  returnDistance: number;
  // Constraint violations (always zero for solver output; manual edits may break them).
  lateStops: number;
  totalLateness: number;
  overCapacity: number;
  overtime: number;
};

export type UnassignedReason =
  | "time_window"
  | "capacity"
  | "shift_length"
  | "pinned_vehicle_unavailable"
  | "no_vehicles";

export type Solution = {
  routes: RouteEval[];
  unassigned: { jobId: string; reason: UnassignedReason }[];
  cost: number;
  iterations: number;
  elapsedMs: number;
};
