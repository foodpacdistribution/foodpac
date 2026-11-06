import { createServer, type Server, type Socket } from "node:net";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { guardQueries } from "./query-timeout";

// A "database" that lets the client sign in and then never answers a query: what a connection
// that died while the server was idle looks like from the app's side.
function silentDatabase(): Promise<{ server: Server; port: number }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let signedIn = false;
    socket.on("data", () => {
      if (signedIn) return; // swallow every query
      signedIn = true;
      const authOk = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]); // 'R' AuthenticationOk
      const ready = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]); // 'Z' ReadyForQuery (idle)
      socket.write(Buffer.concat([authOk, ready]));
    });
  });
  server.on("close", () => sockets.forEach((s) => s.destroy()));
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port })));
}

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function setup() {
  const { server, port } = await silentDatabase();
  const client = postgres({ host: "127.0.0.1", port, user: "u", database: "d", fetch_types: false, prepare: false, max: 2 });
  let stuck = 0;
  const db = drizzle(
    guardQueries(client, () => {
      stuck += 1;
      client.end({ timeout: 0 }).catch(() => {});
    }, 200),
  );
  cleanup = async () => {
    await client.end({ timeout: 0 }).catch(() => {});
    await new Promise((r) => server.close(r));
  };
  return { db, stuckCount: () => stuck };
}

describe("guardQueries", () => {
  it("fails a query that gets no answer instead of waiting forever", async () => {
    const { db, stuckCount } = await setup();
    const started = Date.now();
    await expect(db.execute(sql`select 1`)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(stuckCount()).toBe(1);
  });

  it("also covers queries inside a transaction", async () => {
    const { db, stuckCount } = await setup();
    const started = Date.now();
    await expect(db.transaction(async (tx) => tx.execute(sql`select 1`))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(stuckCount()).toBeGreaterThanOrEqual(1);
  });

  it("leaves queries that answer in time alone", async () => {
    let stuck = 0;
    const answered = Object.assign(Promise.resolve([{ n: 1 }]), { values: () => answered });
    const client = guardQueries({ unsafe: () => answered }, () => (stuck += 1), 50);
    await expect(client.unsafe()).resolves.toEqual([{ n: 1 }]);
    await new Promise((r) => setTimeout(r, 100));
    expect(stuck).toBe(0);
  });
});
