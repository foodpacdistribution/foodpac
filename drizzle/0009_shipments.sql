CREATE SEQUENCE "public"."shipment_no" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1001 CACHE 1;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "number" text DEFAULT ('SH-' || nextval('shipment_no')) NOT NULL;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "routes_number_uq" ON "routes" USING btree ("number");--> statement-breakpoint
-- Routes from plans already dispatched count as sent to their drivers.
UPDATE "routes" SET "dispatched_at" = "plans"."dispatched_at" FROM "plans" WHERE "plans"."id" = "routes"."plan_id" AND "plans"."status" = 'dispatched';
