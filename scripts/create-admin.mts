// Creates (or resets the password of) an admin login in the DATABASE_URL database.
// Usage: npm run create-admin -- you@company.com "Your Name" 'a-long-password'
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hashPassword } from "../src/lib/auth/password";
import { users } from "../src/lib/db/schema";
import { databaseUrl } from "../src/lib/db/url";

const [email, name, password] = process.argv.slice(2);
const url = databaseUrl();
if (!url || !email || !name || !password || password.length < 8) {
  console.error('Usage: DATABASE_URL=... npm run create-admin -- email "Name" password(8+ chars)');
  process.exit(1);
}

const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const db = drizzle(client);
const passwordHash = await hashPassword(password);
await db
  .insert(users)
  .values({ email: email.toLowerCase(), name, role: "admin", passwordHash })
  .onConflictDoUpdate({ target: users.email, set: { passwordHash, role: "admin", name } });
await client.end();
console.log(`Admin login ready: ${email.toLowerCase()}`);
