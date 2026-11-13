import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "./db";
import { checkDatabaseSize, databaseSizeMb } from "./db-size";
import { resetReported } from "./report-error";

const db = drizzle(new PGlite(), { schema }) as unknown as DB;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetReported();
});

describe("database size", () => {
  it("reads the size", async () => {
    expect(await databaseSizeMb(db)).toBeGreaterThan(0);
  });

  it("emails the office only past the alert size", async () => {
    const sent: { subject: string }[] = [];
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("OFFICE_EMAIL", "office@example.com");
    vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, text: async () => "{}" };
    });
    const mb = (await checkDatabaseSize(db))!;
    expect(sent).toEqual([]);
    vi.stubEnv("DB_SIZE_ALERT_MB", String(Math.max(1, mb)));
    await checkDatabaseSize(db);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("Database size");
  });
});
