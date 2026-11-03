import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type Role = "admin" | "dispatcher" | "driver" | "customer";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

/** Single row (id = 1): company and planning defaults. */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  companyName: text("company_name").notNull().default("My Company"),
  timezone: text("timezone").notNull().default("Australia/Brisbane"),
  defaultServiceMin: integer("default_service_min").notNull().default(10),
  defaultStartMin: integer("default_start_min").notNull().default(8 * 60),
  defaultMaxShiftMin: integer("default_max_shift_min").notNull().default(9 * 60),
  trafficFactor: real("traffic_factor").notNull().default(1.15),
  returnToDepot: boolean("return_to_depot").notNull().default(true),
  /** Time to reload at the depot between trips. */
  reloadMin: integer("reload_min").notNull().default(15),
  requirePhoto: boolean("require_photo").notNull().default(false),
  requireSignature: boolean("require_signature").notNull().default(false),
  /** Online shop. Money is in cents, ex GST. */
  deliveryFeeCents: integer("delivery_fee_cents").notNull().default(1500),
  freeDeliveryOverCents: integer("free_delivery_over_cents").notNull().default(30000),
  minOrderCents: integer("min_order_cents").notNull().default(0),
  /** Orders placed before this time (minutes after midnight) can go on the next delivery day. */
  orderCutoffMin: integer("order_cutoff_min").notNull().default(14 * 60),
  /** ISO weekdays we deliver on (1 = Monday). */
  deliveryDays: jsonb("delivery_days").$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
  /** Shown to customers who choose bank transfer. */
  bankDetails: text("bank_details").notNull().default(""),
});

export const depots = pgTable("depots", {
  id: id(),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const drivers = pgTable("drivers", {
  id: id(),
  name: text("name").notNull(),
  phone: text("phone"),
  vehicle: text("vehicle"),
  /** Units (parcels / pallets). null = unlimited. */
  capacity: integer("capacity"),
  /** Minutes after midnight. null = planner default. */
  shiftStartMin: integer("shift_start_min"),
  maxShiftMin: integer("max_shift_min"),
  /** Home depot: routes start, reload and end here. null = first active depot. */
  depotId: uuid("depot_id").references(() => depots.id, { onDelete: "set null" }),
  /** >1 lets the vehicle return to its depot to reload when capacity runs out. */
  maxTrips: integer("max_trips").notNull().default(1),
  color: text("color").notNull().default("#2563eb"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** A business we deliver to. Orders are linked to it so its staff can follow them in the customer portal. */
export const customers = pgTable("customers", {
  id: id(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  abn: text("abn"),
  active: boolean("active").notNull().default(true),
  /** Self-registered customers wait for staff approval before they see prices or order. */
  approved: boolean("approved").notNull().default(true),
  /** prepay = card or bank transfer up front; netN = invoice due N days after delivery. */
  paymentTerms: text("payment_terms").$type<PaymentTerms>().notNull().default("prepay"),
  /** Max unpaid invoice balance for account customers. null = no limit. */
  creditLimitCents: integer("credit_limit_cents"),
  createdAt: createdAt(),
});

export type PaymentTerms = "prepay" | "net7" | "net14" | "net30";

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<Role>().notNull(),
  driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
  /** Customer logins only: the business whose orders they can see. */
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
  /** Interface language ("en" | "zh"); null = whatever the device last chose. */
  locale: text("locale"),
  createdAt: createdAt(),
});

export type OrderStatus = "pending" | "planned" | "dispatched" | "delivered" | "failed";
export type GeocodeStatus = "pending" | "ok" | "approximate" | "failed";

export const orders = pgTable(
  "orders",
  {
    id: id(),
    orderNumber: text("order_number").notNull(),
    deliveryDate: date("delivery_date", { mode: "string" }).notNull(),
    customerName: text("customer_name").notNull().default(""),
    phone: text("phone"),
    address: text("address").notNull(),
    suburb: text("suburb"),
    postcode: text("postcode"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    geocodeStatus: text("geocode_status").$type<GeocodeStatus>().notNull().default("pending"),
    geocodeLabel: text("geocode_label"),
    /** Minutes after midnight, local time. */
    windowStartMin: integer("window_start_min"),
    windowEndMin: integer("window_end_min"),
    /** null = planner default. */
    serviceMin: integer("service_min"),
    demand: integer("demand").notNull().default(1),
    priority: integer("priority").notNull().default(0),
    notes: text("notes"),
    pinnedDriverId: uuid("pinned_driver_id").references(() => drivers.id, { onDelete: "set null" }),
    /** Ship-from depot: only drivers based there can take it. null = any depot. */
    depotId: uuid("depot_id").references(() => depots.id, { onDelete: "set null" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    /** Set automatically when the order's customer name or phone matches a customer. */
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    status: text("status").$type<OrderStatus>().notNull().default("pending"),
    /** manual | import | api | feed:<name> */
    source: text("source").notNull().default("manual"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_number_date_uq").on(t.orderNumber, t.deliveryDate),
    index("orders_date_idx").on(t.deliveryDate),
    index("orders_customer_idx").on(t.customerId),
  ],
);

/** Sign-in attempts per email and per IP in a fixed window, to stop password guessing. */
export const loginThrottle = pgTable("login_throttle", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

/** Geocoding results keyed by normalised address, so re-imports don't re-bill. */
export const geocodeCache = pgTable("geocode_cache", {
  query: text("query").primaryKey(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  label: text("label"),
  status: text("status").$type<GeocodeStatus>().notNull(),
  provider: text("provider").notNull(),
  createdAt: createdAt(),
});

export type PlanStatus = "draft" | "dispatched";

/** Everything needed to re-time a plan after manual edits without re-fetching the matrix. */
export type PlanContext = {
  nodeKeys: string[];
  durations: number[][];
  distances: number[][];
  matrixSource: "osrm" | "estimate";
  vehicles: {
    driverId: string;
    startKey: string;
    endKey: string | null;
    startTime: number;
    maxDuration: number;
    capacity: number | null;
    /** Where reloads happen. Optional only for plans created before multi-depot. */
    depotKey?: string;
    firstTripCapacity?: number | null;
    maxTrips?: number;
    reloadTime?: number;
  }[];
  objective: "balanced" | "time" | "distance";
  trafficFactor: number;
  defaultServiceMin: number;
};

export type PlanSummary = {
  orders: number;
  assigned: number;
  unassigned: number;
  distance: number;
  driveTime: number;
  serviceTime: number;
  waitTime: number;
  driverTime: number;
  fleetStart: number | null;
  fleetFinish: number | null;
  lateStops: number;
  overtimeRoutes: number;
};

export const plans = pgTable("plans", {
  id: id(),
  deliveryDate: date("delivery_date", { mode: "string" }).notNull().unique(),
  status: text("status").$type<PlanStatus>().notNull().default("draft"),
  context: jsonb("context").$type<PlanContext>(),
  summary: jsonb("summary").$type<PlanSummary>(),
  /** Same metrics for the naive "spreadsheet order" plan, for the before/after card. */
  baseline: jsonb("baseline").$type<PlanSummary>(),
  unassigned: jsonb("unassigned").$type<{ orderId: string; reason: string }[]>().notNull().default([]),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RouteStatus = "planned" | "in_progress" | "completed";

export const shipmentNo = pgSequence("shipment_no", { startWith: 1001 });
export type RouteReload = { afterSeq: number; arrivalS: number; departureS: number };

export const routes = pgTable(
  "routes",
  {
    id: id(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "cascade" }),
    /** Seconds after midnight. */
    startS: integer("start_s").notNull(),
    endS: integer("end_s").notNull(),
    distanceM: integer("distance_m").notNull(),
    driveS: integer("drive_s").notNull(),
    serviceS: integer("service_s").notNull(),
    waitS: integer("wait_s").notNull(),
    overtimeS: integer("overtime_s").notNull().default(0),
    overCapacity: integer("over_capacity").notNull().default(0),
    trips: integer("trips").notNull().default(1),
    /** Depot reload visits between trips: after which stop (seq), arrival and departure (s). */
    reloads: jsonb("reloads").$type<RouteReload[]>().notNull().default([]),
    /** [lat, lng] pairs of the road path. */
    geometry: jsonb("geometry").$type<[number, number][]>(),
    status: text("status").$type<RouteStatus>().notNull().default("planned"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Shipment number on the driver's docket, e.g. SH-1001. */
    number: text("number").notNull().default(sql`'SH-' || nextval('shipment_no')`),
    /** When this route was sent to the driver's phone (per shipment, or for the whole day from the planner). */
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("routes_plan_driver_uq").on(t.planId, t.driverId), uniqueIndex("routes_number_uq").on(t.number)],
);

export type StopStatus = "pending" | "delivered" | "failed";

export const routeStops = pgTable(
  "route_stops",
  {
    id: id(),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    trip: integer("trip").notNull().default(1),
    etaS: integer("eta_s").notNull(),
    etdS: integer("etd_s").notNull(),
    waitS: integer("wait_s").notNull().default(0),
    lateS: integer("late_s").notNull().default(0),
    legDistanceM: integer("leg_distance_m").notNull(),
    legDriveS: integer("leg_drive_s").notNull(),
    status: text("status").$type<StopStatus>().notNull().default("pending"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  // Not unique per order: a failed delivery rescheduled to another day gets a new stop, the old one stays as history.
  (t) => [index("route_stops_route_idx").on(t.routeId), index("route_stops_order_idx").on(t.orderId)],
);

export const deliveryEvents = pgTable(
  "delivery_events",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    type: text("type").$type<"route_started" | "delivered" | "failed">().notNull(),
    reason: text("reason"),
    recipient: text("recipient"),
    note: text("note"),
    /** Where the phone was when the driver confirmed the outcome (fresh high-accuracy fix). */
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    accuracyM: real("accuracy_m"),
    createdAt: createdAt(),
  },
  (t) => [index("delivery_events_order_idx").on(t.orderId)],
);

export type RunSnapshot = { driverId: string; orderIds: string[] }[];

/** Every optimisation and manual edit, so earlier versions of a plan stay visible. */
export const optimisationRuns = pgTable(
  "optimisation_runs",
  {
    id: id(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"optimise" | "manual_edit">().notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    summary: jsonb("summary").$type<PlanSummary>().notNull(),
    baseline: jsonb("baseline").$type<PlanSummary>(),
    snapshot: jsonb("snapshot").$type<RunSnapshot>().notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>(),
    solverMs: integer("solver_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("optimisation_runs_plan_idx").on(t.planId)],
);

/** GPS fixes sent by the driver app, only while that driver's route is in progress. */
export const vehicleLocations = pgTable(
  "vehicle_locations",
  {
    id: id(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "cascade" }),
    routeId: uuid("route_id").references(() => routes.id, { onDelete: "set null" }),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    accuracyM: real("accuracy_m"),
    speedMps: real("speed_mps"),
    heading: real("heading"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("vehicle_locations_driver_time_idx").on(t.driverId, t.recordedAt), index("vehicle_locations_route_idx").on(t.routeId, t.recordedAt)],
);

/** Proof-of-delivery photos and signatures, stored in the database (see lib/proofs.ts to move to object storage). */
export const deliveryProofs = pgTable(
  "delivery_proofs",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").references(() => deliveryEvents.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"photo" | "signature">().notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    data: bytea("data").notNull(),
    /** SHA-256 of `data` when it was received, so any later change to the image can be detected. */
    sha256: text("sha256"),
    createdAt: createdAt(),
  },
  (t) => [index("delivery_proofs_order_idx").on(t.orderId)],
);

/** Keys for the /api/v1 order API. Only a SHA-256 hash of the key is stored. */
export const apiKeys = pgTable("api_keys", {
  id: id(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export type FeedResult = { at: string; ok: boolean; message: string; inserted: number; updated: number; skipped: number; errors: number };

/** A CSV/JSON URL that is pulled on a schedule (cron) or on demand to sync orders. */
export const orderFeeds = pgTable("order_feeds", {
  id: id(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  format: text("format").$type<"csv" | "json">().notNull().default("csv"),
  /** Optional Authorization header value for the feed URL. */
  authHeader: text("auth_header"),
  /** Our field → their column/key name. Empty = auto-detect from headers. */
  mapping: jsonb("mapping").$type<Record<string, string>>().notNull().default({}),
  /** Where the delivery date comes from when a row has none. */
  dateMode: text("date_mode").$type<"today" | "tomorrow">().notNull().default("today"),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastResult: jsonb("last_result").$type<FeedResult>(),
  createdAt: createdAt(),
});

export type EnquiryStatus = "new" | "contacted" | "closed";

/** Messages sent from the contact form on the public website. */
export const enquiries = pgTable(
  "enquiries",
  {
    id: id(),
    name: text("name").notNull(),
    business: text("business"),
    email: text("email").notNull(),
    phone: text("phone"),
    suburb: text("suburb"),
    message: text("message").notNull(),
    status: text("status").$type<EnquiryStatus>().notNull().default("new"),
    createdAt: createdAt(),
  },
  (t) => [index("enquiries_created_idx").on(t.createdAt)],
);

// ---------------------------------------------------------------------------
// Online shop
// ---------------------------------------------------------------------------

export const products = pgTable(
  "products",
  {
    id: id(),
    sku: text("sku").notNull().unique(),
    barcode: text("barcode"),
    name: text("name").notNull(),
    category: text("category").notNull().default("Other"),
    description: text("description").notNull().default(""),
    /** e.g. "10 kg / carton", "1000 pcs / carton". */
    packSize: text("pack_size").notNull().default(""),
    unit: text("unit").notNull().default("carton"),
    /** List price per unit in cents, ex GST. Customers can have their own price. */
    priceCents: integer("price_cents").notNull(),
    gst: boolean("gst").notNull().default(true),
    minQty: integer("min_qty").notNull().default(1),
    /** On hand, not yet reserved by an order. Reserved when an order is placed, given back if it's cancelled. */
    stock: integer("stock").notNull().default(0),
    image: bytea("image"),
    imageMime: text("image_mime"),
    featured: boolean("featured").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    /** Bumped on every edit; part of the image URL so photos can be cached for good. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("products_category_idx").on(t.category)],
);

/** Customer-specific price for one product, in cents ex GST. */
export const customerPrices = pgTable(
  "customer_prices",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    priceCents: integer("price_cents").notNull(),
  },
  (t) => [uniqueIndex("customer_prices_uq").on(t.customerId, t.productId)],
);

export const customerAddresses = pgTable("customer_addresses", {
  id: id(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  label: text("label").notNull().default(""),
  recipient: text("recipient").notNull().default(""),
  phone: text("phone"),
  address: text("address").notNull(),
  instructions: text("instructions"),
  createdAt: createdAt(),
});

export const cartItems = pgTable(
  "cart_items",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    qty: integer("qty").notNull(),
  },
  (t) => [uniqueIndex("cart_items_uq").on(t.customerId, t.productId)],
);

export type SalesStatus = "pending" | "confirmed" | "cancelled";
export type PaymentStatus = "unpaid" | "paid" | "failed" | "refunded";
export type PaymentMethod = "card" | "bank_transfer" | "invoice";
export type FulfilmentStatus = "new" | "picking" | "packed" | "loaded";

export const salesOrderNo = pgSequence("sales_order_no", { startWith: 10001 });

/**
 * A purchase from the shop. Order, payment and warehouse status are kept apart; delivery
 * status comes from the linked delivery order (orders table) that the planner routes.
 */
export const salesOrders = pgTable(
  "sales_orders",
  {
    id: id(),
    number: text("number").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").$type<SalesStatus>().notNull().default("pending"),
    paymentStatus: text("payment_status").$type<PaymentStatus>().notNull().default("unpaid"),
    paymentMethod: text("payment_method").$type<PaymentMethod>().notNull(),
    fulfilment: text("fulfilment").$type<FulfilmentStatus>().notNull().default("new"),
    subtotalCents: integer("subtotal_cents").notNull(),
    deliveryFeeCents: integer("delivery_fee_cents").notNull(),
    gstCents: integer("gst_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    deliveryDate: date("delivery_date", { mode: "string" }).notNull(),
    recipient: text("recipient").notNull(),
    phone: text("phone"),
    address: text("address").notNull(),
    instructions: text("instructions"),
    windowStartMin: integer("window_start_min"),
    windowEndMin: integer("window_end_min"),
    notes: text("notes"),
    /** Invoice due date for account customers. */
    dueDate: date("due_date", { mode: "string" }),
    deliveryOrderId: uuid("delivery_order_id").references(() => orders.id, { onDelete: "set null" }),
    stripeSessionId: text("stripe_session_id"),
    /** Sent with the checkout form so a double-click or retry can't place the order twice. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("sales_orders_customer_idx").on(t.customerId),
    index("sales_orders_created_idx").on(t.createdAt),
    // Joins from a delivery back to its shop order (shipments, dockets, sales list).
    index("sales_orders_delivery_order_idx").on(t.deliveryOrderId),
    // "Waiting on the office" badge and confirmed orders missing a delivery.
    index("sales_orders_status_idx").on(t.status, t.fulfilment),
  ],
);

export const salesOrderItems = pgTable(
  "sales_order_items",
  {
    id: id(),
    salesOrderId: uuid("sales_order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    packSize: text("pack_size").notNull(),
    unit: text("unit").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    qty: integer("qty").notNull(),
    gst: boolean("gst").notNull(),
    lineCents: integer("line_cents").notNull(),
  },
  (t) => [index("sales_order_items_order_idx").on(t.salesOrderId)],
);
