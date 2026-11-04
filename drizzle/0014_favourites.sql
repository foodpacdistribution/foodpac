CREATE TABLE "favourites" (
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "favourites_uq" ON "favourites" USING btree ("customer_id","product_id");--> statement-breakpoint
-- Like every table (0007): not reachable through the Supabase Data API, only by the app.
ALTER TABLE "favourites" ENABLE ROW LEVEL SECURITY;
