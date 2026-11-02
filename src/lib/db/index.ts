import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { databaseUrl } from "./url";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as { __dpDb?: Promise<DB> };

/**
 * DATABASE_URL set → real Postgres (Supabase, Neon, …); run `npm run db:migrate` first.
 * Otherwise → embedded PGlite in .data/pglite, migrated and seeded with demo data on first use.
 */
export function getDb(): Promise<DB> {
  globalForDb.__dpDb ??= init().catch((err) => {
    globalForDb.__dpDb = undefined;
    throw err;
  });
  return globalForDb.__dpDb;
}

async function init(): Promise<DB> {
  const url = databaseUrl();
  if (url) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    // prepare: false keeps it compatible with transaction-mode poolers (Supabase :6543).
    const db = drizzle(postgres(url, { prepare: false, max: 5 }), { schema }) as unknown as DB;
    await ensureSettingsRow(db);
    return db;
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = process.env.PGLITE_DIR ?? ".data/pglite";
  // PGlite creates the final directory but not its parents.
  (await import("node:fs")).mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const lite = drizzle(client, { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  const db = lite as unknown as DB;
  await ensureSettingsRow(db);
  const { seedDemo, seedShopDemo } = await import("./seed");
  await seedDemo(db);
  await seedShopDemo(db);
  return db;
}

async function ensureSettingsRow(db: DB) {
  await db.insert(schema.settings).values({ id: 1 }).onConflictDoNothing();
}

export { schema };
