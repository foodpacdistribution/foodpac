ALTER TABLE "customers" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "geocode_status" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "geocode_label" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "geocoded_address" text;