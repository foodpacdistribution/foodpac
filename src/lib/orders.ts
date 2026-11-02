import { parseTime, parseTimeWindow } from "./time";

/** Fields an import column can map to. */
export const IMPORT_FIELDS = [
  { key: "orderNumber", label: "Order number", synonyms: ["order", "order no", "order number", "order id", "order #", "invoice", "reference", "ref", "so number"] },
  { key: "customerName", label: "Customer", synonyms: ["customer", "customer name", "name", "company", "business", "recipient", "client"] },
  { key: "address", label: "Address *", synonyms: ["address", "delivery address", "street", "street address", "address line 1", "address1", "ship to"] },
  { key: "suburb", label: "Suburb / city", synonyms: ["suburb", "city", "town", "locality"] },
  { key: "postcode", label: "Postcode", synonyms: ["postcode", "post code", "zip", "zip code", "postal code"] },
  { key: "phone", label: "Phone", synonyms: ["phone", "mobile", "contact", "contact number", "phone number", "tel"] },
  { key: "deliveryDate", label: "Delivery date", synonyms: ["date", "delivery date", "ship date", "due date"] },
  { key: "timeWindow", label: "Time window (e.g. 9am-12pm)", synonyms: ["time window", "window", "delivery window", "delivery time", "time slot", "slot"] },
  { key: "windowStart", label: "Window start", synonyms: ["window start", "earliest", "from", "start time"] },
  { key: "windowEnd", label: "Window end", synonyms: ["window end", "latest", "to", "end time", "deliver by"] },
  { key: "serviceMin", label: "Unload minutes", synonyms: ["service time", "service minutes", "unload", "unload time", "stop time", "duration"] },
  { key: "demand", label: "Quantity / units", synonyms: ["qty", "quantity", "units", "items", "cartons", "pallets", "parcels", "boxes"] },
  { key: "priority", label: "Priority", synonyms: ["priority", "urgent", "express"] },
  { key: "notes", label: "Notes", synonyms: ["notes", "note", "instructions", "delivery instructions", "comments", "comment"] },
  { key: "depot", label: "Depot (name)", synonyms: ["depot", "warehouse", "branch", "ship from", "dispatch from"] },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];
export type ImportRow = Partial<Record<ImportField, string>>;

export function guessMapping(headers: string[]): Partial<Record<ImportField, number>> {
  const norm = (s: string) => s.toLowerCase().replace(/[_\-.:#]+/g, " ").replace(/\s+/g, " ").trim();
  const mapping: Partial<Record<ImportField, number>> = {};
  const used = new Set<number>();
  // Exact synonym matches first, then "contains" matches.
  for (const pass of ["exact", "contains"] as const) {
    for (const f of IMPORT_FIELDS) {
      if (mapping[f.key] !== undefined) continue;
      const idx = headers.findIndex((h, i) => {
        if (used.has(i)) return false;
        const n = norm(h);
        return f.synonyms.some((s) => (pass === "exact" ? n === s : s.length > 3 && n.includes(s)));
      });
      if (idx >= 0) {
        mapping[f.key] = idx;
        used.add(idx);
      }
    }
  }
  return mapping;
}

/** Accepts 2026-10-27, 27/10/2026, 27-10-26 (day first, AU style). */
export function parseDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return fmt(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) return fmt(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}

function fmt(y: number, mo: number, d: number) {
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function validateImportRow(raw: ImportRow, defaultDate: string, index: number) {
  const t = (k: ImportField) => (raw[k] ?? "").toString().trim();
  const address = t("address");
  if (!address) return { ok: false as const, error: "Missing address" };

  const deliveryDate = t("deliveryDate") ? parseDate(t("deliveryDate")) : defaultDate;
  if (!deliveryDate) return { ok: false as const, error: `Unrecognised date "${t("deliveryDate")}"` };

  let windowStartMin: number | null = null;
  let windowEndMin: number | null = null;
  if (t("timeWindow")) {
    const w = parseTimeWindow(t("timeWindow"));
    if (!w) return { ok: false as const, error: `Unrecognised time window "${t("timeWindow")}"` };
    windowStartMin = w.start;
    windowEndMin = w.end;
  }
  if (t("windowStart")) {
    windowStartMin = parseTime(t("windowStart"));
    if (windowStartMin === null) return { ok: false as const, error: `Unrecognised time "${t("windowStart")}"` };
  }
  if (t("windowEnd")) {
    windowEndMin = parseTime(t("windowEnd"));
    if (windowEndMin === null) return { ok: false as const, error: `Unrecognised time "${t("windowEnd")}"` };
  }
  if (windowStartMin !== null && windowEndMin !== null && windowStartMin >= windowEndMin) {
    return { ok: false as const, error: "Window ends before it starts" };
  }

  const num = (k: ImportField) => {
    if (!t(k)) return null;
    const n = Number(t(k));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
  };
  const serviceMin = num("serviceMin");
  const demand = num("demand");
  if (Number.isNaN(serviceMin)) return { ok: false as const, error: `Invalid unload minutes "${t("serviceMin")}"` };
  if (Number.isNaN(demand)) return { ok: false as const, error: `Invalid quantity "${t("demand")}"` };

  const p = t("priority").toLowerCase();
  const priority = ["1", "high", "urgent", "yes", "y", "true", "express", "p1"].includes(p) ? 1 : 0;

  return {
    ok: true as const,
    value: {
      orderNumber: t("orderNumber") || `IMP-${deliveryDate.replaceAll("-", "")}-${String(index + 1).padStart(4, "0")}`,
      deliveryDate,
      customerName: t("customerName"),
      address,
      suburb: t("suburb") || null,
      postcode: t("postcode") || null,
      phone: t("phone") || null,
      windowStartMin,
      windowEndMin,
      serviceMin,
      demand: demand ?? 1,
      priority,
      notes: t("notes") || null,
    },
  };
}

/** Full address for the geocoder: appends suburb/postcode if the address line doesn't already contain them. */
export function geocodeQuery(o: { address: string; suburb: string | null; postcode: string | null }) {
  const parts = [o.address];
  const lower = o.address.toLowerCase();
  if (o.suburb && !lower.includes(o.suburb.toLowerCase())) parts.push(o.suburb);
  if (o.postcode && !lower.includes(o.postcode)) parts.push(o.postcode);
  return parts.join(", ");
}

export const FAILURE_REASONS = ["Customer unavailable", "Incorrect address", "Business closed", "Delivery refused", "Damaged goods", "Other"];

/** "lat,lng" rounded to ~10 cm, without float noise like 153.03179999999998. */
const coord = (p: { lat: number; lng: number }) => `${Number(p.lat.toFixed(6))},${Number(p.lng.toFixed(6))}`;

export function navigationUrls(lat: number, lng: number) {
  const c = coord({ lat, lng });
  return {
    // dir_action=navigate opens the Google Maps app straight into turn-by-turn from the current location.
    google: `https://www.google.com/maps/dir/?api=1&destination=${c}&travelmode=driving&dir_action=navigate`,
    apple: `https://maps.apple.com/?daddr=${c}&dirflg=d`,
  };
}

/** Google Maps allows up to 9 waypoints plus the destination in one link. */
export const MAX_NAV_POINTS = 10;

/**
 * One Google Maps link through the next stops in planned order, so the driver
 * doesn't have to come back to the app between nearby drops. Returns how many
 * stops the link covers; the driver opens the next batch afterwards.
 */
export function multiStopNavigation(points: { lat: number; lng: number }[]) {
  const batch = points.slice(0, MAX_NAV_POINTS);
  if (!batch.length) return null;
  const dest = batch[batch.length - 1];
  const waypoints = batch.slice(0, -1);
  const url =
    `https://www.google.com/maps/dir/?api=1&destination=${coord(dest)}&travelmode=driving&dir_action=navigate` +
    (waypoints.length ? `&waypoints=${waypoints.map(coord).join("%7C")}` : "");
  return { url, count: batch.length };
}

/** Beyond this, a delivery confirmed away from the address is flagged for staff and the customer. */
export const DELIVERY_PLACE_WARN_M = 150;

/** "12 m from the delivery address (GPS ±6 m)" for the place a delivery was confirmed. */
export function describeDeliveryPlace(distanceM: number | null, accuracyM: number | null) {
  if (distanceM === null) return null;
  const d = distanceM < 1000 ? `${Math.round(distanceM)} m` : `${(distanceM / 1000).toFixed(1)} km`;
  return `${d} from the delivery address${accuracyM !== null ? ` (GPS ±${Math.round(accuracyM)} m)` : ""}`;
}

/** Opens a point on Google Maps (for viewing, not navigating). */
export function mapPinUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}
