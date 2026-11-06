import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { guardQueries, QUERY_TIMEOUT_MS } from "./query-timeout";
import { databaseUrl } from "./url";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as { __dpDb?: Promise<DB>; __dpClient?: unknown };

/**
 * DATABASE_URL set → real Postgres (Supabase, Neon, …); run `npm run db:migrate` first.
 * Otherwise → embedded PGlite in .data/pglite, migrated and seeded with demo data on first use.
 */
export function getDb(): Promise<DB> {
  if (!globalForDb.__dpDb) {
    const pending: Promise<DB> = init().catch((err) => {
      if (globalForDb.__dpDb === pending) globalForDb.__dpDb = undefined;
      throw err;
    });
    globalForDb.__dpDb = pending;
  }
  return globalForDb.__dpDb;
}

async function init(): Promise<DB> {
  const url = databaseUrl();
  if (url) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const client = postgres(transactionPoolerUrl(url), {
      // prepare: false keeps it compatible with transaction-mode poolers (Supabase :6543).
      prepare: false,
      max: 5,
      // Give connections back when idle, so instances that are quiet (or frozen between
      // requests) don't sit on the pooler's limited slots and starve everyone else, and so a
      // connection is rarely old enough to have been dropped by the network underneath.
      idle_timeout: 20,
      max_lifetime: 60 * 10,
      // A pooler that can't hand out a connection should fail fast, not leave the page loading.
      connect_timeout: 10,
    });
    globalForDb.__dpClient = client;
    // A stuck query means this server's connections are dead. Drop them all (which fails the
    // waiting queries now, so the page shows "Try again" instead of loading for minutes) and let
    // the next request connect afresh.
    const onStuck = () => {
      if (globalForDb.__dpClient !== client) return; // already replaced
      console.error(`Database query got no answer in ${QUERY_TIMEOUT_MS / 1000}s; dropping the connections and reconnecting.`);
      globalForDb.__dpClient = undefined;
      globalForDb.__dpDb = undefined;
      client.end({ timeout: 0 }).catch(() => {});
    };
    const db = drizzle(guardQueries(client, onStuck), { schema }) as unknown as DB;
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

/**
 * Supabase's pooler on :5432 is session mode: each app connection keeps a real database
 * connection for as long as it's open, and a handful of server instances use them all up (every
 * page then waits until it times out). The same pooler on :6543 is transaction mode, which shares
 * them per query. The app is written for transaction mode, so use it.
 */
export function transactionPoolerUrl(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith(".pooler.supabase.com") && (u.port === "5432" || u.port === "")) {
      u.port = "6543";
      return u.toString();
    }
  } catch {}
  return url;
}

async function ensureSettingsRow(db: DB) {
  await db.insert(schema.settings).values({ id: 1 }).onConflictDoNothing();
}

export { schema };
