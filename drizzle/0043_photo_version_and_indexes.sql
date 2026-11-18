ALTER TABLE "products" ADD COLUMN "image_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Photo addresses stay exactly as they are today, so nothing has to be optimised or downloaded again.
UPDATE "products" SET "image_at" = "updated_at";--> statement-breakpoint
CREATE INDEX "cart_items_product_idx" ON "cart_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_idx" ON "customer_addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_prices_product_idx" ON "customer_prices" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "delivery_dockets_driver_idx" ON "delivery_dockets" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "delivery_events_driver_idx" ON "delivery_events" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "delivery_proofs_event_idx" ON "delivery_proofs" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "favourites_product_idx" ON "favourites" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "orders_driver_idx" ON "orders" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "orders_updated_idx" ON "orders" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "route_stops_completed_idx" ON "route_stops" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "routes_driver_idx" ON "routes" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "routes_dispatched_idx" ON "routes" USING btree ("dispatched_at");--> statement-breakpoint
CREATE INDEX "users_customer_idx" ON "users" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "users_driver_idx" ON "users" USING btree ("driver_id");