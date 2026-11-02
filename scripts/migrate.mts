// Applies drizzle/ migrations to the Postgres in DATABASE_URL (Supabase, Neon, …).
// Local development doesn't need this: the embedded database migrates itself.
// On Vercel it runs before every build (vercel.json), so a deploy brings the schema up to date.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { hashPassword } from "../src/lib/auth/password";
import { databaseUrl, passwordProblem, supabaseAddressProblem } from "../src/lib/db/url";

const url = databaseUrl();
if (!url) {
  console.error("DATABASE_URL (or POSTGRES_URL) is not set. Add your Postgres connection string (Supabase → Connect → Transaction pooler).");
  process.exit(1);
}

const problem = supabaseAddressProblem(url) ?? passwordProblem(url);
if (problem) {
  console.error(problem);
  process.exit(1);
}

const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
} catch (err) {
  const code = (err as { cause?: { code?: string } }).cause?.code;
  if (code === "28P01") {
    console.error(
      [
        "The database rejected the password in DATABASE_URL. Check that:",
        "- it's the database password (Supabase → Project Settings → Database), not an API key;",
        "- the [YOUR-PASSWORD] placeholder and its brackets are gone;",
        "- @ # / ? : % in the password are written as %40 %23 %2F %3F %3A %25;",
        "- if you just reset the password, wait a minute and redeploy.",
      ].join("\n"),
    );
    process.exit(1);
  }
  throw err;
}
await client`insert into settings (id) values (1) on conflict do nothing`;

// First deploy: create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD if there is no admin yet.
// Never touches an existing account, so leaving the variables set is harmless.
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (email && password && password.length >= 8) {
  const [{ n }] = await client<{ n: number }[]>`select count(*)::int as n from users where role = 'admin'`;
  if (n === 0) {
    await client`insert into users (email, name, role, password_hash) values (${email}, ${process.env.ADMIN_NAME ?? "Admin"}, 'admin', ${await hashPassword(password)}) on conflict (email) do nothing`;
    console.log(`Created the first admin login: ${email}`);
  }
}
await client.end();
console.log("Migrations applied.");
