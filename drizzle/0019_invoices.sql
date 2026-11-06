ALTER TABLE "sales_orders" ADD COLUMN "invoice_status" text DEFAULT 'proforma' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "invoiced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "invoice_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "invoice_sent_to" text;--> statement-breakpoint
-- Orders already paid or delivered were billed as tax invoices before proformas existed: keep them final.
UPDATE "sales_orders" so SET "invoice_status" = 'final', "invoiced_at" = coalesce(so."paid_at", so."created_at")
WHERE so."status" <> 'pending' AND (so."payment_status" IN ('paid', 'refunded') OR EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = so."delivery_order_id" AND o."status" = 'delivered'));
