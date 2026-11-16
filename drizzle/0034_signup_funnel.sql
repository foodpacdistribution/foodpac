ALTER TABLE "customers" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "registered_online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Website sign-ups waiting for approval came from the trade account form; earlier ones can't be told apart.
UPDATE "customers" SET "registered_online" = true WHERE NOT "approved";
--> statement-breakpoint
-- When an account could first order: whenever "approved" turns on, however it happens (customer
-- form, opening an account, a script).
CREATE OR REPLACE FUNCTION "customers_approved_at"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.approved AND (TG_OP = 'INSERT' OR NOT OLD.approved) THEN
    NEW.approved_at := CASE WHEN TG_OP = 'INSERT' THEN coalesce(NEW.approved_at, now()) ELSE now() END;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "customers_approved_at" BEFORE INSERT OR UPDATE OF "approved" ON "customers" FOR EACH ROW EXECUTE FUNCTION "customers_approved_at"();
