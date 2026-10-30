CREATE TABLE "delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"driver_id" uuid,
	"user_id" uuid,
	"type" text NOT NULL,
	"reason" text,
	"recipient" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"vehicle" text,
	"capacity" integer,
	"shift_start_min" integer,
	"max_shift_min" integer,
	"color" text DEFAULT '#2563eb' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geocode_cache" (
	"query" text PRIMARY KEY NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"label" text,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "optimisation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"summary" jsonb NOT NULL,
	"baseline" jsonb,
	"snapshot" jsonb NOT NULL,
	"settings" jsonb,
	"solver_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"delivery_date" date NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"phone" text,
	"address" text NOT NULL,
	"suburb" text,
	"postcode" text,
	"lat" double precision,
	"lng" double precision,
	"geocode_status" text DEFAULT 'pending' NOT NULL,
	"geocode_label" text,
	"window_start_min" integer,
	"window_end_min" integer,
	"service_min" integer,
	"demand" integer DEFAULT 1 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"pinned_driver_id" uuid,
	"driver_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"context" jsonb,
	"summary" jsonb,
	"baseline" jsonb,
	"unassigned" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_delivery_date_unique" UNIQUE("delivery_date")
);
--> statement-breakpoint
CREATE TABLE "route_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"eta_s" integer NOT NULL,
	"etd_s" integer NOT NULL,
	"wait_s" integer DEFAULT 0 NOT NULL,
	"late_s" integer DEFAULT 0 NOT NULL,
	"leg_distance_m" integer NOT NULL,
	"leg_drive_s" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"start_s" integer NOT NULL,
	"end_s" integer NOT NULL,
	"distance_m" integer NOT NULL,
	"drive_s" integer NOT NULL,
	"service_s" integer NOT NULL,
	"wait_s" integer NOT NULL,
	"overtime_s" integer DEFAULT 0 NOT NULL,
	"over_capacity" integer DEFAULT 0 NOT NULL,
	"geometry" jsonb,
	"status" text DEFAULT 'planned' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"company_name" text DEFAULT 'My Company' NOT NULL,
	"timezone" text DEFAULT 'Australia/Brisbane' NOT NULL,
	"depot_name" text DEFAULT 'Warehouse' NOT NULL,
	"depot_address" text DEFAULT '' NOT NULL,
	"depot_lat" double precision,
	"depot_lng" double precision,
	"default_service_min" integer DEFAULT 10 NOT NULL,
	"default_start_min" integer DEFAULT 480 NOT NULL,
	"default_max_shift_min" integer DEFAULT 540 NOT NULL,
	"traffic_factor" real DEFAULT 1.15 NOT NULL,
	"return_to_depot" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"driver_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimisation_runs" ADD CONSTRAINT "optimisation_runs_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimisation_runs" ADD CONSTRAINT "optimisation_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pinned_driver_id_drivers_id_fk" FOREIGN KEY ("pinned_driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_events_order_idx" ON "delivery_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "optimisation_runs_plan_idx" ON "optimisation_runs" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_date_uq" ON "orders" USING btree ("order_number","delivery_date");--> statement-breakpoint
CREATE INDEX "orders_date_idx" ON "orders" USING btree ("delivery_date");--> statement-breakpoint
CREATE INDEX "route_stops_route_idx" ON "route_stops" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "route_stops_order_idx" ON "route_stops" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routes_plan_driver_uq" ON "routes" USING btree ("plan_id","driver_id");