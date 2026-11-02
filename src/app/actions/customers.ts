"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { hashPassword } from "@/lib/auth/password";
import { linkOrdersToCustomer } from "@/lib/customers";
import { getDb } from "@/lib/db";
import { customers, type PaymentTerms, users } from "@/lib/db/schema";
import { parseDollars } from "@/lib/money";
import { UserError } from "@/lib/planning";

export async function saveCustomer(_prev: unknown, form: FormData) {
  return attempt(async () => {
    await assertUser(STAFF);
    const db = await getDb();
    const get = (k: string) => String(form.get(k) ?? "").trim();
    const id = get("id") || null;
    const name = get("name");
    if (!name) throw new UserError("Business name is required.");
    const values = {
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
    if (get("creditLimit") && values.creditLimitCents === null) throw new UserError("Credit limit must be an amount, e.g. 5000.");

    const loginEmail = get("loginEmail").toLowerCase();
    const loginName = get("loginName") || name;
    const password = get("password");
    if (password && password.length < 8) throw new UserError("Password must be at least 8 characters.");

    const customerId = await db.transaction(async (tx) => {
      let customerId = id;
      if (id) await tx.update(customers).set(values).where(eq(customers.id, id));
      else customerId = (await tx.insert(customers).values(values).returning({ id: customers.id }))[0].id;

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
    });

    await linkOrdersToCustomer(db, { id: customerId, name, phone: values.phone });
    revalidatePath("/admin/customers");
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
