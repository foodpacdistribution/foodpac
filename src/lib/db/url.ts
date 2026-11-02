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

/** Catches the usual copy-paste mistakes in the password part of the connection string. */
export function passwordProblem(url: string): string | null {
  let pw: string;
  try {
    pw = decodeURIComponent(new URL(url).password);
  } catch {
    return "DATABASE_URL isn't a valid address. If the password contains @ # / ? : or %, write them as %40 %23 %2F %3F %3A %25.";
  }
  if (!pw) return "DATABASE_URL has no password. Add your Supabase database password after the user name: postgres.<ref>:PASSWORD@…";
  if (/[[\]]/.test(pw) || /your[-_ ]?(db[-_ ]?)?password/i.test(pw)) {
    return "DATABASE_URL still contains the placeholder. Replace [YOUR-PASSWORD] (including the square brackets) with your database password.";
  }
  if (/^(sb_(secret|publishable)_|eyJ)/.test(pw)) {
    return "The password in DATABASE_URL is a Supabase API key. Use the database password instead (Supabase → Project Settings → Database).";
  }
  return null;
}
