"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { hashPassword } from "@/lib/auth/password";
import { codeTaken, syncCustomerCodes } from "@/lib/customer-code";
import { cleanCode, type CustomerImportRow, MAX_CUSTOMER_ROWS } from "@/lib/customer-import";
import { applyCustomerImport, type CustomerImportResult, linkOrdersToCustomer } from "@/lib/customers";
import { getDb } from "@/lib/db";
import { accountApproved } from "@/lib/notify";
import { customers, type PaymentTerms, salesOrders, users } from "@/lib/db/schema";
import { parseDollars } from "@/lib/money";
import { isSalesStage } from "@/lib/sales-stage";
import { UserError } from "@/lib/planning";

export async function saveCustomer(_prev: unknown, form: FormData) {
  return attempt(async () => {
    await assertUser(STAFF);
    const db = await getDb();
    const get = (k: string) => String(form.get(k) ?? "").trim();
    const id = get("id") || null;
    const name = get("name");
    if (!name) throw new UserError("Business name is required.");
    // Blank: a new customer gets the next C-number; an existing one keeps its code.
    let code: string | undefined;
    try {
      code = get("code") ? cleanCode(get("code")) : undefined;
    } catch (e) {
      throw new UserError(`${(e as Error).message}.`);
    }
    const values = {
      ...(code ? { code } : {}),
      name,
      phone: get("phone") || null,
      email: get("email").toLowerCase() || null,
      address: get("address") || null,
      abn: get("abn") || null,
      active: form.get("active") === "on",
      approved: form.get("approved") === "on",
      paymentTerms: (["prepay", "net7", "net14", "net30"].includes(get("paymentTerms")) ? get("paymentTerms") : "prepay") as PaymentTerms,
      creditLimitCents: get("creditLimit") ? parseDollars(get("creditLimit")) : null,
    };
    const stage = get("salesStage");
    if (get("creditLimit") && values.creditLimitCents === null) throw new UserError("Credit limit must be an amount, e.g. 5000.");

    const loginEmail = get("loginEmail").toLowerCase();
    const loginName = get("loginName") || name;
    const password = get("password");
    if (password && password.length < 8) throw new UserError("Password must be at least 8 characters.");

    const [before] = id ? await db.select({ approved: customers.approved, stage: customers.salesStage }).from(customers).where(eq(customers.id, id)).limit(1) : [];
    // The office form can move the sales stage too; the date only changes when the stage does.
    const stageFields = isSalesStage(stage) && stage !== before?.stage ? { salesStage: stage, salesStageAt: new Date() } : {};
    const customerId = await db.transaction(async (tx) => {
      let customerId = id;
      if (id) await tx.update(customers).set({ ...values, ...stageFields }).where(eq(customers.id, id));
      else customerId = (await tx.insert(customers).values({ ...values, ...stageFields }).returning({ id: customers.id }))[0].id;

      if (!loginEmail) return customerId!;
      const [login] = await tx.select().from(users).where(eq(users.customerId, customerId!)).limit(1);
      const [taken] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, loginEmail), ...(login ? [ne(users.id, login.id)] : [])))
        .limit(1);
      if (taken) throw new UserError("That email is already used by another login.");
      if (login) {
        await tx
          .update(users)
          .set({ email: loginEmail, name: loginName, ...(password ? { passwordHash: await hashPassword(password) } : {}) })
          .where(eq(users.id, login.id));
      } else {
        if (!password) throw new UserError("Set a password to create the customer's portal login.");
        await tx.insert(users).values({ email: loginEmail, name: loginName, role: "customer", customerId, passwordHash: await hashPassword(password) });
      }
      return customerId!;
    }).catch((err) => codeTaken(err, code));

    if (code) await syncCustomerCodes(db);
    await linkOrdersToCustomer(db, { id: customerId, name, phone: values.phone });
    // Registration promises an email once the account can order.
    if (before && !before.approved && values.approved) after(() => accountApproved(customerId));
    revalidatePath("/admin/customers");
    revalidatePath("/admin/pipeline");
    return { message: id ? "Customer updated" : "Customer added" };
  });
}

export async function removeCustomerLogin(customerId: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    const db = await getDb();
    await db.delete(users).where(and(eq(users.customerId, customerId), eq(users.role, "customer")));
    revalidatePath("/admin/customers");
    return { message: "Portal login removed" };
  });
}

/** Admin only. Their login, addresses, cart and price list go too; delivery orders stay but are unlinked. */
export async function deleteCustomer(id: string) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    if (user.role !== "admin") throw new UserError("Only an admin can delete customers.");
    const db = await getDb();
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(salesOrders).where(eq(salesOrders.customerId, id));
    if (n > 0) throw new UserError(`This customer has ${n} shop order${n === 1 ? "" : "s"}. Delete those in Sales Orders first.`);
    const [c] = await db.delete(customers).where(eq(customers.id, id)).returning({ name: customers.name });
    if (!c) throw new UserError("Customer not found.");
    revalidatePath("/admin/customers");
    return { message: `${c.name} deleted` };
  });
}

export type { CustomerImportResult };

/**
 * Adds and updates customers from a spreadsheet (see applyCustomerImport). Nothing is saved if
 * any row has a problem.
 */
export async function importCustomers(rows: CustomerImportRow[]) {
  return attempt<CustomerImportResult>(async () => {
    await assertUser(STAFF);
    if (!Array.isArray(rows) || !rows.length) throw new UserError("The file has no rows.");
    if (rows.length > MAX_CUSTOMER_ROWS) throw new UserError(`Import at most ${MAX_CUSTOMER_ROWS} customers at a time.`);
    const db = await getDb();
    const { result, created } = await applyCustomerImport(db, rows);
    if (result.errors.length) return { data: result };
    // Delivery orders already in the system find their customer by name or phone.
    after(async () => {
      const db = await getDb();
      for (const c of created) await linkOrdersToCustomer(db, c);
    });
    revalidatePath("/admin/customers");
    revalidatePath("/admin/pipeline");
    return { data: result };
  });
}
