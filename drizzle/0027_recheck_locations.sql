-- The first wrong-town check (deployed 12 Nov 2026) treated a neighbouring postcode as another
-- town and moved good pins or marked them not found. Forget what it saved and locate those
-- orders and customers again with the distance-based check.
DELETE FROM "geocode_cache" WHERE "status" IN ('approximate', 'failed');--> statement-breakpoint
UPDATE "orders" SET "geocode_status" = 'pending', "updated_at" = now()
WHERE "geocode_status" IN ('approximate', 'failed')
  AND "status" IN ('pending', 'planned', 'dispatched')
  AND "updated_at" >= '2026-11-12T09:39:51+10:00';--> statement-breakpoint
UPDATE "customers" SET "geocoded_address" = NULL WHERE "geocode_status" IN ('approximate', 'failed');
