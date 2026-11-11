// Re-times a route's remaining stops from a new departure time, keeping the stop order and the
// road times that were planned. Used when the driver actually sets off: the plan was made for a
// shift start, but arrival times on the phone, the docket and the customer's tracking page should
// count from the moment the van really left.
//
// Everything needed is already stored on each stop (see forwardPass in ./evaluate):
//   arrival   = previous departure + legDrive + reload time (when a depot reload sits in between)
//   departure = arrival + wait for the delivery window + unloading time
// so no travel matrix is needed, and a route built as a shipment re-times exactly like one from
// the Route Planner.

export type RetimeStop = {
  id: string;
  seq: number;
  etaS: number;
  etdS: number;
  waitS: number;
  legDriveS: number;
  /** Delivery window in seconds after midnight. */
  twStart: number | null;
  twEnd: number | null;
};

export type RetimeReload = { afterSeq: number; arrivalS: number; departureS: number };

export type RetimedStop = { id: string; etaS: number; etdS: number; waitS: number; lateS: number };

/**
 * @param start  when the van leaves the point the first stop's leg starts from (s after midnight)
 * @param stops  the stops still to do, in delivery order
 * @param reloads the route's depot reloads (afterSeq = the stop before the reload)
 * @param endS   the route's planned end, so the trip back to the depot keeps its length
 */
export function retimeStops(start: number, stops: RetimeStop[], reloads: RetimeReload[], endS: number) {
  const out: RetimedStop[] = [];
  const touched = new Set<number>();
  const newReloads: RetimeReload[] = [];
  let t = Math.round(start);

  for (const st of stops) {
    const reload = reloads.find((r) => r.afterSeq === st.seq - 1);
    let reloadS = 0;
    if (reload) {
      reloadS = Math.max(0, reload.departureS - reload.arrivalS);
      // The drive to the depot is part of legDrive; how far into it the depot sits is what was planned.
      const plannedPrevDeparture = st.etaS - st.legDriveS - reloadS;
      const toDepot = Math.max(0, reload.arrivalS - plannedPrevDeparture);
      newReloads.push({ afterSeq: reload.afterSeq, arrivalS: t + toDepot, departureS: t + toDepot + reloadS });
      touched.add(reload.afterSeq);
    }
    const service = Math.max(0, st.etdS - st.etaS - st.waitS);
    const etaS = t + st.legDriveS + reloadS;
    const waitS = st.twStart !== null && etaS < st.twStart ? st.twStart - etaS : 0;
    const lateS = st.twEnd !== null && etaS > st.twEnd ? etaS - st.twEnd : 0;
    const etdS = etaS + waitS + service;
    out.push({ id: st.id, etaS, etdS, waitS, lateS });
    t = etdS;
  }

  const last = stops.at(-1);
  const returnS = last ? Math.max(0, endS - last.etdS) : 0;
  return {
    stops: out,
    reloads: [...reloads.filter((r) => !touched.has(r.afterSeq)), ...newReloads].sort((a, b) => a.afterSeq - b.afterSeq),
    endS: last ? t + returnS : t,
  };
}
