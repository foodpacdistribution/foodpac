CREATE TABLE "goods_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
