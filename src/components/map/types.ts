export type MapStop = {
  id: string;
  routeId: string | null;
  lat: number;
  lng: number;
  label: string;
  color: string;
  status: "pending" | "delivered" | "failed" | "unrouted";
  title: string;
  lines: string[];
  navigateUrl?: string;
};

export type MapRoute = { id: string; color: string; path: [number, number][] };

export type MapDepot = { id: string; lat: number; lng: number; name: string };

/** A driver's live GPS position. */
export type MapVehicle = {
  id: string;
  lat: number;
  lng: number;
  color: string;
  initials: string;
  stale: boolean;
  heading: number | null;
  title: string;
  lines: string[];
};

export type MapProps = {
  depots?: MapDepot[];
  stops: MapStop[];
  routes: MapRoute[];
  /** Driven GPS paths, drawn dashed under the planned routes. */
  trails?: MapRoute[];
  vehicles?: MapVehicle[];
  focusRouteId?: string | null;
  highlightStopId?: string | null;
  onSelectStop?: (id: string) => void;
  className?: string;
  /** Keep the current view when data refreshes (live tracking). */
  fitOnce?: boolean;
};
