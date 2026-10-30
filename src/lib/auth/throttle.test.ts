import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "../db";
import { schema } from "../db";
import { clearAttempts, countAttempt, LOGIN_LIMITS, loginKeys } from "./throttle";

let db: DB;

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  db = lite as unknown as DB;
}, 30000);

describe("login throttle", () => {
  it("blocks an email after the limit, for about the rest of the window", async () => {
    const keys = loginKeys("a@x.test", null);
    for (let i = 0; i < LOGIN_LIMITS.email; i++) expect(await countAttempt(db, keys)).toBe(0);
    const wait = await countAttempt(db, keys);
    expect(wait).toBeGreaterThan(14 * 60);
    expect(wait).toBeLessThanOrEqual(15 * 60);
  });

  it("allows attempts again once the window has passed", async () => {
    const keys = loginKeys("b@x.test", null);
    for (let i = 0; i <= LOGIN_LIMITS.email; i++) await countAttempt(db, keys);
    await db.execute(sql`update login_throttle set window_start = now() - interval '16 minutes' where key = 'email:b@x.test'`);
    expect(await countAttempt(db, keys)).toBe(0);
  });

  it("clearing the email count (after a successful sign-in) resets it", async () => {
    const keys = loginKeys("c@x.test", null);
    for (let i = 0; i < LOGIN_LIMITS.email; i++) await countAttempt(db, keys);
    await clearAttempts(db, [keys[0].key]);
    expect(await countAttempt(db, keys)).toBe(0);
  });

  it("limits one IP across many emails", async () => {
    let blocked = 0;
    for (let i = 0; i <= LOGIN_LIMITS.ip; i++) blocked = await countAttempt(db, loginKeys(`user${i}@x.test`, "203.0.113.9"));
    expect(blocked).toBeGreaterThan(0);
  });

  it("counts parallel attempts without losing any", async () => {
    const keys = loginKeys("d@x.test", null);
    const waits = await Promise.all(Array.from({ length: 12 }, () => countAttempt(db, keys)));
    expect(waits.filter((w) => w === 0)).toHaveLength(LOGIN_LIMITS.email);
  });
});
