import { sql } from "drizzle-orm";
import type { DB } from "./db";
import { reportError } from "./report-error";

/** Supabase's free plan: past this the database turns read-only (no new orders or deliveries). */
export const PLAN_LIMIT_MB = 500;
/** Warn well before the limit, with time to upgrade or move photos out. DB_SIZE_ALERT_MB overrides it. */
const alertAtMb = () => Number(process.env.DB_SIZE_ALERT_MB) || 400;

/** How big the database is, in MB. */
export async function databaseSizeMb(db: DB) {
  const r = (await db.execute(sql`select pg_database_size(current_database())::bigint as bytes`)) as unknown;
  // postgres.js answers with the rows; the embedded database (local, tests) with { rows }.
  const rows = (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as { bytes: string | number }[];
  return Math.round(Number(rows[0]?.bytes ?? 0) / 1024 / 1024);
}

/** Emails the office once the database nears the plan's limit. Returns the size (MB), or null if it couldn't be read. */
export async function checkDatabaseSize(db: DB) {
  try {
    const mb = await databaseSizeMb(db);
    if (mb >= alertAtMb()) {
      await reportError(new Error(`The database is ${mb} MB of the ${PLAN_LIMIT_MB} MB the free plan allows`), {
        area: "Database size",
        detail: "At the limit it turns read-only: no new orders or deliveries. Upgrade the Supabase plan, or move the photos out of the database.",
      });
    }
    return mb;
  } catch (err) {
    console.error("[db size] couldn't read the database size:", err);
    return null;
  }
}
