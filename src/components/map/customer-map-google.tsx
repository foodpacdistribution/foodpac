"use client";

import { AdvancedMarker, AdvancedMarkerAnchorPoint, APIProvider, InfoWindow, Map, useMap } from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useState } from "react";
import { clusterPoints, type CustomerPin, samePlace } from "@/lib/customer-map";
import { bubbleHtml, CustomerPopup, DEFAULT_CENTER, dotHtml } from "./customer-map-parts";
import type { CustomerMapProps } from "./types";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID ?? "DEMO_MAP_ID";

type Selected = { lat: number; lng: number; pins: CustomerPin[]; offset: number } | null;

function boundsOf(pins: CustomerPin[]) {
  const b = new google.maps.LatLngBounds();
  pins.forEach((p) => b.extend({ lat: p.lat, lng: p.lng }));
  return b;
}

function Fit({ pins, fitKey }: { pins: CustomerPin[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !pins.length) return;
    if (samePlace(pins)) {
      map.setCenter({ lat: pins[0].lat, lng: pins[0].lng });
      map.setZoom(15);
    } else {
      map.fitBounds(boundsOf(pins), 40);
    }
    // Re-frame only when a filter or area is picked, not when data refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}

function Clusters({ pins, onSelect }: { pins: CustomerPin[]; onSelect: (s: Selected) => void }) {
  const map = useMap();
  const [zoom, setZoom] = useState(10);
  useEffect(() => {
    if (!map) return;
    const update = () => setZoom(Math.round(map.getZoom() ?? 10));
    update();
    const l = map.addListener("zoom_changed", update);
    return () => l.remove();
  }, [map]);
  const clusters = useMemo(() => clusterPoints(pins, zoom), [pins, zoom]);
  return clusters.map((c) => {
    const n = c.points.length;
    if (n === 1) {
      const p = c.points[0];
      return (
        <AdvancedMarker key={c.key} position={{ lat: p.lat, lng: p.lng }} anchorPoint={AdvancedMarkerAnchorPoint.CENTER} title={p.name} onClick={() => onSelect({ lat: p.lat, lng: p.lng, pins: c.points, offset: 10 })}>
          <div dangerouslySetInnerHTML={{ __html: dotHtml(p) }} />
        </AdvancedMarker>
      );
    }
    const { size, html } = bubbleHtml(n);
    // Customers at one address can't be split by zooming: list them instead.
    const listThem = samePlace(c.points) || zoom >= 18;
    return (
      <AdvancedMarker
        key={c.key}
        position={{ lat: c.lat, lng: c.lng }}
        zIndex={n}
        // Centre the bubble on its position (advanced markers sit above it by default).
        anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
        onClick={() => {
          if (listThem) onSelect({ lat: c.lat, lng: c.lng, pins: c.points, offset: size / 2 });
          else map?.fitBounds(boundsOf(c.points), 60);
        }}
      >
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </AdvancedMarker>
    );
  });
}

export default function CustomerMapGoogle({ pins, fitKey, fitPins, className }: CustomerMapProps) {
  const [selected, setSelected] = useState<Selected>(null);
  const center = fitPins[0] ? { lat: fitPins[0].lat, lng: fitPins[0].lng } : DEFAULT_CENTER;
  return (
    <APIProvider apiKey={API_KEY} language="en" region="AU">
      <Map
        className={className}
        style={{ width: "100%", height: "100%" }}
        mapId={MAP_ID}
        defaultCenter={center}
        defaultZoom={10}
        gestureHandling="greedy"
        mapTypeControl={false}
        streetViewControl={false}
        fullscreenControl
        clickableIcons={false}
        onClick={() => setSelected(null)}
      >
        <Fit pins={fitPins} fitKey={fitKey} />
        <Clusters pins={pins} onSelect={setSelected} />
        {selected && (
          <InfoWindow position={{ lat: selected.lat, lng: selected.lng }} pixelOffset={[0, -selected.offset]} onCloseClick={() => setSelected(null)} headerDisabled>
            <CustomerPopup pins={selected.pins} />
          </InfoWindow>
        )}
      </Map>
    </APIProvider>
  );
}
