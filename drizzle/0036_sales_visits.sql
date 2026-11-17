CREATE TABLE "customer_visit_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"user_id" uuid,
	"channel" text DEFAULT 'visit' NOT NULL,
	"outcome" text NOT NULL,
	"note" text,
	"lat" double precision,
	"lng" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "not_now_reason" text;--> statement-breakpoint
ALTER TABLE "customer_visit_photos" ADD CONSTRAINT "customer_visit_photos_visit_id_customer_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."customer_visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_visits" ADD CONSTRAINT "customer_visits_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_visits" ADD CONSTRAINT "customer_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_visit_photos_visit_idx" ON "customer_visit_photos" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "customer_visits_customer_idx" ON "customer_visits" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_visits_user_idx" ON "customer_visits" USING btree ("user_id","created_at");