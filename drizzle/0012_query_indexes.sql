DROP INDEX "vehicle_locations_route_idx";--> statement-breakpoint
CREATE INDEX "sales_orders_delivery_order_idx" ON "sales_orders" USING btree ("delivery_order_id");--> statement-breakpoint
CREATE INDEX "sales_orders_status_idx" ON "sales_orders" USING btree ("status","fulfilment");--> statement-breakpoint
CREATE INDEX "vehicle_locations_route_idx" ON "vehicle_locations" USING btree ("route_id","recorded_at");