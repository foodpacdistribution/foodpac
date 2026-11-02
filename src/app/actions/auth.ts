"use server";

import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { getCurrentUser } from "@/lib/auth/dal";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { afterLogin, SESSION_COOKIE, sessionCookieOptions, signSession, verifySession } from "@/lib/auth/session";
import { clearAttempts, countAttempt, loginKeys } from "@/lib/auth/throttle";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { UserError } from "@/lib/planning";

export async function login(_prev: { error?: string } | undefined, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const db = await getDb();
  // Vercel and most proxies put the client first in x-forwarded-for.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() || null;
  const keys = loginKeys(email, ip);
  const waitS = await countAttempt(db, keys);
  if (waitS > 0) {
    return { error: `Too many sign-in attempts. Try again in ${Math.max(1, Math.ceil(waitS / 60))} minutes.` };
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Incorrect email or password." };
  }
  await clearAttempts(db, [keys[0].key]);

  const token = await signSession({ sub: user.id, role: user.role, name: user.name, driverId: user.driverId });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions);
  // The account's language wins over whatever this device had.
  if (isLocale(user.locale)) jar.set(LOCALE_COOKIE, user.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect(afterLogin(user.role, String(form.get("next") ?? "")));
}

export async function logout(form?: FormData) {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  // Customers go back to the shop; staff, drivers and "Switch account" go to the sign-in page.
  redirect(form?.get("switch") || session?.role !== "customer" ? "/login" : "/");
}

/** Any signed-in user can change their own password; the current one is required. */
export async function changePassword(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const me = await getCurrentUser();
    if (!me) throw new UserError("Please sign in again.");
    const current = String(form.get("current") ?? "");
    const next = String(form.get("password") ?? "");
    if (next.length < 8) throw new UserError("Choose a new password of at least 8 characters.");
    if (next !== String(form.get("confirm") ?? "")) throw new UserError("The new passwords don't match.");
    const db = await getDb();
    const [u] = await db.select().from(users).where(eq(users.id, me.id)).limit(1);
    if (!u || !(await verifyPassword(current, u.passwordHash))) throw new UserError("Your current password is incorrect.");
    await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, me.id));
    return { message: "Password changed" };
  });
}

/** Name shown in the app (and on customer orders as the contact). */
export async function updateMyName(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const me = await getCurrentUser();
    if (!me) throw new UserError("Please sign in again.");
    const name = String(form.get("name") ?? "").trim().slice(0, 120);
    if (!name) throw new UserError("Enter your name.");
    const db = await getDb();
    await db.update(users).set({ name }).where(eq(users.id, me.id));
    revalidatePath("/", "layout");
    return { message: "Saved" };
  });
}

/** English / 中文. Remembered on this device, and on the account when signed in. */
export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  const me = await getCurrentUser();
  if (me) await (await getDb()).update(users).set({ locale }).where(eq(users.id, me.id));
  revalidatePath("/", "layout");
}
