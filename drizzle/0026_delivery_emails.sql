ALTER TABLE "route_stops" ADD COLUMN "next_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "route_stops" ADD COLUMN "heads_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "notify_customers" boolean DEFAULT false NOT NULL;