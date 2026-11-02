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

/**
 * Supabase's project address and its direct database address (db.<ref>.supabase.co, IPv6 only)
 * can't be reached from Vercel. Returns a message pointing at the pooler address instead.
 */
export function supabaseAddressProblem(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const m = /^(?:db\.)?([a-z0-9]{20})\.supabase\.co$/.exec(host);
  if (!m) return null;
  return [
    `DATABASE_URL points at ${host}, which Vercel can't reach (it's Supabase's ${host.startsWith("db.") ? "direct, IPv6-only database address" : "API address, not a database"}).`,
    "Use the pooler address instead: Supabase → Connect → Transaction pooler, e.g.",
    `postgresql://postgres.${m[1]}:YOUR-PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres`,
  ].join("\n");
}
