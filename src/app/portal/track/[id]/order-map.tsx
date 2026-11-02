"use client";

import { DeliveryMap, type MapStop } from "@/components/map";
import type { PortalOrder } from "@/lib/portal";

export function OrderMap({ order: o }: { order: PortalOrder }) {
  const stops: MapStop[] = [];
  if (o.point) {
    stops.push({
      id: "address",
      routeId: null,
      ...o.point,
      label: "★",
      color: "#1e6b44",
      status: o.stage === "delivered" ? "delivered" : "pending",
      title: "Your delivery address",
      lines: [o.address],
    });
  }
  if (o.outcome?.place) {
    stops.push({
      id: "confirmed",
      routeId: null,
      lat: o.outcome.place.lat,
      lng: o.outcome.place.lng,
      label: "✓",
      color: o.outcome.type === "delivered" ? "#258a56" : "#dc2626",
      status: o.outcome.type,
      title: o.outcome.type === "delivered" ? "Delivery confirmed here" : "Delivery attempted here",
      lines: o.outcome.place.accuracyM !== null ? [`GPS accuracy ±${Math.round(o.outcome.place.accuracyM)} m`] : [],
    });
  }
  return (
    <DeliveryMap
      className="h-72 sm:h-80"
      fitOnce={o.stage === "out_for_delivery"}
      depots={o.depot ? [{ id: "depot", ...o.depot }] : []}
      stops={stops}
      routes={[]}
      trails={o.trail.length > 1 ? [{ id: "trail", color: "#1e6b44", path: o.trail }] : []}
      vehicles={
        o.van
          ? [
              {
                id: "van",
                lat: o.van.lat,
                lng: o.van.lng,
                color: "#e4572e",
                initials: o.driverFirstName?.[0] ?? "F",
                stale: o.van.stale,
                heading: o.van.heading,
                title: o.driverFirstName ? `${o.driverFirstName} · Foodpac van` : "Foodpac van",
                lines: [],
              },
            ]
          : []
      }
    />
  );
}
