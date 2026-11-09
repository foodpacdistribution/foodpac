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
 * Wraps a postgres.js client so every query Drizzle sends through it (including the ones inside
 * transactions and savepoints) calls `onStuck` if it runs past `timeoutMs`. `onStuck` should drop
 * the connections: that fails the stuck queries straight away instead of leaving them hanging.
 */
export function guardQueries<T extends object>(client: T, onStuck: (query: string) => void, timeoutMs = QUERY_TIMEOUT_MS, activity?: PoolActivity): T {
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== "function") return value;
      if (prop === "unsafe") {
        return (...args: unknown[]) =>
          watch((value as (...a: unknown[]) => Thenable).apply(target, args), () => onStuck(String(args[0]).slice(0, 300)), timeoutMs, activity);
      }
      if (prop === "begin" || prop === "savepoint") {
        // begin([options,] fn). postgres.js sends BEGIN and COMMIT/ROLLBACK (SAVEPOINT/RELEASE)
        // itself, so those waits are timed here; the queries in between get the same guard. The
        // transaction as a whole may take longer (an import runs many queries).
        return (...args: unknown[]) => {
          const fn = args.pop() as (tx: object) => unknown;
          activity?.start();
          let timer = arm(() => onStuck("BEGIN"), timeoutMs);
          const result = (value as (...a: unknown[]) => Thenable).apply(target, [
            ...args,
            async (tx: object) => {
              clearTimeout(timer);
              try {
                return await fn(guardQueries(tx as Client, onStuck, timeoutMs, activity));
              } finally {
                timer = arm(() => onStuck("COMMIT"), timeoutMs);
              }
            },
          ]);
          const done = () => {
            clearTimeout(timer);
            activity?.end();
          };
          result.then(done, done);
          return result;
        };
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

function arm(onStuck: () => void, timeoutMs: number) {
  const timer = setTimeout(onStuck, timeoutMs);
  timer.unref?.();
  return timer;
}

function watch<Q extends Thenable>(query: Q, onStuck: () => void, timeoutMs: number, activity?: PoolActivity): Q {
  activity?.start();
  const timer = arm(onStuck, timeoutMs);
  const done = () => {
    clearTimeout(timer);
    activity?.end();
  };
  // postgres.js queries run when first awaited and wait a tick before sending, so Drizzle's
  // `.values()` right after this still applies. The query object itself is returned unchanged.
  query.then(done, done);
  return query;
}
