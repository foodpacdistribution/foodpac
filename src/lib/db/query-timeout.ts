/**
 * Healthy queries answer in milliseconds. One that hasn't answered in this long is stuck — almost
 * always on a connection that died while the server was idle (the database never sees the query,
 * and the operating system takes many minutes to notice). Waiting it out is what left pages
 * loading until Vercel killed them after 300 s.
 */
export const QUERY_TIMEOUT_MS = 10_000;

type Thenable = PromiseLike<unknown>;
type Client = { unsafe: (...args: never[]) => Thenable; begin?: unknown; savepoint?: unknown };

/**
 * Wraps a postgres.js client so every query Drizzle sends through it (including the ones inside
 * transactions and savepoints) calls `onStuck` if it runs past `timeoutMs`. `onStuck` should drop
 * the connections: that fails the stuck queries straight away instead of leaving them hanging.
 */
export function guardQueries<T extends object>(client: T, onStuck: () => void, timeoutMs = QUERY_TIMEOUT_MS): T {
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== "function") return value;
      if (prop === "unsafe") {
        return (...args: unknown[]) => watch((value as (...a: unknown[]) => Thenable).apply(target, args), onStuck, timeoutMs);
      }
      if (prop === "begin" || prop === "savepoint") {
        // begin([options,] fn). postgres.js sends BEGIN and COMMIT/ROLLBACK (SAVEPOINT/RELEASE)
        // itself, so those waits are timed here; the queries in between get the same guard. The
        // transaction as a whole may take longer (an import runs many queries).
        return (...args: unknown[]) => {
          const fn = args.pop() as (tx: object) => unknown;
          let timer = arm(onStuck, timeoutMs);
          const result = (value as (...a: unknown[]) => Thenable).apply(target, [
            ...args,
            async (tx: object) => {
              clearTimeout(timer);
              try {
                return await fn(guardQueries(tx as Client, onStuck, timeoutMs));
              } finally {
                timer = arm(onStuck, timeoutMs);
              }
            },
          ]);
          const done = () => clearTimeout(timer);
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

function watch<Q extends Thenable>(query: Q, onStuck: () => void, timeoutMs: number): Q {
  const timer = arm(onStuck, timeoutMs);
  const done = () => clearTimeout(timer);
  // postgres.js queries run when first awaited and wait a tick before sending, so Drizzle's
  // `.values()` right after this still applies. The query object itself is returned unchanged.
  query.then(done, done);
  return query;
}
