// Applies drizzle/ migrations to the Postgres in DATABASE_URL (Supabase, Neon, …).
// Local development doesn't need this: the embedded database migrates itself.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = postgres(url, { max: 1, prepare: false });
await migrate(drizzle(client), { migrationsFolder: "drizzle" });
await client`insert into settings (id) values (1) on conflict do nothing`;
await client.end();
console.log("Migrations applied.");
