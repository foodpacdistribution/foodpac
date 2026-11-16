ALTER TABLE "customers" ADD COLUMN "restock_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "restock_reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "restock_reminders" boolean DEFAULT false NOT NULL;