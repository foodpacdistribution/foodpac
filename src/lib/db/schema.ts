import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgSequence,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type Role = "admin" | "dispatcher" | "driver" | "customer" | "sales";

/** Where a customer is in the sales process: a fresh lead, keen to work with us, in talks, or won. */
export type SalesStage = "new" | "interested" | "negotiating" | "won";

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
  /** Home page: also show the posters written into the website (content.ts) after the uploaded ones. */
  builtInPosters: boolean("built_in_posters").notNull().default(true),
  /** Business details on the website, invoices and emails. Empty = what site-info.ts says. */
  contactPhone: text("contact_phone").notNull().default(""),
  contactEmail: text("contact_email").notNull().default(""),
  contactAddress: text("contact_address").notNull().default(""),
  abn: text("abn").notNull().default(""),
  openingHours: text("opening_hours").notNull().default(""),
  /** Sales pipeline: remind sales staff about a customer who hasn't ordered for this many days. */
  quietDays: integer("quiet_days").notNull().default(14),
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

/** Numbers for customer codes the app makes up (C10001, C10002, …). */
export const customerCodeNo = pgSequence("customer_code_no", { startWith: 10001 });

/** A business we deliver to. Orders are linked to it so its staff can follow them in the customer portal. */
export const customers = pgTable("customers", {
  id: id(),
  /**
   * The customer's account code: kept from the old system when imported, otherwise the database
   * gives the next C-number. Unique, ignoring case (customers_code_key).
   */
  code: text("code").notNull().default(sql`'C' || nextval('customer_code_no')`),
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
  /** Sales pipeline, set by sales staff. */
  salesStage: text("sales_stage").$type<SalesStage>().notNull().default("new"),
  salesStageAt: timestamp("sales_stage_at", { withTimezone: true }).notNull().defaultNow(),
  /** The salesperson looking after this customer (whoever added it, or first moved it along). */
  salesRepId: uuid("sales_rep_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  /** A reminder to get back in touch on this day (and a note on what about). */
  followUpOn: date("follow_up_on", { mode: "string" }),
  followUpNote: text("follow_up_note"),
  /** Last time someone marked a follow-up done; quiet-customer reminders wait a full quiet spell after it. */
  contactedAt: timestamp("contacted_at", { withTimezone: true }),
  /**
   * Where the address is, for the customer map. `geocodedAddress` is the address these were
   * found for: when it no longer matches `address`, the customer is placed again.
   */
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  geocodeStatus: text("geocode_status").$type<Exclude<GeocodeStatus, "pending">>(),
  geocodeLabel: text("geocode_label"),
  geocodedAddress: text("geocoded_address"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("customers_code_key").on(sql`lower(${t.code})`)]);

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

/**
 * Home page posters uploaded in the back office, shown in `sortOrder` before the built-in ones.
 * With a headline the words are laid over the picture; without one the picture is the whole
 * poster (words designed into it) and the poster itself is the link.
 */
export const posters = pgTable("posters", {
  id: id(),
  /** Its name in the back office, on the tab under the carousel, and the picture's alt text. */
  name: text("name").notNull(),
  eyebrow: text("eyebrow").notNull().default(""),
  headline: text("headline").notNull().default(""),
  text: text("text").notNull().default(""),
  buttonLabel: text("button_label").notNull().default(""),
  /** A page on the site ("/categories/cups-and-lids") or a full https:// address. */
  href: text("href").notNull().default(""),
  /** Which part of the picture stays in view when a screen crops it: left, center or right. */
  focus: text("focus").$type<"left" | "center" | "right">().notNull().default("center"),
  image: bytea("image").notNull(),
  imageMime: text("image_mime").notNull(),
  /** Optional upright version for phones. */
  mobileImage: bytea("mobile_image"),
  mobileImageMime: text("mobile_image_mime"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  /** Optional first and last day it shows (in the business's time zone), for promotions. */
  startsOn: date("starts_on", { mode: "string" }),
  endsOn: date("ends_on", { mode: "string" }),
  createdAt: createdAt(),
  /** Bumped on every edit; part of the picture URLs so they can be cached for good. */
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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

/** Products a customer keeps on their own list ("My list") to reorder from quickly. */
export const favourites = pgTable(
  "favourites",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("favourites_uq").on(t.customerId, t.productId)],
);

export type SalesStatus = "pending" | "confirmed" | "cancelled";
export type PaymentStatus = "unpaid" | "paid" | "failed" | "refunded";
export type PaymentMethod = "card" | "bank_transfer" | "invoice";
export type FulfilmentStatus = "new" | "picking" | "packed" | "loaded";
/** proforma = lines and prices can still change; final = the tax invoice, locked. */
export type InvoiceStatus = "proforma" | "final";

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
    invoiceStatus: text("invoice_status").$type<InvoiceStatus>().notNull().default("proforma"),
    /** When the invoice was made final: the tax invoice's issue date. */
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    /** Last time the final invoice was emailed to the customer, and to which address. */
    invoiceSentAt: timestamp("invoice_sent_at", { withTimezone: true }),
    invoiceSentTo: text("invoice_sent_to"),
    /** Store credit used to pay part (or all) of this order. Amount due = total − this. */
    creditAppliedCents: integer("credit_applied_cents").notNull().default(0),
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
    /**
     * Ordered by staff while short: this many of `qty` are still waiting for stock (the rest is
     * reserved). Goods received go to waiting lines first, oldest order first.
     */
    backorderQty: integer("backorder_qty").notNull().default(0),
  },
  (t) => [index("sales_order_items_order_idx").on(t.salesOrderId), index("sales_order_items_product_idx").on(t.productId)],
);

/** draft = still being worked on; sent = with the customer; accepted = became a sales order; declined = they said no. */
export type QuoteStatus = "draft" | "sent" | "accepted" | "declined";

export const quoteNo = pgSequence("quote_no", { startWith: 10001 });

/**
 * A quotation for one customer: products, quantities and the prices offered, valid until a date.
 * Nothing is reserved or delivered; once the customer says yes it becomes a sales order (opened in
 * the order form with these lines and prices) and links to it.
 */
export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    number: text("number").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    status: text("status").$type<QuoteStatus>().notNull().default("draft"),
    validUntil: date("valid_until", { mode: "string" }).notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    deliveryFeeCents: integer("delivery_fee_cents").notNull(),
    gstCents: integer("gst_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    /** Printed on the quote (terms, lead times…). */
    notes: text("notes"),
    /** Office only. */
    internalNote: text("internal_note"),
    /** The sales order it became. */
    salesOrderId: uuid("sales_order_id").references(() => salesOrders.id, {
      onDelete: "set null",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentTo: text("sent_to"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("quotes_customer_idx").on(t.customerId),
    index("quotes_created_idx").on(t.createdAt),
  ],
);

export const quoteItems = pgTable(
  "quote_items",
  {
    id: id(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    packSize: text("pack_size").notNull(),
    unit: text("unit").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    qty: integer("qty").notNull(),
    gst: boolean("gst").notNull(),
    lineCents: integer("line_cents").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("quote_items_quote_idx").on(t.quoteId)],
);

// ---------------------------------------------------------------------------
// Purchasing: we buy from suppliers and, when goods are faulty or not needed, we ask the
// supplier to take them back (purchase return). Suppliers never send returns to us, and they
// give no credit: every purchase is paid, every accepted return is refunded or exchanged.
// Money is NUMERIC dollars (ex GST unless it says otherwise); quantities are NUMERIC units.
// ---------------------------------------------------------------------------

const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });
const qty = (name: string) => numeric(name, { precision: 12, scale: 3, mode: "number" });
/** Supplier prices can run to fractions of a cent per unit. */
const unitCost = (name: string) => numeric(name, { precision: 12, scale: 4, mode: "number" });
const createdBy = () => uuid("created_by").references(() => users.id, { onDelete: "set null" });

export const suppliers = pgTable("suppliers", {
  id: id(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  abn: text("abn"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const purchaseOrderNo = pgSequence("purchase_order_no", { startWith: 10001 });
export const goodsReceiptNo = pgSequence("goods_receipt_no", { startWith: 10001 });
export const purchaseReturnNo = pgSequence("purchase_return_no", { startWith: 10001 });
export const supplierPaymentNo = pgSequence("supplier_payment_no", { startWith: 10001 });
export const supplierRefundNo = pgSequence("supplier_refund_no", { startWith: 10001 });

/**
 * draft → sent (to the supplier) → confirmed (supplier said yes) → partially_received → received.
 * closed = part received and the rest won't come; cancelled = nothing received.
 */
export type PurchaseOrderStatus = "draft" | "sent" | "confirmed" | "partially_received" | "received" | "closed" | "cancelled";

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: id(),
    poNumber: text("po_number").notNull().unique(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    status: text("status").$type<PurchaseOrderStatus>().notNull().default("draft"),
    orderDate: date("order_date", { mode: "string" }).notNull(),
    expectedDate: date("expected_date", { mode: "string" }),
    supplierReference: text("supplier_reference"),
    notes: text("notes"),
    subtotal: money("subtotal").notNull().default(0),
    gst: money("gst").notNull().default(0),
    total: money("total").notNull().default(0),
    createdBy: createdBy(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("purchase_orders_supplier_idx").on(t.supplierId), index("purchase_orders_status_idx").on(t.status)],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: id(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    orderedQty: qty("ordered_qty").notNull(),
    /** Sum of posted goods receipts against this line. */
    receivedQty: qty("received_qty").notNull().default(0),
    unitCost: unitCost("unit_cost").notNull(),
    gst: boolean("gst").notNull(),
    lineTotal: money("line_total").notNull(),
  },
  (t) => [
    index("purchase_order_items_po_idx").on(t.purchaseOrderId),
    check("purchase_order_items_qty_ck", sql`${t.orderedQty} > 0 AND ${t.receivedQty} >= 0 AND ${t.receivedQty} <= ${t.orderedQty} AND ${t.unitCost} >= 0`),
  ],
);

/** draft = being checked in the warehouse (editable); posted = in stock, locked. */
export type GoodsReceiptStatus = "draft" | "posted" | "cancelled";

/** Goods arriving: against a purchase order, or replacements the supplier sends for a purchase return. */
export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: id(),
    grnNumber: text("grn_number").notNull().unique(),
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, { onDelete: "restrict" }),
    /** Set when these are replacement goods for an exchange. */
    purchaseReturnId: uuid("purchase_return_id").references((): AnyPgColumn => purchaseReturns.id, { onDelete: "restrict" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    status: text("status").$type<GoodsReceiptStatus>().notNull().default("draft"),
    receiptDate: date("receipt_date", { mode: "string" }).notNull(),
    deliveryReference: text("delivery_reference"),
    notes: text("notes"),
    createdBy: createdBy(),
    postedBy: uuid("posted_by").references(() => users.id, { onDelete: "set null" }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("goods_receipts_po_idx").on(t.purchaseOrderId),
    index("goods_receipts_return_idx").on(t.purchaseReturnId),
    index("goods_receipts_supplier_idx").on(t.supplierId),
    check("goods_receipts_source_ck", sql`(${t.purchaseOrderId} IS NULL) <> (${t.purchaseReturnId} IS NULL)`),
  ],
);

export const goodsReceiptItems = pgTable(
  "goods_receipt_items",
  {
    id: id(),
    goodsReceiptId: uuid("goods_receipt_id")
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: "cascade" }),
    purchaseOrderItemId: uuid("purchase_order_item_id").references(() => purchaseOrderItems.id, { onDelete: "restrict" }),
    purchaseReturnItemId: uuid("purchase_return_item_id").references((): AnyPgColumn => purchaseReturnItems.id, { onDelete: "restrict" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    /** Accepted into stock. Goods refused at the door aren't received at all. */
    receivedQty: qty("received_qty").notNull(),
    unitCost: unitCost("unit_cost").notNull(),
    gst: boolean("gst").notNull(),
    notes: text("notes"),
  },
  (t) => [
    index("goods_receipt_items_grn_idx").on(t.goodsReceiptId),
    index("goods_receipt_items_po_item_idx").on(t.purchaseOrderItemId),
    check("goods_receipt_items_qty_ck", sql`${t.receivedQty} >= 0`),
  ],
);

/** What the supplier said to our return request. */
export type SupplierResponseStatus = "pending" | "accepted" | "partially_accepted" | "rejected";
/** open = waiting on the supplier or to go out; dispatched = goods have left; closed = refunded, exchanged or rejected. */
export type PurchaseReturnStatus = "open" | "dispatched" | "closed" | "cancelled";
export type ReturnResolution = "refund" | "exchange";

/** Our request to send goods back to the supplier, against the goods receipt they came in on. */
export const purchaseReturns = pgTable(
  "purchase_returns",
  {
    id: id(),
    returnNumber: text("return_number").notNull().unique(),
    goodsReceiptId: uuid("goods_receipt_id")
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: "restrict" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    returnDate: date("return_date", { mode: "string" }).notNull(),
    returnReason: text("return_reason").notNull(),
    status: text("status").$type<PurchaseReturnStatus>().notNull().default("open"),
    supplierStatus: text("supplier_status").$type<SupplierResponseStatus>().notNull().default("pending"),
    supplierResponse: text("supplier_response"),
    /** Refund or exchange, agreed with the supplier when they accept. */
    refundMethod: text("refund_method").$type<ReturnResolution>(),
    /** Refunds actually received (sum of supplier_refunds), incl. GST. */
    refundAmount: money("refund_amount").notNull().default(0),
    notes: text("notes"),
    createdBy: createdBy(),
    /** Who recorded the supplier's answer. */
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    dispatchedBy: uuid("dispatched_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("purchase_returns_grn_idx").on(t.goodsReceiptId),
    index("purchase_returns_supplier_idx").on(t.supplierId),
    index("purchase_returns_status_idx").on(t.status),
    check("purchase_returns_refund_ck", sql`${t.refundAmount} >= 0`),
  ],
);

export const purchaseReturnItems = pgTable(
  "purchase_return_items",
  {
    id: id(),
    purchaseReturnId: uuid("purchase_return_id")
      .notNull()
      .references(() => purchaseReturns.id, { onDelete: "cascade" }),
    goodsReceiptItemId: uuid("goods_receipt_item_id")
      .notNull()
      .references(() => goodsReceiptItems.id, { onDelete: "restrict" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    requestedQty: qty("requested_qty").notNull(),
    /** null until the supplier answers. */
    acceptedQty: qty("accepted_qty"),
    dispatchedQty: qty("dispatched_qty").notNull().default(0),
    /** Exchange: replacements received so far. */
    replacedQty: qty("replaced_qty").notNull().default(0),
    /** From the original goods receipt. */
    unitCost: unitCost("unit_cost").notNull(),
    gst: boolean("gst").notNull(),
    reason: text("reason"),
  },
  (t) => [
    index("purchase_return_items_return_idx").on(t.purchaseReturnId),
    index("purchase_return_items_grn_item_idx").on(t.goodsReceiptItemId),
    // The supplier can accept at most what we asked for; only accepted goods can go out; only
    // goods that went out can be replaced.
    check(
      "purchase_return_items_qty_ck",
      sql`${t.requestedQty} > 0 AND (${t.acceptedQty} IS NULL OR (${t.acceptedQty} >= 0 AND ${t.acceptedQty} <= ${t.requestedQty})) AND ${t.dispatchedQty} >= 0 AND ${t.dispatchedQty} <= coalesce(${t.acceptedQty}, 0) AND ${t.replacedQty} >= 0 AND ${t.replacedQty} <= ${t.dispatchedQty}`,
    ),
  ],
);

/** Photos of the problem, sent with the return request. */
export const purchaseReturnPhotos = pgTable(
  "purchase_return_photos",
  {
    id: id(),
    purchaseReturnId: uuid("purchase_return_id")
      .notNull()
      .references(() => purchaseReturns.id, { onDelete: "cascade" }),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("purchase_return_photos_return_idx").on(t.purchaseReturnId)],
);

export type SupplierPayMethod = "bank_transfer" | "card" | "cash" | "other";

/** Money we paid a supplier for a purchase order. No credit: payments are recorded as they go out. */
export const supplierPayments = pgTable(
  "supplier_payments",
  {
    id: id(),
    paymentNumber: text("payment_number").notNull().unique(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "restrict" }),
    paymentDate: date("payment_date", { mode: "string" }).notNull(),
    amount: money("amount").notNull(),
    method: text("method").$type<SupplierPayMethod>().notNull(),
    reference: text("reference"),
    notes: text("notes"),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [index("supplier_payments_po_idx").on(t.purchaseOrderId), check("supplier_payments_amount_ck", sql`${t.amount} > 0`)],
);

/** Money a supplier actually paid back for a purchase return. */
export const supplierRefunds = pgTable(
  "supplier_refunds",
  {
    id: id(),
    refundNumber: text("refund_number").notNull().unique(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    purchaseReturnId: uuid("purchase_return_id")
      .notNull()
      .references(() => purchaseReturns.id, { onDelete: "restrict" }),
    refundDate: date("refund_date", { mode: "string" }).notNull(),
    amount: money("amount").notNull(),
    method: text("method").$type<SupplierPayMethod>().notNull(),
    reference: text("reference"),
    notes: text("notes"),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [index("supplier_refunds_return_idx").on(t.purchaseReturnId), check("supplier_refunds_amount_ck", sql`${t.amount} > 0`)],
);

export type MovementType = "opening" | "purchase_receipt" | "purchase_return" | "customer_return" | "sale_reserved" | "sale_released" | "adjustment" | "count" | "import" | "other";

/**
 * Every change to a product's stock, written by a database trigger on products.stock (so nothing
 * can change stock without a line here) and append-only: another trigger refuses UPDATE and
 * DELETE. `qty` is signed; `balanceAfter` is the product's stock after the change. No foreign key
 * to products, so history outlives a deleted product (sku and name are kept).
 */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: id(),
    productId: uuid("product_id").notNull(),
    sku: text("sku").notNull(),
    productName: text("product_name").notNull(),
    movementType: text("movement_type").$type<MovementType>().notNull(),
    qty: qty("qty").notNull(),
    balanceAfter: qty("balance_after").notNull(),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    referenceNumber: text("reference_number"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("inventory_movements_product_idx").on(t.productId, t.createdAt), index("inventory_movements_created_idx").on(t.createdAt)],
);

// ---------------------------------------------------------------------------
// Customer returns and store credit. A customer who bought the wrong thing (or no longer wants
// it, or it was faulty) sends it back; we refund them, give them store credit, or exchange it.
// Store credit is a wallet: an account per customer whose balance only moves through the
// append-only customer_credit_transactions (a database trigger keeps balance and history in
// step and refuses to go below zero).
// ---------------------------------------------------------------------------

export const customerReturnNo = pgSequence("customer_return_no", { startWith: 10001 });
export const creditTransactionNo = pgSequence("credit_transaction_no", { startWith: 10001 });

export type CustomerReturnReason = "ordered_by_mistake" | "no_longer_needed" | "wrong_product" | "damaged" | "defective" | "other";
/** refund = money back; credit = store credit for next time; exchange = credit put straight towards a replacement order. */
export type CustomerReturnResolution = "refund" | "credit" | "exchange";
/** requested = waiting for the goods; received = checked in the warehouse; completed = refund/credit given. */
export type CustomerReturnStatus = "requested" | "received" | "completed" | "cancelled";
/** What the warehouse decided for returned goods: back on the shelf, or not sellable. */
export type ReturnedCondition = "restock" | "damaged" | "write_off";
export type CustomerRefundMethod = "card" | "bank_transfer" | "cash" | "other";

export const customerReturns = pgTable(
  "customer_returns",
  {
    id: id(),
    returnNumber: text("return_number").notNull().unique(),
    salesOrderId: uuid("sales_order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    status: text("status").$type<CustomerReturnStatus>().notNull().default("requested"),
    reason: text("reason").$type<CustomerReturnReason>().notNull(),
    resolution: text("resolution").$type<CustomerReturnResolution>().notNull(),
    notes: text("notes"),
    /** Value of the returned goods at the price paid, incl. GST (delivery isn't refunded). */
    subtotal: money("subtotal").notNull(),
    gst: money("gst").notNull(),
    total: money("total").notNull(),
    /** What was actually given back, once completed. */
    refundAmount: money("refund_amount").notNull().default(0),
    creditAmount: money("credit_amount").notNull().default(0),
    refundMethod: text("refund_method").$type<CustomerRefundMethod>(),
    refundReference: text("refund_reference"),
    /** Exchange: the replacement order the credit went towards. */
    exchangeOrderId: uuid("exchange_order_id").references(() => salesOrders.id, { onDelete: "set null" }),
    createdBy: createdBy(),
    receivedBy: uuid("received_by").references(() => users.id, { onDelete: "set null" }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("customer_returns_order_idx").on(t.salesOrderId),
    index("customer_returns_customer_idx").on(t.customerId),
    index("customer_returns_status_idx").on(t.status),
    check("customer_returns_money_ck", sql`${t.total} >= 0 AND ${t.refundAmount} >= 0 AND ${t.creditAmount} >= 0 AND ${t.refundAmount} + ${t.creditAmount} <= ${t.total}`),
  ],
);

export const customerReturnItems = pgTable(
  "customer_return_items",
  {
    id: id(),
    customerReturnId: uuid("customer_return_id")
      .notNull()
      .references(() => customerReturns.id, { onDelete: "cascade" }),
    salesOrderItemId: uuid("sales_order_item_id")
      .notNull()
      .references(() => salesOrderItems.id, { onDelete: "restrict" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    qty: qty("qty").notNull(),
    /** Price paid per unit, ex GST. */
    unitPrice: unitCost("unit_price").notNull(),
    gst: boolean("gst").notNull(),
    lineTotal: money("line_total").notNull(),
    /** Set when the warehouse checks the goods in. */
    receivedQty: qty("received_qty"),
    condition: text("condition").$type<ReturnedCondition>(),
    /** How many went back into sellable stock. */
    restockedQty: qty("restocked_qty").notNull().default(0),
  },
  (t) => [
    index("customer_return_items_return_idx").on(t.customerReturnId),
    index("customer_return_items_so_item_idx").on(t.salesOrderItemId),
    check("customer_return_items_qty_ck", sql`${t.qty} > 0 AND (${t.receivedQty} IS NULL OR (${t.receivedQty} >= 0 AND ${t.receivedQty} <= ${t.qty})) AND ${t.restockedQty} >= 0 AND ${t.restockedQty} <= coalesce(${t.receivedQty}, 0)`),
  ],
);

/** One store credit account per customer. `balance` is only ever changed by the transactions trigger. */
export const customerCreditAccounts = pgTable(
  "customer_credit_accounts",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    currency: text("currency").notNull().default("AUD"),
    balance: money("balance").notNull().default(0),
    totalIssued: money("total_issued").notNull().default(0),
    totalUsed: money("total_used").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("customer_credit_accounts_uq").on(t.customerId, t.currency), check("customer_credit_accounts_balance_ck", sql`${t.balance} >= 0`)],
);

/**
 * return_credit: from a customer return · manual_credit / promotion_credit: given by an admin ·
 * order_redemption: spent on an order (negative) · redemption_reversal: an order using credit was
 * cancelled or reduced, so it comes back · credit_reversal: an admin takes back credit given in error.
 */
export type CreditTransactionType = "return_credit" | "manual_credit" | "promotion_credit" | "order_redemption" | "redemption_reversal" | "credit_reversal";

export const customerCreditTransactions = pgTable(
  "customer_credit_transactions",
  {
    id: id(),
    transactionNumber: text("transaction_number").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    /** Filled in by the trigger. */
    accountId: uuid("account_id").references(() => customerCreditAccounts.id, { onDelete: "restrict" }),
    transactionType: text("transaction_type").$type<CreditTransactionType>().notNull(),
    /** Signed: + credit given, − credit used or taken back. */
    amount: money("amount").notNull(),
    /** Filled in by the trigger, from the locked account row. */
    balanceBefore: money("balance_before").notNull().default(0),
    balanceAfter: money("balance_after").notNull().default(0),
    sourceType: text("source_type").$type<"customer_return" | "sales_order" | "manual">().notNull(),
    sourceId: uuid("source_id"),
    sourceNumber: text("source_number"),
    description: text("description"),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [
    index("customer_credit_tx_customer_idx").on(t.customerId, t.createdAt),
    index("customer_credit_tx_source_idx").on(t.sourceType, t.sourceId),
    check("customer_credit_tx_amount_ck", sql`${t.amount} <> 0`),
  ],
);
