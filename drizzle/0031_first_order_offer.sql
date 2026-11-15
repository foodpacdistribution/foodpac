ALTER TABLE "customers" ADD COLUMN "first_order_min_cents" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "first_order_off_cents" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "first_order_offer_order_id" uuid;