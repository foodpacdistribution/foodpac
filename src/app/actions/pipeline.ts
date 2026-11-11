"use server";

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, PIPELINE } from "@/lib/auth/dal";
import { linkOrdersToCustomer } from "@/lib/customers";
import { locateCustomersLater } from "@/lib/customer-locations";
import { getDb } from "@/lib/db";
import { customers, settings } from "@/lib/db/schema";
import { prettyDate } from "@/lib/dates";
import { QUIET_CHOICES } from "@/lib/follow-up";
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
      .set({ salesStage: stage, salesStageAt: new Date() })
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
 * prices, payment terms, approval and logins alone: those stay with the office (Customers page).
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

    // Orders are matched to customers by name, so two customers with one name would muddle them.
    const [twin] = await db
      .select({ name: customers.name })
      .from(customers)
      .where(and(sql`lower(${customers.name}) = lower(${name})`, ...(id ? [ne(customers.id, id)] : [])))
      .limit(1);
    if (twin) throw new UserError(`There's already a customer called “${twin.name}”. Search for it and update that one instead.`);

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
