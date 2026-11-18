CREATE TABLE "delivery_dockets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid,
	"user_id" uuid,
	"delivery_date" date NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"read_status" text DEFAULT 'reading' NOT NULL,
	"read_error" text,
	"read" jsonb,
	"order_number" text,
	"customer_name" text,
	"address" text,
	"phone" text,
	"goods" jsonb,
	"total_cents" integer,
	"customer_id" uuid,
	"order_id" uuid,
	"added_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_dockets" ADD CONSTRAINT "delivery_dockets_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_dockets" ADD CONSTRAINT "delivery_dockets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_dockets" ADD CONSTRAINT "delivery_dockets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_dockets" ADD CONSTRAINT "delivery_dockets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_dockets_date_idx" ON "delivery_dockets" USING btree ("delivery_date");--> statement-breakpoint
CREATE INDEX "delivery_dockets_order_idx" ON "delivery_dockets" USING btree ("order_id");