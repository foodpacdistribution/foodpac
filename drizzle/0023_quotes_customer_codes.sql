CREATE SEQUENCE "public"."customer_code_no" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 10001 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."quote_no" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 10001 CACHE 1;--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"product_id" uuid,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"pack_size" text NOT NULL,
	"unit" text NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"qty" integer NOT NULL,
	"gst" boolean NOT NULL,
	"line_cents" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"valid_until" date NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"delivery_fee_cents" integer NOT NULL,
	"gst_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"notes" text,
	"internal_note" text,
	"sales_order_id" uuid,
	"accepted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"sent_to" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "code" text;--> statement-breakpoint
-- Existing customers get codes in the order they were added (C10001 = the first one); new ones take the next number.
WITH o AS (SELECT "id", row_number() OVER (ORDER BY "created_at", "name", "id") AS rn FROM "customers")
UPDATE "customers" SET "code" = 'C' || (10000 + o.rn) FROM o WHERE "customers"."id" = o."id";--> statement-breakpoint
SELECT setval('customer_code_no', 10000 + (SELECT count(*) FROM "customers"));--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "code" SET DEFAULT 'C' || nextval('customer_code_no');--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_items_quote_idx" ON "quote_items" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quotes_customer_idx" ON "quotes" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "quotes_created_idx" ON "quotes" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_code_key" ON "customers" USING btree (lower("code"));