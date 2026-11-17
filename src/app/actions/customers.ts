"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { attempt } from "@/lib/action";
import { assertUser, PIPELINE, STAFF } from "@/lib/auth/dal";
import { setCustomerLogin } from "@/lib/customer-account";
import { codeTaken, syncCustomerCodes } from "@/lib/customer-code";
import { cleanCode, type CustomerImportRow, MAX_CUSTOMER_ROWS } from "@/lib/customer-import";
import { applyCustomerImport, type CustomerImportResult, linkOrdersToCustomer, removeCustomer } from "@/lib/customers";
import { locateCustomersLater } from "@/lib/customer-locations";
import { type DB, getDb } from "@/lib/db";
import { accountApproved } from "@/lib/notify";
import { customers, type PaymentTerms, users } from "@/lib/db/schema";
import { parseDollars } from "@/lib/money";
import { isSalesStage } from "@/lib/sales-stage";
import { UserError } from "@/lib/planning";

/** What only the office sets: the account code and switching a customer off. Sales staff open accounts, so terms, credit limit and approval are theirs too. */
const OFFICE_ONLY = ["code", "active"] as const;

export async function saveCustomer(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const me = await assertUser(PIPELINE);
    // Sales staff add and edit customers, terms, credit and logins included; code and active stay with the office.
    const sales = me.role === "sales";
    const db = await getDb();
    const get = (k: string) => String(form.get(k) ?? "").trim();
    const id = get("id") || null;
    const name = get("name");
    if (!name) throw new UserError("Business name is required.");
    // Blank: a new customer gets the next C-number; an existing one keeps its code.
    let code: string | undefined;
    try {
      code = get("code") && !sales ? cleanCode(get("code")) : undefined;
    } catch (e) {
      throw new UserError(`${(e as Error).message}.`);
    }
    const all = {
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
    // From sales staff the office's fields are ignored, whatever the form sent.
    const values = sales ? Object.fromEntries(Object.entries(all).filter(([k]) => !(OFFICE_ONLY as readonly string[]).includes(k))) as Omit<typeof all, (typeof OFFICE_ONLY)[number]> : all;
    const stage = get("salesStage");
    if (get("creditLimit") && all.creditLimitCents === null) throw new UserError("Credit limit must be an amount, e.g. 5000.");

    const loginEmail = get("loginEmail").toLowerCase();
    const loginName = get("loginName") || name;
    const password = get("password");
    if (password && password.length < 8) throw new UserError("Password must be at least 8 characters.");

    const [before] = id ? await db.select({ approved: customers.approved, stage: customers.salesStage, rep: customers.salesRepId }).from(customers).where(eq(customers.id, id)).limit(1) : [];
    // The office form can move the sales stage too; the date only changes when the stage does.
    const stageFields = isSalesStage(stage) && stage !== before?.stage ? { salesStage: stage, salesStageAt: new Date(), ...(stage !== "not_now" ? { notNowReason: null } : {}) } : {};
    // As on the pipeline: a salesperson who moves an unassigned customer along takes it on.
    const repFields = sales && "salesStage" in stageFields && !before?.rep ? { salesRepId: me.id } : {};
    const customerId = await db.transaction(async (tx) => {
      let customerId = id;
      if (id) await tx.update(customers).set({ ...values, ...stageFields, ...repFields }).where(eq(customers.id, id));
      // A customer a salesperson adds is theirs to look after.
      else customerId = (await tx.insert(customers).values({ ...values, ...stageFields, ...(sales ? { salesRepId: me.id } : {}) }).returning({ id: customers.id }))[0].id;

      if (loginEmail) await setCustomerLogin(tx as unknown as DB, customerId!, { email: loginEmail, name: loginName, password });
      return customerId!;
    }).catch((err) => codeTaken(err, code));

    if (code) await syncCustomerCodes(db);
    await linkOrdersToCustomer(db, { id: customerId, name, phone: values.phone });
    // Registration promises an email once the account can order.
    if (before && !before.approved && "approved" in values && values.approved) after(() => accountApproved(customerId));
    locateCustomersLater();
    revalidatePath("/admin/customers");
    revalidatePath("/admin/pipeline");
    return { message: id ? "Customer updated" : "Customer added" };
  });
}

export async function removeCustomerLogin(customerId: string) {
  return attempt(async () => {
    await assertUser(PIPELINE);
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
    const c = await removeCustomer(await getDb(), id);
    revalidatePath("/admin/customers");
    revalidatePath("/admin/pipeline");
    return { message: c.quotes ? `${c.name} deleted, with ${c.quotes} quote${c.quotes === 1 ? "" : "s"}` : `${c.name} deleted` };
  });
}

export type { CustomerImportResult };

/**
 * Adds and updates customers from a spreadsheet (see applyCustomerImport). Nothing is saved if
 * any row has a problem.
 */
export async function importCustomers(rows: CustomerImportRow[], stage?: string) {
  return attempt<CustomerImportResult>(async () => {
    await assertUser(STAFF);
    if (!Array.isArray(rows) || !rows.length) throw new UserError("The file has no rows.");
    if (rows.length > MAX_CUSTOMER_ROWS) throw new UserError(`Import at most ${MAX_CUSTOMER_ROWS} customers at a time.`);
    if (stage && !isSalesStage(stage)) throw new UserError("Unknown sales stage.");
    const db = await getDb();
    const { result, created } = await applyCustomerImport(db, rows, { stage: stage && isSalesStage(stage) ? stage : undefined });
    if (result.errors.length) return { data: result };
    // Delivery orders already in the system find their customer by name or phone.
    after(async () => {
      const db = await getDb();
      for (const c of created) await linkOrdersToCustomer(db, c);
    });
    // New and changed addresses go on the customer map (a big import finishes when the map is opened).
    locateCustomersLater(240_000);
    revalidatePath("/admin/customers");
    revalidatePath("/admin/pipeline");
    return { data: result };
  });
}
