/**
 * Healthy queries answer in milliseconds. One that hasn't answered in this long is stuck — almost
 * always on a connection that died while the server was idle (the database never sees the query,
 * and the operating system takes many minutes to notice). Waiting it out is what left pages
 * loading until Vercel killed them after 300 s.
 */
export const QUERY_TIMEOUT_MS = 10_000;

/**
 * A pool nobody has used for this long is replaced before the next request uses it. Vercel freezes
 * a quiet server instance, and connections that sat through a freeze are often dead: the first
 * query on one would hang until QUERY_TIMEOUT_MS. A fresh connection costs milliseconds in-region.
 * (Shorter than the pool's idle_timeout of 20 s, whose timers don't run while frozen.)
 */
export const STALE_POOL_MS = 15_000;

/** When a pool last did anything and how much it is doing now, to tell when it is safe to replace. */
export class PoolActivity {
  last = Date.now();
  busy = 0;
  constructor(private now: () => number = Date.now) {
    this.last = now();
  }
  start() {
    this.busy += 1;
    this.last = this.now();
  }
  end() {
    this.busy = Math.max(0, this.busy - 1);
    this.last = this.now();
  }
  touch() {
    this.last = this.now();
  }
  /** Idle for longer than `ms`, with nothing in flight. */
  stale(ms = STALE_POOL_MS) {
    return this.busy === 0 && this.now() - this.last > ms;
  }
}

type Thenable = PromiseLike<unknown>;
type Client = { unsafe: (...args: never[]) => Thenable; begin?: unknown; savepoint?: unknown };

/**
 * Lets at most `max` queries (or transactions) through at once and queues the rest.
 *
 * postgres.js sends a query down a connection that is still busy with another one ("pipelining")
 * whenever all its connections are in use. Supabase's transaction pooler (Supavisor, port 6543)
 * can lose such a query: it never reaches the database, so no error and no answer — the page just
 * waits until the 10 s cut-off (postgres.js issue #970; seen in production 2026-11-09 on plain
 * reads during busy pages). With no more in flight than there are connections, a free connection
 * is always there and nothing is ever pipelined. Waiting for a turn takes milliseconds.
 */
export class Slots {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(readonly max: number) {}
  get inUse() {
    return this.active;
  }
  async acquire() {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
  release() {
    const next = this.waiting.shift();
    if (next) next(); // the slot passes straight to the next in line
    else this.active = Math.max(0, this.active - 1);
  }
}

type Guard = { onStuck: (query: string) => void; timeoutMs: number; activity?: PoolActivity; slots?: Slots };

/**
 * Wraps a postgres.js client so every query Drizzle sends through it (including the ones inside
 * transactions and savepoints) calls `onStuck` if it runs past `timeoutMs`. `onStuck` should drop
 * the connections: that fails the stuck queries straight away instead of leaving them hanging.
 */
export function guardQueries<T extends object>(
  client: T,
  onStuck: (query: string) => void,
  timeoutMs = QUERY_TIMEOUT_MS,
  activity?: PoolActivity,
  slots?: Slots,
): T {
  return guard(client, { onStuck, timeoutMs, activity, slots });
}

function guard<T extends object>(client: T, g: Guard): T {
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== "function") return value;
      if (prop === "unsafe") {
        const unsafe = value as (...a: unknown[]) => Thenable & { values: () => Thenable };
        return (...args: unknown[]) => deferredQuery((asValues) => runQuery(() => (asValues ? unsafe.apply(target, args).values() : unsafe.apply(target, args)), String(args[0]), g));
      }
      if (prop === "begin" || prop === "savepoint") {
        // begin([options,] fn). postgres.js sends BEGIN and COMMIT/ROLLBACK (SAVEPOINT/RELEASE)
        // itself, so those waits are timed here; the queries in between get the same guard, minus
        // the slots: they run on the transaction's own connection. The transaction as a whole may
        // take longer (an import runs many queries).
        return async (...args: unknown[]) => {
          const fn = args.pop() as (tx: object) => unknown;
          await g.slots?.acquire();
          g.activity?.start();
          let timer = arm(() => g.onStuck(prop === "begin" ? "BEGIN" : "SAVEPOINT"), g.timeoutMs);
          try {
            return await (value as (...a: unknown[]) => Thenable).apply(target, [
              ...args,
              async (tx: object) => {
                clearTimeout(timer);
                try {
                  return await fn(guard(tx as Client, { ...g, slots: undefined }));
                } finally {
                  timer = arm(() => g.onStuck("COMMIT"), g.timeoutMs);
                }
              },
            ]);
          } finally {
            clearTimeout(timer);
            g.activity?.end();
            g.slots?.release();
          }
        };
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

/** Waits for a slot, then sends the query and times it; the slot is freed when it settles. */
async function runQuery(send: () => Thenable, text: string, g: Guard) {
  await g.slots?.acquire();
  g.activity?.start();
  const timer = arm(() => g.onStuck(text.slice(0, 300)), g.timeoutMs);
  try {
    return await send();
  } finally {
    clearTimeout(timer);
    g.activity?.end();
    g.slots?.release();
  }
}

/**
 * Stands in for a postgres.js query until it is awaited, so it only starts once it has a slot.
 * Drizzle uses `await client.unsafe(…)` and `await client.unsafe(…).values()`; both work.
 */
function deferredQuery(start: (asValues: boolean) => Promise<unknown>) {
  let asValues = false;
  let running: Promise<unknown> | undefined;
  const run = () => (running ??= start(asValues));
  const q = {
    values() {
      asValues = true;
      return q;
    },
    then<A = unknown, B = never>(ok?: ((v: unknown) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
      return run().then(ok, fail);
    },
    catch<B = never>(fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
      return run().catch(fail);
    },
    finally(f?: (() => void) | null) {
      return run().finally(f);
    },
  };
  return q;
}

function arm(onStuck: () => void, timeoutMs: number) {
  const timer = setTimeout(onStuck, timeoutMs);
  timer.unref?.();
  return timer;
}
