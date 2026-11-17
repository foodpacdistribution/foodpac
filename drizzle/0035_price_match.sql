CREATE TABLE "price_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"competitor_cents" integer NOT NULL,
	"competitor" text,
	"price_cents" integer NOT NULL,
	"list_cents" integer NOT NULL,
	"cost_cents" integer,
	"monthly_qty" integer,
	"note" text,
	"status" text NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "favourites" ADD COLUMN "qty" integer;--> statement-breakpoint
ALTER TABLE "favourites" ADD COLUMN "added_by" uuid;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "sales_min_margin_pct" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "price_match_beat_pct" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "price_matches" ADD CONSTRAINT "price_matches_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_matches" ADD CONSTRAINT "price_matches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_matches" ADD CONSTRAINT "price_matches_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_matches" ADD CONSTRAINT "price_matches_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_matches_customer_idx" ON "price_matches" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "price_matches_status_idx" ON "price_matches" USING btree ("status");--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;