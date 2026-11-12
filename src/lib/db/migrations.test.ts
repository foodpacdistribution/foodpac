import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The migrator applies a migration only when its time is later than the last one the database
// has, so one dated earlier than the migration before it is skipped on a live database (a fresh
// test database still runs them all). That took the driver app down on 12 Nov 2026.
describe("drizzle migrations", () => {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; when: number; tag: string }[] };

  it("are dated in the order they run", () => {
    journal.entries.forEach((e, i) => {
      if (i > 0) expect(e.when, `${e.tag} must be dated after ${journal.entries[i - 1].tag}`).toBeGreaterThan(journal.entries[i - 1].when);
    });
  });

  it("each have their SQL file", () => {
    const files = new Set(readdirSync("drizzle").filter((f) => f.endsWith(".sql")));
    for (const e of journal.entries) expect(files.has(`${e.tag}.sql`), e.tag).toBe(true);
  });
});
