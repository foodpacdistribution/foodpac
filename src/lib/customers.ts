import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { codeTaken, syncCustomerCodes } from "./customer-code";
import { checkCustomerRow, codeKey, type CustomerImportRow, type CustomerValues, duplicateCustomers, nameKey } from "./customer-import";
import type { DB } from "./db";
import { customers, orders } from "./db/schema";

const digits = (v: string | null) => (v ?? "").replace(/\D/g, "");

/**
 * Links unlinked orders to a customer when the order's customer name matches exactly
 * (ignoring case and spacing) or its phone number matches (last 9 digits, so +61 4xx and
 * 04xx are the same). Runs when a customer is saved and when they open the portal, so
 * orders from imports, the API and feeds show up without extra work.
 */
export async function linkOrdersToCustomer(db: DB, c: { id: string; name: string; phone: string | null }) {
  const name = c.name.trim().toLowerCase().replace(/\s+/g, " ");
  const phone = digits(c.phone).slice(-9);
  const byName = sql`lower(regexp_replace(trim(${orders.customerName}), '\\s+', ' ', 'g')) = ${name}`;
  const byPhone = sql`right(regexp_replace(coalesce(${orders.phone}, ''), '\\D', '', 'g'), 9) = ${phone}`;
  await db
    .update(orders)
    .set({ customerId: c.id })
    .where(and(isNull(orders.customerId), phone.length >= 8 ? or(byName, byPhone) : byName));
}

export async function unlinkCustomerOrders(db: DB, customerId: string) {
  await db.update(orders).set({ customerId: null }).where(eq(orders.customerId, customerId));
}

export type CustomerImportResult = { created: number; updated: number; errors: { row: number; message: string }[] };

/**
 * Adds and updates customers from spreadsheet rows. Rows are matched by customer code (ignoring
 * case); a row without a code matches a customer with the same name. New customers keep the code
 * from the file, or get the next C-number, and count as won customers (they're from the old
 * system, not leads). Empty cells leave the current value alone. Every row is checked; nothing is
 * saved if any row has a problem.
 */
export async function applyCustomerImport(db: DB, rows: CustomerImportRow[]) {
  const errors: CustomerImportResult["errors"] = [];
  const checked: { row: number; v: CustomerValues }[] = [];
  const dupes = duplicateCustomers(rows);
  rows.forEach((r, i) => {
    if (dupes.has(i)) return errors.push({ row: i + 2, message: `Same customer as row ${dupes.get(i)! + 2}` });
    const c = checkCustomerRow(r);
    if (c.ok) checked.push({ row: i + 2, v: c.value });
    else errors.push({ row: i + 2, message: c.error });
  });

  const existing = await db.select({ id: customers.id, code: customers.code, name: customers.name }).from(customers);
  const byCode = new Map(existing.map((c) => [codeKey(c.code), c]));
  const byName = new Map<string, (typeof existing)[number]>();
  for (const c of existing) if (!byName.has(nameKey(c.name))) byName.set(nameKey(c.name), c);
  const plan = checked.map(({ row, v }) => {
    const match = v.code ? byCode.get(codeKey(v.code)) : byName.get(nameKey(v.name!));
    if (!match && !v.name) errors.push({ row, message: `New customer ${v.code} needs a business name` });
    // Matched by name: the name is the same apart from case and spaces, so keep how it's written now.
    if (match && !v.code) delete v.name;
    return { v, match };
  });
  const created: { id: string; name: string; phone: string | null }[] = [];
  if (errors.length) return { result: { created: 0, updated: 0, errors: errors.sort((a, b) => a.row - b.row) }, created };

  let updated = 0;
  await db
    .transaction(async (t) => {
      const tx = t as unknown as DB;
      const toCreate = plan.filter((p) => !p.match);
      for (let i = 0; i < toCreate.length; i += 200) {
        const ins = await tx
          .insert(customers)
          .values(toCreate.slice(i, i + 200).map(({ v }) => ({ ...v, name: v.name!, approved: true, salesStage: "won" as const })))
          .returning({ id: customers.id, name: customers.name, phone: customers.phone });
        created.push(...ins);
      }
      for (const { v, match } of plan) {
        if (!match || !Object.keys(v).length) continue;
        await tx.update(customers).set(v).where(eq(customers.id, match.id));
        updated++;
      }
    })
    .catch((err) => codeTaken(err));
  await syncCustomerCodes(db);
  return { result: { created: created.length, updated, errors: [] }, created };
}
