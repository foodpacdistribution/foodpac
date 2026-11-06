CREATE SEQUENCE "public"."goods_receipt_no" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 10001 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."purchase_order_no" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 10001 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."purchase_return_no" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 10001 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."supplier_payment_no" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 10001 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."supplier_refund_no" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 10001 CACHE 1;--> statement-breakpoint
CREATE TABLE "goods_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"purchase_order_item_id" uuid,
	"purchase_return_item_id" uuid,
	"product_id" uuid,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"received_qty" numeric(12, 3) NOT NULL,
	"unit_cost" numeric(12, 4) NOT NULL,
	"gst" boolean NOT NULL,
	"notes" text,
	CONSTRAINT "goods_receipt_items_qty_ck" CHECK ("goods_receipt_items"."received_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grn_number" text NOT NULL,
	"purchase_order_id" uuid,
	"purchase_return_id" uuid,
	"supplier_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"receipt_date" date NOT NULL,
	"delivery_reference" text,
	"notes" text,
	"created_by" uuid,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_grn_number_unique" UNIQUE("grn_number"),
	CONSTRAINT "goods_receipts_source_ck" CHECK (("goods_receipts"."purchase_order_id" IS NULL) <> ("goods_receipts"."purchase_return_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"product_name" text NOT NULL,
	"movement_type" text NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"balance_after" numeric(12, 3) NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"reference_number" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"product_id" uuid,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"ordered_qty" numeric(12, 3) NOT NULL,
	"received_qty" numeric(12, 3) DEFAULT 0 NOT NULL,
	"unit_cost" numeric(12, 4) NOT NULL,
	"gst" boolean NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	CONSTRAINT "purchase_order_items_qty_ck" CHECK ("purchase_order_items"."ordered_qty" > 0 AND "purchase_order_items"."received_qty" >= 0 AND "purchase_order_items"."received_qty" <= "purchase_order_items"."ordered_qty" AND "purchase_order_items"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"order_date" date NOT NULL,
	"expected_date" date,
	"supplier_reference" text,
	"notes" text,
	"subtotal" numeric(12, 2) DEFAULT 0 NOT NULL,
	"gst" numeric(12, 2) DEFAULT 0 NOT NULL,
	"total" numeric(12, 2) DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"sent_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number")
);
--> statement-breakpoint
CREATE TABLE "purchase_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_return_id" uuid NOT NULL,
	"goods_receipt_item_id" uuid NOT NULL,
	"product_id" uuid,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"requested_qty" numeric(12, 3) NOT NULL,
	"accepted_qty" numeric(12, 3),
	"dispatched_qty" numeric(12, 3) DEFAULT 0 NOT NULL,
	"replaced_qty" numeric(12, 3) DEFAULT 0 NOT NULL,
	"unit_cost" numeric(12, 4) NOT NULL,
	"gst" boolean NOT NULL,
	"reason" text,
	CONSTRAINT "purchase_return_items_qty_ck" CHECK ("purchase_return_items"."requested_qty" > 0 AND ("purchase_return_items"."accepted_qty" IS NULL OR ("purchase_return_items"."accepted_qty" >= 0 AND "purchase_return_items"."accepted_qty" <= "purchase_return_items"."requested_qty")) AND "purchase_return_items"."dispatched_qty" >= 0 AND "purchase_return_items"."dispatched_qty" <= coalesce("purchase_return_items"."accepted_qty", 0) AND "purchase_return_items"."replaced_qty" >= 0 AND "purchase_return_items"."replaced_qty" <= "purchase_return_items"."dispatched_qty")
);
--> statement-breakpoint
CREATE TABLE "purchase_return_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_return_id" uuid NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_number" text NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"return_date" date NOT NULL,
	"return_reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"supplier_status" text DEFAULT 'pending' NOT NULL,
	"supplier_response" text,
	"refund_method" text,
	"refund_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"notes" text,
	"created_by" uuid,
	"approved_by" uuid,
	"responded_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"dispatched_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_returns_return_number_unique" UNIQUE("return_number"),
	CONSTRAINT "purchase_returns_refund_ck" CHECK ("purchase_returns"."refund_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"payment_date" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_payments_payment_number_unique" UNIQUE("payment_number"),
	CONSTRAINT "supplier_payments_amount_ck" CHECK ("supplier_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"purchase_return_id" uuid NOT NULL,
	"refund_date" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_refunds_refund_number_unique" UNIQUE("refund_number"),
	CONSTRAINT "supplier_refunds_amount_ck" CHECK ("supplier_refunds"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"address" text,
	"abn" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_purchase_order_item_id_purchase_order_items_id_fk" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_purchase_return_item_id_purchase_return_items_id_fk" FOREIGN KEY ("purchase_return_item_id") REFERENCES "public"."purchase_return_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_return_id_purchase_returns_id_fk" FOREIGN KEY ("purchase_return_id") REFERENCES "public"."purchase_returns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchase_return_id_purchase_returns_id_fk" FOREIGN KEY ("purchase_return_id") REFERENCES "public"."purchase_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_goods_receipt_item_id_goods_receipt_items_id_fk" FOREIGN KEY ("goods_receipt_item_id") REFERENCES "public"."goods_receipt_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_photos" ADD CONSTRAINT "purchase_return_photos_purchase_return_id_purchase_returns_id_fk" FOREIGN KEY ("purchase_return_id") REFERENCES "public"."purchase_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_dispatched_by_users_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_refunds" ADD CONSTRAINT "supplier_refunds_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_refunds" ADD CONSTRAINT "supplier_refunds_purchase_return_id_purchase_returns_id_fk" FOREIGN KEY ("purchase_return_id") REFERENCES "public"."purchase_returns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_refunds" ADD CONSTRAINT "supplier_refunds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipt_items_grn_idx" ON "goods_receipt_items" USING btree ("goods_receipt_id");--> statement-breakpoint
CREATE INDEX "goods_receipt_items_po_item_idx" ON "goods_receipt_items" USING btree ("purchase_order_item_id");--> statement-breakpoint
CREATE INDEX "goods_receipts_po_idx" ON "goods_receipts" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "goods_receipts_return_idx" ON "goods_receipts" USING btree ("purchase_return_id");--> statement-breakpoint
CREATE INDEX "goods_receipts_supplier_idx" ON "goods_receipts" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_product_idx" ON "inventory_movements" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_created_idx" ON "inventory_movements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "purchase_order_items_po_idx" ON "purchase_order_items" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "purchase_return_items_return_idx" ON "purchase_return_items" USING btree ("purchase_return_id");--> statement-breakpoint
CREATE INDEX "purchase_return_items_grn_item_idx" ON "purchase_return_items" USING btree ("goods_receipt_item_id");--> statement-breakpoint
CREATE INDEX "purchase_return_photos_return_idx" ON "purchase_return_photos" USING btree ("purchase_return_id");--> statement-breakpoint
CREATE INDEX "purchase_returns_grn_idx" ON "purchase_returns" USING btree ("goods_receipt_id");--> statement-breakpoint
CREATE INDEX "purchase_returns_supplier_idx" ON "purchase_returns" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_returns_status_idx" ON "purchase_returns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "supplier_payments_po_idx" ON "supplier_payments" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "supplier_refunds_return_idx" ON "supplier_refunds" USING btree ("purchase_return_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Stock ledger. Every change to products.stock writes a movement, whatever made it. Code that
-- changes stock says why in the transaction-local setting app.stock_ctx (JSON: type, refType,
-- refId, refNumber, note, by); without it the movement is recorded as 'other'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "log_stock_movement"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ctx jsonb;
  delta numeric;
BEGIN
  delta := CASE WHEN TG_OP = 'INSERT' THEN NEW.stock ELSE NEW.stock - OLD.stock END;
  IF delta = 0 THEN RETURN NULL; END IF;
  ctx := coalesce(nullif(current_setting('app.stock_ctx', true), ''), '{}')::jsonb;
  INSERT INTO "inventory_movements" ("product_id", "sku", "product_name", "movement_type", "qty", "balance_after", "reference_type", "reference_id", "reference_number", "note", "created_by")
  VALUES (
    NEW.id, NEW.sku, NEW.name,
    CASE WHEN TG_OP = 'INSERT' AND coalesce(ctx->>'type', '') <> 'import' THEN 'opening' ELSE coalesce(ctx->>'type', 'other') END,
    delta, NEW.stock, ctx->>'refType', nullif(ctx->>'refId', '')::uuid, ctx->>'refNumber', ctx->>'note', nullif(ctx->>'by', '')::uuid
  );
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER "products_stock_movement" AFTER INSERT OR UPDATE OF "stock" ON "products" FOR EACH ROW EXECUTE FUNCTION "log_stock_movement"();
--> statement-breakpoint
-- The ledger is append-only: mistakes are corrected with a new adjustment, never by editing history.
CREATE OR REPLACE FUNCTION "inventory_movements_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Stock movements can''t be changed or deleted. Record a stock adjustment instead.';
END $$;
--> statement-breakpoint
CREATE TRIGGER "inventory_movements_no_change" BEFORE UPDATE OR DELETE ON "inventory_movements" FOR EACH ROW EXECUTE FUNCTION "inventory_movements_append_only"();
--> statement-breakpoint
CREATE TRIGGER "inventory_movements_no_truncate" BEFORE TRUNCATE ON "inventory_movements" FOR EACH STATEMENT EXECUTE FUNCTION "inventory_movements_append_only"();
--> statement-breakpoint
-- Stock that's already there starts the ledger.
INSERT INTO "inventory_movements" ("product_id", "sku", "product_name", "movement_type", "qty", "balance_after", "note")
SELECT "id", "sku", "name", 'opening', "stock", "stock", 'Stock on hand when the ledger started' FROM "products" WHERE "stock" <> 0;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Goods receipts: posting one (draft → posted) is what puts the goods in stock, in the same
-- transaction, and updates the purchase order lines (or the exchanged return lines). A posted
-- receipt is locked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "goods_receipt_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  it record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN RAISE EXCEPTION 'Goods receipt % is in stock already and can''t be deleted.', OLD.grn_number; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'posted' THEN
    IF NEW.status <> 'posted' OR NEW.receipt_date <> OLD.receipt_date OR NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id
       OR NEW.purchase_return_id IS DISTINCT FROM OLD.purchase_return_id OR NEW.supplier_id <> OLD.supplier_id THEN
      RAISE EXCEPTION 'Goods receipt % is in stock already and can''t be changed.', OLD.grn_number;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN RAISE EXCEPTION 'Goods receipt % is cancelled.', OLD.grn_number; END IF;
  IF OLD.status = 'draft' AND NEW.status = 'posted' THEN
    FOR it IN SELECT * FROM "goods_receipt_items" WHERE "goods_receipt_id" = NEW.id AND "received_qty" > 0 LOOP
      IF it.received_qty <> trunc(it.received_qty) THEN RAISE EXCEPTION 'Stock is counted in whole units: % has %.', it.sku, trim_scale(it.received_qty); END IF;
      IF it.product_id IS NULL THEN RAISE EXCEPTION 'Product % no longer exists, so it can''t go into stock.', it.sku; END IF;
      PERFORM set_config('app.stock_ctx', json_build_object('type', 'purchase_receipt', 'refType', 'goods_receipt', 'refId', NEW.id, 'refNumber', NEW.grn_number, 'by', NEW.posted_by)::text, true);
      UPDATE "products" SET "stock" = "stock" + it.received_qty::integer WHERE "id" = it.product_id;
      IF it.purchase_order_item_id IS NOT NULL THEN
        UPDATE "purchase_order_items" SET "received_qty" = "received_qty" + it.received_qty WHERE "id" = it.purchase_order_item_id;
      END IF;
      IF it.purchase_return_item_id IS NOT NULL THEN
        UPDATE "purchase_return_items" SET "replaced_qty" = "replaced_qty" + it.received_qty WHERE "id" = it.purchase_return_item_id;
      END IF;
    END LOOP;
    PERFORM set_config('app.stock_ctx', '', true);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "goods_receipts_guard" BEFORE UPDATE OR DELETE ON "goods_receipts" FOR EACH ROW EXECUTE FUNCTION "goods_receipt_guard"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "goods_receipt_items_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st text;
  gid uuid;
BEGIN
  gid := CASE WHEN TG_OP = 'DELETE' THEN OLD.goods_receipt_id ELSE NEW.goods_receipt_id END;
  -- Missing parent = the receipt itself is being deleted (only drafts can be).
  SELECT "status" INTO st FROM "goods_receipts" WHERE "id" = gid;
  IF st IS NOT NULL AND st <> 'draft' THEN RAISE EXCEPTION 'This goods receipt is % and its lines can''t be changed.', st; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "goods_receipt_items_guard" BEFORE INSERT OR UPDATE OR DELETE ON "goods_receipt_items" FOR EACH ROW EXECUTE FUNCTION "goods_receipt_items_guard"();
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Purchase returns. Asking for a return, and a supplier saying no, never touch stock. Stock only
-- goes down when accepted goods are actually sent back (dispatched_qty rises), here in the same
-- transaction, and never below what's free (stock reserved for customer orders stays put).
-- The CHECK on the table keeps dispatched ≤ accepted ≤ requested.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "purchase_return_items_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  delta numeric;
  free integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.dispatched_qty > 0 THEN RAISE EXCEPTION 'Goods already sent back can''t be removed from the return.'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.dispatched_qty <> 0 OR NEW.replaced_qty <> 0 OR NEW.accepted_qty IS NOT NULL THEN
      RAISE EXCEPTION 'A new return request starts with nothing accepted or sent.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.dispatched_qty < OLD.dispatched_qty THEN RAISE EXCEPTION 'Goods sent back can''t be un-sent.'; END IF;
  IF OLD.dispatched_qty > 0 AND (NEW.accepted_qty IS DISTINCT FROM OLD.accepted_qty OR NEW.requested_qty <> OLD.requested_qty) THEN
    RAISE EXCEPTION 'The goods have gone back, so the accepted quantity can''t change.';
  END IF;
  delta := NEW.dispatched_qty - OLD.dispatched_qty;
  IF delta > 0 THEN
    SELECT * INTO r FROM "purchase_returns" WHERE "id" = NEW.purchase_return_id;
    IF r.supplier_status NOT IN ('accepted', 'partially_accepted') THEN RAISE EXCEPTION 'The supplier hasn''t accepted this return.'; END IF;
    IF r.status <> 'dispatched' THEN RAISE EXCEPTION 'Mark the return as sent before taking the goods out of stock.'; END IF;
    IF delta <> trunc(delta) THEN RAISE EXCEPTION 'Stock is counted in whole units: % has %.', NEW.sku, trim_scale(delta); END IF;
    IF NEW.product_id IS NULL THEN RAISE EXCEPTION 'Product % no longer exists.', NEW.sku; END IF;
    SELECT "stock" INTO free FROM "products" WHERE "id" = NEW.product_id FOR UPDATE;
    IF free < delta THEN
      RAISE EXCEPTION 'Not enough free stock of % to send back: % free, % to go. The rest is reserved for customer orders.', NEW.sku, free, delta::integer;
    END IF;
    PERFORM set_config('app.stock_ctx', json_build_object('type', 'purchase_return', 'refType', 'purchase_return', 'refId', r.id, 'refNumber', r.return_number, 'by', r.dispatched_by)::text, true);
    UPDATE "products" SET "stock" = "stock" - delta::integer WHERE "id" = NEW.product_id;
    PERFORM set_config('app.stock_ctx', '', true);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "purchase_return_items_guard" BEFORE INSERT OR UPDATE OR DELETE ON "purchase_return_items" FOR EACH ROW EXECUTE FUNCTION "purchase_return_items_guard"();
--> statement-breakpoint
-- Same lock-down as 0007: RLS on, no policies, so the Supabase Data API can't reach these tables.
-- The app connects as the table owner, which bypasses RLS.
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goods_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_return_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated';
  END IF;
END $$;
