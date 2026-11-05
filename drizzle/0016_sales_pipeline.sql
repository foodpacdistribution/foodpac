ALTER TABLE "customers" ADD COLUMN "sales_stage" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "sales_stage_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "sales_rep_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_sales_rep_id_users_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Customers who already buy from us are won; everyone else starts as a new lead.
UPDATE "customers" SET "sales_stage" = 'won'
WHERE EXISTS (SELECT 1 FROM "sales_orders" s WHERE s."customer_id" = "customers"."id")
   OR EXISTS (SELECT 1 FROM "orders" o WHERE o."customer_id" = "customers"."id");
