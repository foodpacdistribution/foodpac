/**
 * The production Postgres connection string: DATABASE_URL, or POSTGRES_URL as set by the
 * Supabase / Neon Vercel integrations. Extra query parameters the integrations add (e.g.
 * Supabase's `supa=`) are dropped, because the driver would send them to the server as
 * settings and the connection would be refused. undefined → local embedded database.
 */
export function databaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    for (const key of [...u.searchParams.keys()]) if (key !== "sslmode") u.searchParams.delete(key);
    return u.toString();
  } catch {
    return raw;
  }
}
