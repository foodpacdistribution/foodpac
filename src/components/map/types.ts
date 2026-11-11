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
  /** The driver's next stop: drawn larger with a ring. */
  next?: boolean;
};

export type MapRoute = {
  id: string;
  color: string;
  path: [number, number][];
  /** Index into `path` the driver has got to: the part before it is drawn as already driven. */
  doneUpTo?: number;
};

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
  /** GPS accuracy of this position; a circle shows it when it is coarse. */
  accuracyM?: number | null;
  /** "11 min ago", shown under a stale marker. */
  ageLabel?: string;
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
  /** Makes stop pins draggable; called with the new position when one is dropped. */
  onMoveStop?: (id: string, lat: number, lng: number) => void;
  className?: string;
  /** Keep the current view when data refreshes (live tracking). */
  fitOnce?: boolean;
  /** Zoom used when there is only one thing to show (default 13; ~18 shows the building). */
  singleZoom?: number;
};

export type CustomerMapProps = {
  pins: import("@/lib/customer-map").CustomerPin[];
  /** The map re-frames to `fitPins` whenever this changes (a filter or an area was picked). */
  fitKey: string;
  fitPins: import("@/lib/customer-map").CustomerPin[];
  className?: string;
};
