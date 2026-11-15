import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { hashPassword } from "./auth/password";
import { postCredit } from "./credit";
import { checkOffer } from "./first-order-offer";
import type { DB } from "./db";
import { customers, type PaymentTerms, type Role, users } from "./db/schema";
import { UserError } from "./planning";

// Opening a trade account: what a salesperson does once a store signs. One step takes the
// business, its portal login, how it pays and any credit to start with, and leaves it ready to order.

export const PAYMENT_TERMS: readonly PaymentTerms[] = ["prepay", "net7", "net14", "net30"];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Orders are matched to customers by name, so two customers with one name would muddle them. */
export async function assertNameFree(db: DB, name: string, exceptId?: string | null) {
  const [twin] = await db
    .select({ name: customers.name })
    .from(customers)
    .where(and(sql`lower(${customers.name}) = lower(${name})`, ...(exceptId ? [ne(customers.id, exceptId)] : [])))
    .limit(1);
  if (twin) throw new UserError(`There's already a customer called “${twin.name}”. Search for it and update that one instead.`);
}

/**
 * Gives a customer its portal login, or changes the one it has. A new login needs a password;
 * an existing one keeps its password unless a new one is given.
 */
export async function setCustomerLogin(tx: DB, customerId: string, l: { email: string; name: string; password?: string | null }) {
  const email = l.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new UserError("The login email doesn't look right.");
  if (l.password && l.password.length < 8) throw new UserError("Password must be at least 8 characters.");
  const [login] = await tx.select().from(users).where(eq(users.customerId, customerId)).limit(1);
  const [taken] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), ...(login ? [ne(users.id, login.id)] : [])))
    .limit(1);
  if (taken) throw new UserError("That email is already used by another login.");
  if (login) {
    await tx
      .update(users)
      .set({ email, name: l.name, ...(l.password ? { passwordHash: await hashPassword(l.password) } : {}) })
      .where(eq(users.id, login.id));
    return { created: false };
  }
  if (!l.password) throw new UserError("Set a password to create the customer's portal login.");
  await tx.insert(users).values({ email, name: l.name, role: "customer", customerId, passwordHash: await hashPassword(l.password) });
  return { created: true };
}

export type OpenAccountInput = {
  /** A customer already on the pipeline; blank adds a new one. */
  id?: string | null;
  name: string;
  abn?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  /** Their portal login. Leave out to keep the one they have, or to open the account without one. */
  login?: { email: string; name: string; password?: string | null } | null;
  paymentTerms: PaymentTerms;
  /** Max unpaid invoice balance; null = no limit. Ignored for pay-up-front accounts. */
  creditLimitCents: number | null;
  /** Store credit to start them off with, in cents (0 for none). */
  startingCreditCents: number;
  creditReason?: string | null;
  /** "$off off a first order of $min or more", in cents; off null or 0 for no offer. */
  firstOrderOffer?: { minCents: number | null; offCents: number | null } | null;
};

/**
 * Opens (or finishes opening) a customer's trade account in one transaction: details, won,
 * approved and active, terms and credit limit, the portal login and any starting store credit.
 * A salesperson who opens it looks after it from then on, unless someone already does.
 */
export async function openAccount(db: DB, by: { id: string; role: Role }, input: OpenAccountInput) {
  const name = input.name.trim();
  if (!name) throw new UserError("Business name is required.");
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !EMAIL.test(email)) throw new UserError("That email doesn't look right.");
  if (!PAYMENT_TERMS.includes(input.paymentTerms)) throw new UserError("Choose payment terms.");
  const limit = input.paymentTerms === "prepay" ? null : input.creditLimitCents;
  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) throw new UserError("Credit limit must be an amount, e.g. 5000.");
  if (!Number.isInteger(input.startingCreditCents) || input.startingCreditCents < 0) throw new UserError("Store credit must be an amount, e.g. 200.");
  if (input.startingCreditCents > 1_000_000) throw new UserError("That's a lot of store credit. Give at most $10,000 here; the office can add more.");
  const offer = checkOffer(input.firstOrderOffer?.minCents ?? null, input.firstOrderOffer?.offCents ?? null);
  await assertNameFree(db, name, input.id);

  return db.transaction(async (t) => {
    const tx = t as unknown as DB;
    const details = {
      name,
      abn: input.abn?.trim() || null,
      phone: input.phone?.trim() || null,
      email,
      address: input.address?.trim() || null,
      approved: true,
      active: true,
      paymentTerms: input.paymentTerms,
      creditLimitCents: limit,
      firstOrderMinCents: offer?.minCents ?? null,
      firstOrderOffCents: offer?.offCents ?? null,
    };
    let customerId = input.id ?? null;
    if (customerId) {
      const [before] = await tx.select({ stage: customers.salesStage, rep: customers.salesRepId }).from(customers).where(eq(customers.id, customerId)).for("update");
      if (!before) throw new UserError("Customer not found.");
      await tx
        .update(customers)
        .set({
          ...details,
          ...(before.stage !== "won" ? { salesStage: "won" as const, salesStageAt: new Date() } : {}),
          ...(by.role === "sales" && !before.rep ? { salesRepId: by.id } : {}),
        })
        .where(eq(customers.id, customerId));
    } else {
      [{ id: customerId }] = await tx
        .insert(customers)
        .values({ ...details, salesStage: "won", salesRepId: by.role === "sales" ? by.id : null })
        .returning({ id: customers.id });
    }

    const login = input.login?.email.trim() ? await setCustomerLogin(tx, customerId, { ...input.login, name: input.login.name.trim() || name }) : null;

    const credit = input.startingCreditCents
      ? await postCredit(tx, {
          customerId,
          type: "promotion_credit",
          amount: input.startingCreditCents / 100,
          sourceType: "manual",
          description: input.creditReason?.trim().slice(0, 300) || "Starting credit for a new account",
          by: by.id,
        })
      : null;
    return { customerId, name, phone: details.phone, loginCreated: !!login?.created, creditBalance: credit?.balanceAfter ?? null, offer };
  });
}
