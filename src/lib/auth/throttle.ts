import { inArray, sql } from "drizzle-orm";
import type { DB } from "../db";
import { loginThrottle } from "../db/schema";

// Every sign-in attempt is counted before the password is checked, in one
// atomic upsert, so firing many guesses in parallel can't slip past the limit.
// A successful sign-in clears the email's count; the IP count only expires.

export const LOGIN_WINDOW_MIN = 15;
/** Attempts allowed per window. The IP limit is higher because offices share one address. */
export const LOGIN_LIMITS = { email: 5, ip: 30 };

export type ThrottleKey = { key: string; max: number };

export function loginKeys(email: string, ip: string | null): ThrottleKey[] {
  const keys = [{ key: `email:${email}`, max: LOGIN_LIMITS.email }];
  if (ip) keys.push({ key: `ip:${ip}`, max: LOGIN_LIMITS.ip });
  return keys;
}

/** Counts one attempt against every key. Returns seconds until the caller may try again, or 0 if allowed. */
export async function countAttempt(db: DB, keys: ThrottleKey[]): Promise<number> {
  const expired = sql`${loginThrottle.windowStart} < now() - make_interval(mins => ${LOGIN_WINDOW_MIN})`;
  let waitS = 0;
  for (const { key, max } of keys) {
    const [row] = await db
      .insert(loginThrottle)
      .values({ key, attempts: 1 })
      .onConflictDoUpdate({
        target: loginThrottle.key,
        set: {
          attempts: sql`case when ${expired} then 1 else ${loginThrottle.attempts} + 1 end`,
          windowStart: sql`case when ${expired} then now() else ${loginThrottle.windowStart} end`,
        },
      })
      .returning({
        attempts: loginThrottle.attempts,
        retryS: sql<number>`ceil(extract(epoch from ${loginThrottle.windowStart} + make_interval(mins => ${LOGIN_WINDOW_MIN}) - now()))::int`,
      });
    if (row.attempts > max) waitS = Math.max(waitS, row.retryS);
  }
  return waitS;
}

export async function clearAttempts(db: DB, keys: string[]) {
  await db.delete(loginThrottle).where(inArray(loginThrottle.key, keys));
}
