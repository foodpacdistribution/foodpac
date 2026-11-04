CREATE TABLE "posters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"eyebrow" text DEFAULT '' NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"button_label" text DEFAULT '' NOT NULL,
	"href" text DEFAULT '' NOT NULL,
	"focus" text DEFAULT 'center' NOT NULL,
	"image" "bytea" NOT NULL,
	"image_mime" text NOT NULL,
	"mobile_image" "bytea",
	"mobile_image_mime" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "built_in_posters" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Like every table (0007): not reachable through the Supabase Data API, only by the app.
ALTER TABLE "posters" ENABLE ROW LEVEL SECURITY;
