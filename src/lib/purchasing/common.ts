import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { UserError } from "../planning";

/**
 * Runs database work and turns the purchasing triggers' and constraints' refusals into a message
 * for the form: RAISE EXCEPTION (P0001) carries its own words, a CHECK (23514) means a quantity
 * went past what it may.
 */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UserError) throw err;
    const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string; constraint_name?: string; constraint?: string } };
    const code = e.cause?.code ?? e.code;
    const message = e.cause?.message ?? e.message ?? "";
    if (code === "P0001") throw new UserError(message);
    if (code === "23514") {
      const name = e.cause?.constraint_name ?? e.cause?.constraint ?? message;
      if (/purchase_order_items/.test(name)) throw new UserError("That's more than is still to come on the purchase order.");
      if (/purchase_return_items/.test(name)) throw new UserError("Quantities can't go past what was asked for, accepted or sent back.");
      throw new UserError("One of the amounts or quantities isn't allowed.");
    }
    throw err;
  }
}

/** A quantity typed in a form: a whole number of units (stock is counted in whole units). */
export function wholeQty(v: unknown, what = "Quantities", { allowZero = false } = {}) {
  const n = Number(String(v ?? "").trim() || "0");
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 999999) throw new UserError(`${what} must be whole numbers.`);
  if (!allowZero && n === 0) throw new UserError(`${what} must be more than 0.`);
  return n;
}

/** A dollar amount typed in a form ("12.50", "$1,200"), to `places` decimals. */
export function dollars(v: unknown, what: string, places = 2) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, "") || "NaN");
  if (!Number.isFinite(n) || n < 0) throw new UserError(`${what} must be an amount, e.g. 12.50.`);
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function isoDate(v: unknown, what: string) {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new UserError(`Choose ${what}.`);
  return s;
}

export const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max) || null;

/** The next document number, e.g. PO-10001, from that document's sequence. Both names are our own constants. */
export const nextNumber = (prefix: "PO-" | "GRN-" | "PR-" | "SP-" | "SR-" | "CR-" | "CT-", seq: string): SQL<string> => sql<string>`${sql.raw(`'${prefix}'`)} || nextval('${sql.raw(seq)}')`;

export const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
