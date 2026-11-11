"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { clusterPoints, type CustomerPin, samePlace } from "@/lib/customer-map";
import { bubbleHtml, CustomerPopup, DEFAULT_CENTER, dotHtml } from "./customer-map-parts";
import type { CustomerMapProps } from "./types";

const TILE_URL = process.env.NEXT_PUBLIC_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_TILE_ATTRIBUTION ?? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const bounds = (pins: CustomerPin[]) => L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));

function Fit({ pins, fitKey }: { pins: CustomerPin[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!pins.length) return;
    if (samePlace(pins)) map.setView([pins[0].lat, pins[0].lng], 15);
    else map.fitBounds(bounds(pins), { padding: [40, 40], maxZoom: 15 });
    // Re-frame only when a filter or area is picked, not when data refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

function Clusters({ pins }: { pins: CustomerPin[] }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const clusters = useMemo(() => clusterPoints(pins, zoom), [pins, zoom]);
  return clusters.map((c) => {
    const n = c.points.length;
    if (n === 1) {
      const p = c.points[0];
      const icon = L.divIcon({ className: "", html: dotHtml(p), iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -8] });
      return (
        <Marker key={c.key} position={[p.lat, p.lng]} icon={icon} title={p.name}>
          <Popup>
            <CustomerPopup pins={c.points} />
          </Popup>
        </Marker>
      );
    }
    const { size, html } = bubbleHtml(n);
    const icon = L.divIcon({ className: "", html, iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2] });
    // Customers at one address can't be split by zooming: list them instead.
    const listThem = samePlace(c.points) || zoom >= 18;
    return (
      <Marker
        key={c.key}
        position={[c.lat, c.lng]}
        icon={icon}
        zIndexOffset={n}
        eventHandlers={listThem ? {} : { click: () => map.fitBounds(bounds(c.points), { padding: [60, 60], maxZoom: 18 }) }}
      >
        {listThem && (
          <Popup>
            <CustomerPopup pins={c.points} />
          </Popup>
        )}
      </Marker>
    );
  });
}

function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export default function CustomerMapLeaflet({ pins, fitKey, fitPins, className }: CustomerMapProps) {
  const center = fitPins[0] ?? DEFAULT_CENTER;
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={10} scrollWheelZoom className={className} style={{ height: "100%", width: "100%" }}>
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
      <Fit pins={fitPins} fitKey={fitKey} />
      <InvalidateOnResize />
      <Clusters pins={pins} />
    </MapContainer>
  );
}
