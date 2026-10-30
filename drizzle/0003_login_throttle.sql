CREATE TABLE "login_throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL
);
