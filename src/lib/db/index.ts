import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { guardQueries, PoolActivity, QUERY_TIMEOUT_MS } from "./query-timeout";
import { databaseUrl } from "./url";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as {
  __dpDb?: Promise<DB>;
  __dpClient?: { end: (o: { timeout: number }) => Promise<void> };
  __dpActivity?: PoolActivity;
  __dpSettingsRow?: boolean;
};

/** Drops this server's database connections; the next getDb() connects afresh. */
function dropPool() {
  const client = globalForDb.__dpClient;
  globalForDb.__dpClient = undefined;
  globalForDb.__dpActivity = undefined;
  globalForDb.__dpDb = undefined;
  client?.end({ timeout: 0 }).catch(() => {});
}

/**
 * DATABASE_URL set → real Postgres (Supabase, Neon, …); run `npm run db:migrate` first.
 * Otherwise → embedded PGlite in .data/pglite, migrated and seeded with demo data on first use.
 */
export function getDb(): Promise<DB> {
  // Quiet for a while (likely frozen in between): its connections may be dead, so start afresh
  // rather than let the first query hang. Never while a query or transaction is still running.
  if (globalForDb.__dpActivity?.stale()) dropPool();
  // Handing the pool out counts as use, so another request can't drop it before this one's first query.
  globalForDb.__dpActivity?.touch();
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
    const activity = new PoolActivity();
    globalForDb.__dpClient = client;
    globalForDb.__dpActivity = activity;
    // A stuck query means this server's connections are dead. Drop them all (which fails the
    // waiting queries now, so the page retries instead of loading for minutes) and let the next
    // request connect afresh.
    const onStuck = (query: string) => {
      if (globalForDb.__dpClient !== client) return; // already replaced
      // Names the query that hung; the others failing right after it are only cut off with it.
      console.error(`Database query got no answer in ${QUERY_TIMEOUT_MS / 1000}s; dropping the connections and reconnecting. Stuck query: ${query}`);
      dropPool();
      void endAbandonedTransactions(postgres, transactionPoolerUrl(url));
    };
    const db = drizzle(guardQueries(client, onStuck, QUERY_TIMEOUT_MS, activity), { schema }) as unknown as DB;
    // Once per server instance, not on every reconnect.
    if (!globalForDb.__dpSettingsRow) {
      await ensureSettingsRow(db);
      globalForDb.__dpSettingsRow = true;
    }
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

/**
 * A query usually gets stuck behind locks held by a transaction whose server froze or died
 * half-way: the database keeps it open, and every write to those rows waits. End this app's
 * transactions that have sat idle for over 2 minutes (the app never pauses a transaction that
 * long), so the next request goes through. The database does this itself after 60 s for sessions
 * opened since migration 0022; this covers the long-lived pooler sessions opened before it.
 */
async function endAbandonedTransactions(postgres: typeof import("postgres"), url: string) {
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 5, idle_timeout: 1 });
  try {
    const ended = await sql`
      select pid, now() - state_change as idle_for, left(query, 200) as query, pg_terminate_backend(pid) as ended
      from pg_stat_activity
      where datname = current_database() and usename = current_user and pid <> pg_backend_pid()
        and state in ('idle in transaction', 'idle in transaction (aborted)')
        and state_change < now() - interval '2 minutes'`;
    if (ended.length) console.error(`Ended ${ended.length} abandoned database transaction(s):`, ended);
  } catch (err) {
    console.error("Couldn't check for abandoned database transactions:", err);
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

async function ensureSettingsRow(db: DB) {
  await db.insert(schema.settings).values({ id: 1 }).onConflictDoNothing();
}

export { schema };
