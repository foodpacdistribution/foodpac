"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { attempt } from "@/lib/action";
import { assertUser, PIPELINE } from "@/lib/auth/dal";
import { assertNameFree, openAccount, PAYMENT_TERMS } from "@/lib/customer-account";
import { linkOrdersToCustomer } from "@/lib/customers";
import { locateCustomersLater } from "@/lib/customer-locations";
import { getDb } from "@/lib/db";
import { customers, type PaymentTerms, settings } from "@/lib/db/schema";
import { prettyDate } from "@/lib/dates";
import { QUIET_CHOICES } from "@/lib/follow-up";
import { parseDollars } from "@/lib/money";
import { accountApproved } from "@/lib/notify";
import { getSettings, UserError } from "@/lib/planning";
import { todayIn } from "@/lib/time";
import { isSalesStage, STAGE_INFO } from "@/lib/sales-stage";

function refresh() {
  revalidatePath("/admin/pipeline");
  revalidatePath("/admin/customers");
}

/** Moves a customer to another stage. A salesperson who moves an unassigned customer takes it on. */
export async function setSalesStage(customerId: string, stage: string) {
  return attempt(async () => {
    const user = await assertUser(PIPELINE);
    if (!isSalesStage(stage)) throw new UserError("Choose a stage.");
    const db = await getDb();
    const [c] = await db
      .update(customers)
      // The "not now" reason goes once they move on (the visit form sets it).
      .set({ salesStage: stage, salesStageAt: new Date(), ...(stage !== "not_now" ? { notNowReason: null } : {}) })
      .where(eq(customers.id, customerId))
      .returning({ name: customers.name });
    if (!c) throw new UserError("Customer not found.");
    if (user.role === "sales") {
      await db.update(customers).set({ salesRepId: user.id }).where(and(eq(customers.id, customerId), isNull(customers.salesRepId)));
    }
    refresh();
    return { message: `${c.name}: ${STAGE_INFO[stage].label}` };
  });
}

/**
 * Adds a customer from the pipeline, or edits its contact details and stage. Deliberately leaves
 * prices, payment terms, approval and logins alone: prices, terms and approval stay with the
 * office; portal logins are set on the Customers page (sales staff too).
 */
export async function saveLead(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const user = await assertUser(PIPELINE);
    const db = await getDb();
    const get = (k: string) => String(form.get(k) ?? "").trim();
    const id = get("id") || null;
    const name = get("name");
    const stage = get("stage");
    if (!name) throw new UserError("Business name is required.");
    if (!isSalesStage(stage)) throw new UserError("Choose a stage.");
    const email = get("email").toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("That email doesn't look right.");

    await assertNameFree(db, name, id);

    const details = { name, phone: get("phone") || null, email, address: get("address") || null };
    let customerId = id;
    if (id) {
      const [before] = await db.select({ stage: customers.salesStage, rep: customers.salesRepId }).from(customers).where(eq(customers.id, id)).limit(1);
      if (!before) throw new UserError("Customer not found.");
      await db
        .update(customers)
        .set({
          ...details,
          ...(before.stage !== stage ? { salesStage: stage, salesStageAt: new Date() } : {}),
          ...(user.role === "sales" && !before.rep ? { salesRepId: user.id } : {}),
        })
        .where(eq(customers.id, id));
    } else {
      [{ id: customerId }] = await db
        .insert(customers)
        .values({ ...details, salesStage: stage, salesRepId: user.role === "sales" ? user.id : null })
        .returning({ id: customers.id });
    }
    await linkOrdersToCustomer(db, { id: customerId!, name, phone: details.phone });
    locateCustomersLater();
    refresh();
    return { message: id ? `Customer updated: ${name}` : `Customer added: ${name}` };
  });
}

export type OpenedAccount = {
  customerId: string;
  name: string;
  login: { email: string; password: string | null } | null;
  creditBalance: number | null;
  offer: { minCents: number; offCents: number } | null;
};

/**
 * A store has signed: opens its trade account in one go (details, portal login, payment terms,
 * credit limit and any starting store credit), approved and ready to order. Sales staff can do
 * all of it. With "notify" on, the customer gets the "your account is ready" email.
 */
export async function openCustomerAccount(_prev: unknown, form: FormData) {
  return attempt<OpenedAccount>(async () => {
    const user = await assertUser(PIPELINE);
    const db = await getDb();
    const get = (k: string) => String(form.get(k) ?? "").trim();
    const terms = get("paymentTerms") as PaymentTerms;
    if (!PAYMENT_TERMS.includes(terms)) throw new UserError("Choose payment terms.");
    const creditLimitCents = terms !== "prepay" && get("creditLimit") ? parseDollars(get("creditLimit")) : null;
    if (terms !== "prepay" && get("creditLimit") && creditLimitCents === null) throw new UserError("Credit limit must be an amount, e.g. 5000.");
    const startingCreditCents = get("startingCredit") ? parseDollars(get("startingCredit")) : 0;
    if (startingCreditCents === null) throw new UserError("Store credit must be an amount, e.g. 200.");
    const loginEmail = get("loginEmail").toLowerCase();
    const password = get("password") || null;
    const offCents = get("offerOff") ? parseDollars(get("offerOff")) : null;
    const minCents = get("offerMin") ? parseDollars(get("offerMin")) : null;
    if ((get("offerOff") && offCents === null) || (get("offerMin") && minCents === null)) throw new UserError("The first-order offer must be amounts, e.g. 30 off 200.");

    const r = await openAccount(db, user, {
      id: get("id") || null,
      name: get("name"),
      abn: get("abn"),
      phone: get("phone"),
      email: get("email"),
      address: get("address"),
      login: loginEmail ? { email: loginEmail, name: get("loginName"), password } : null,
      paymentTerms: terms,
      creditLimitCents,
      startingCreditCents,
      creditReason: get("creditReason"),
      firstOrderOffer: { minCents, offCents },
    });

    await linkOrdersToCustomer(db, { id: r.customerId, name: r.name, phone: r.phone });
    if (form.get("notify") === "on" && loginEmail) after(() => accountApproved(r.customerId));
    locateCustomersLater();
    refresh();
    revalidatePath(`/admin/customers/${r.customerId}`);
    return {
      message: `Account open: ${r.name}`,
      data: { customerId: r.customerId, name: r.name, login: loginEmail ? { email: loginEmail, password } : null, creditBalance: r.creditBalance, offer: r.offer },
    };
  });
}

/** Sets (or with `on` = null clears) the day to get back in touch, with an optional note. */
export async function setFollowUp(customerId: string, on: string | null, note?: string) {
  return attempt(async () => {
    const user = await assertUser(PIPELINE);
    const db = await getDb();
    const today = todayIn((await getSettings(db)).timezone);
    if (on !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(on) || Number.isNaN(Date.parse(on)))) throw new UserError("Pick a date.");
    if (on !== null && on < today) throw new UserError("Pick today or a later date.");
    const [c] = await db
      .update(customers)
      .set({ followUpOn: on, followUpNote: on ? note?.trim().slice(0, 300) || null : null })
      .where(eq(customers.id, customerId))
      .returning({ name: customers.name });
    if (!c) throw new UserError("Customer not found.");
    if (on && user.role === "sales") {
      await db.update(customers).set({ salesRepId: user.id }).where(and(eq(customers.id, customerId), isNull(customers.salesRepId)));
    }
    refresh();
    return { message: on ? `Reminder set for ${prettyDate(on)}` : "Reminder cleared" };
  });
}

/** Someone got back in touch: clears the reminder and restarts the quiet-customer clock. */
export async function markFollowedUp(customerId: string) {
  return attempt(async () => {
    const user = await assertUser(PIPELINE);
    const db = await getDb();
    const [c] = await db
      .update(customers)
      .set({ contactedAt: new Date(), followUpOn: null, followUpNote: null })
      .where(eq(customers.id, customerId))
      .returning({ name: customers.name });
    if (!c) throw new UserError("Customer not found.");
    if (user.role === "sales") {
      await db.update(customers).set({ salesRepId: user.id }).where(and(eq(customers.id, customerId), isNull(customers.salesRepId)));
    }
    refresh();
    return { message: `Followed up: ${c.name}` };
  });
}

/** Admin: how long a customer can go without ordering before sales staff are reminded. */
export async function setQuietDays(days: number) {
  return attempt(async () => {
    await assertUser(["admin"]);
    if (!(QUIET_CHOICES as readonly number[]).includes(days)) throw new UserError("Choose how many days.");
    await (await getDb()).update(settings).set({ quietDays: days }).where(eq(settings.id, 1));
    refresh();
    revalidatePath("/admin", "layout");
    return { message: "Saved" };
  });
}
