ALTER TABLE "cart_items" ADD COLUMN "by_carton" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "per_carton" integer;--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "carton_price_cents" integer;