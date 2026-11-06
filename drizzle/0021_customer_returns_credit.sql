CREATE SEQUENCE "public"."credit_transaction_no" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 10001 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."customer_return_no" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 10001 CACHE 1;--> statement-breakpoint
CREATE TABLE "customer_credit_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"balance" numeric(12, 2) DEFAULT 0 NOT NULL,
	"total_issued" numeric(12, 2) DEFAULT 0 NOT NULL,
	"total_used" numeric(12, 2) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_credit_accounts_balance_ck" CHECK ("customer_credit_accounts"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"account_id" uuid,
	"transaction_type" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"balance_before" numeric(12, 2) DEFAULT 0 NOT NULL,
	"balance_after" numeric(12, 2) DEFAULT 0 NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"source_number" text,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_credit_transactions_transaction_number_unique" UNIQUE("transaction_number"),
	CONSTRAINT "customer_credit_tx_amount_ck" CHECK ("customer_credit_transactions"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "customer_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_return_id" uuid NOT NULL,
	"sales_order_item_id" uuid NOT NULL,
	"product_id" uuid,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 4) NOT NULL,
	"gst" boolean NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	"received_qty" numeric(12, 3),
	"condition" text,
	"restocked_qty" numeric(12, 3) DEFAULT 0 NOT NULL,
	CONSTRAINT "customer_return_items_qty_ck" CHECK ("customer_return_items"."qty" > 0 AND ("customer_return_items"."received_qty" IS NULL OR ("customer_return_items"."received_qty" >= 0 AND "customer_return_items"."received_qty" <= "customer_return_items"."qty")) AND "customer_return_items"."restocked_qty" >= 0 AND "customer_return_items"."restocked_qty" <= coalesce("customer_return_items"."received_qty", 0))
);
--> statement-breakpoint
CREATE TABLE "customer_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_number" text NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text NOT NULL,
	"resolution" text NOT NULL,
	"notes" text,
	"subtotal" numeric(12, 2) NOT NULL,
	"gst" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"refund_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"credit_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"refund_method" text,
	"refund_reference" text,
	"exchange_order_id" uuid,
	"created_by" uuid,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_returns_return_number_unique" UNIQUE("return_number"),
	CONSTRAINT "customer_returns_money_ck" CHECK ("customer_returns"."total" >= 0 AND "customer_returns"."refund_amount" >= 0 AND "customer_returns"."credit_amount" >= 0 AND "customer_returns"."refund_amount" + "customer_returns"."credit_amount" <= "customer_returns"."total")
);
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "credit_applied_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_credit_accounts" ADD CONSTRAINT "customer_credit_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_transactions" ADD CONSTRAINT "customer_credit_transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_transactions" ADD CONSTRAINT "customer_credit_transactions_account_id_customer_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_credit_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_transactions" ADD CONSTRAINT "customer_credit_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_customer_return_id_customer_returns_id_fk" FOREIGN KEY ("customer_return_id") REFERENCES "public"."customer_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_sales_order_item_id_sales_order_items_id_fk" FOREIGN KEY ("sales_order_item_id") REFERENCES "public"."sales_order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_exchange_order_id_sales_orders_id_fk" FOREIGN KEY ("exchange_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_credit_accounts_uq" ON "customer_credit_accounts" USING btree ("customer_id","currency");--> statement-breakpoint
CREATE INDEX "customer_credit_tx_customer_idx" ON "customer_credit_transactions" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_credit_tx_source_idx" ON "customer_credit_transactions" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "customer_return_items_return_idx" ON "customer_return_items" USING btree ("customer_return_id");--> statement-breakpoint
CREATE INDEX "customer_return_items_so_item_idx" ON "customer_return_items" USING btree ("sales_order_item_id");--> statement-breakpoint
CREATE INDEX "customer_returns_order_idx" ON "customer_returns" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "customer_returns_customer_idx" ON "customer_returns" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_returns_status_idx" ON "customer_returns" USING btree ("status");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Store credit. A transaction row is the only way credit moves: inserting one locks the
-- customer's account (creating it the first time), checks the balance can't go below zero,
-- fills in balance before/after and updates the account, all in the inserting transaction. Two
-- staff spending the same credit at once: the second waits on the lock, then finds it gone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "post_credit_transaction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  acct record;
BEGIN
  IF NEW.transaction_type IN ('return_credit', 'manual_credit', 'promotion_credit', 'redemption_reversal') AND NEW.amount <= 0 THEN
    RAISE EXCEPTION 'A % must add credit.', replace(NEW.transaction_type, '_', ' ');
  END IF;
  IF NEW.transaction_type IN ('order_redemption', 'credit_reversal') AND NEW.amount >= 0 THEN
    RAISE EXCEPTION 'A % must take credit off.', replace(NEW.transaction_type, '_', ' ');
  END IF;
  INSERT INTO "customer_credit_accounts" ("customer_id") VALUES (NEW.customer_id) ON CONFLICT ("customer_id", "currency") DO NOTHING;
  SELECT * INTO acct FROM "customer_credit_accounts" WHERE "customer_id" = NEW.customer_id AND "currency" = 'AUD' FOR UPDATE;
  IF acct.balance + NEW.amount < 0 THEN
    RAISE EXCEPTION 'Not enough store credit: % available.', to_char(acct.balance, 'FM$999,999,990.00');
  END IF;
  NEW.account_id := acct.id;
  NEW.balance_before := acct.balance;
  NEW.balance_after := acct.balance + NEW.amount;
  PERFORM set_config('app.credit_posting', 'on', true);
  UPDATE "customer_credit_accounts" SET
    "balance" = NEW.balance_after,
    "total_issued" = "total_issued" + CASE WHEN NEW.transaction_type IN ('return_credit', 'manual_credit', 'promotion_credit') THEN NEW.amount WHEN NEW.transaction_type = 'credit_reversal' THEN NEW.amount ELSE 0 END,
    "total_used" = "total_used" + CASE WHEN NEW.transaction_type IN ('order_redemption', 'redemption_reversal') THEN -NEW.amount ELSE 0 END,
    "updated_at" = now()
  WHERE "id" = acct.id;
  PERFORM set_config('app.credit_posting', '', true);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "customer_credit_transactions_post" BEFORE INSERT ON "customer_credit_transactions" FOR EACH ROW EXECUTE FUNCTION "post_credit_transaction"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "credit_history_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Store credit history can''t be changed or deleted. Record a reversal instead.';
END $$;
--> statement-breakpoint
CREATE TRIGGER "customer_credit_transactions_no_change" BEFORE UPDATE OR DELETE ON "customer_credit_transactions" FOR EACH ROW EXECUTE FUNCTION "credit_history_append_only"();
--> statement-breakpoint
CREATE TRIGGER "customer_credit_transactions_no_truncate" BEFORE TRUNCATE ON "customer_credit_transactions" FOR EACH STATEMENT EXECUTE FUNCTION "credit_history_append_only"();
--> statement-breakpoint
-- The balance only moves with a transaction.
CREATE OR REPLACE FUNCTION "credit_account_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Store credit accounts can''t be deleted.'; END IF;
  IF (NEW.balance <> OLD.balance OR NEW.total_issued <> OLD.total_issued OR NEW.total_used <> OLD.total_used)
     AND coalesce(current_setting('app.credit_posting', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Store credit only changes through a credit transaction.';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "customer_credit_accounts_guard" BEFORE UPDATE OR DELETE ON "customer_credit_accounts" FOR EACH ROW EXECUTE FUNCTION "credit_account_guard"();
--> statement-breakpoint
-- Customer-returned goods only go back into sellable stock when the warehouse restocks them
-- (restocked_qty rises), and that writes the stock ledger.
CREATE OR REPLACE FUNCTION "customer_return_items_restock"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  delta numeric;
BEGIN
  IF NEW.restocked_qty < OLD.restocked_qty THEN RAISE EXCEPTION 'Restocked goods can''t be taken back off here. Use a stock adjustment.'; END IF;
  delta := NEW.restocked_qty - OLD.restocked_qty;
  IF delta > 0 THEN
    IF delta <> trunc(delta) THEN RAISE EXCEPTION 'Stock is counted in whole units: % has %.', NEW.sku, trim_scale(delta); END IF;
    IF NEW.product_id IS NULL THEN RAISE EXCEPTION 'Product % no longer exists, so it can''t go back into stock.', NEW.sku; END IF;
    SELECT * INTO r FROM "customer_returns" WHERE "id" = NEW.customer_return_id;
    PERFORM set_config('app.stock_ctx', json_build_object('type', 'customer_return', 'refType', 'customer_return', 'refId', r.id, 'refNumber', r.return_number, 'by', r.received_by, 'note', 'Returned by customer, back on the shelf')::text, true);
    UPDATE "products" SET "stock" = "stock" + delta::integer WHERE "id" = NEW.product_id;
    PERFORM set_config('app.stock_ctx', '', true);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "customer_return_items_restock" BEFORE UPDATE ON "customer_return_items" FOR EACH ROW EXECUTE FUNCTION "customer_return_items_restock"();
--> statement-breakpoint
ALTER TABLE "customer_returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_return_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_credit_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_credit_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated';
  END IF;
END $$;
