ALTER TABLE "customers" ADD COLUMN "follow_up_on" date;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "follow_up_note" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "contacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "quiet_days" integer DEFAULT 14 NOT NULL;