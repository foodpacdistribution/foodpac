import "server-only";
import { sql } from "drizzle-orm";
import type { DB } from "./db";
import { UserError } from "./planning";

/**
 * Codes typed in or imported may look like the ones the app makes up (C10050). Moves the
 * sequence past the highest of them, so a customer added later never gets a code that's taken.
 */
export async function syncCustomerCodes(db: DB) {
  await db.execute(sql`
    select setval('customer_code_no', m)
    from (select max(substring(code from 2)::bigint) as m from customers where code ~* '^C[0-9]{1,15}$') x
    where m is not null and m >= (select last_value from customer_code_no)`);
}

/** Turns the database's "code already used" refusal into words for the form; anything else is rethrown. */
export function codeTaken(err: unknown, code?: string): never {
  const e = err as { code?: string; cause?: { code?: string; constraint_name?: string; constraint?: string; message?: string }; message?: string };
  const pgCode = e.cause?.code ?? e.code;
  const where = e.cause?.constraint_name ?? e.cause?.constraint ?? e.cause?.message ?? e.message ?? "";
  if (pgCode === "23505" && /customers_code_key/.test(where)) throw new UserError(code ? `Customer code ${code} is already used by another customer.` : "That customer code is already used by another customer.");
  throw err;
}
