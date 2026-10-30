"use server";

import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { clearAttempts, countAttempt, loginKeys } from "@/lib/auth/throttle";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

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
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);
  redirect(user.role === "driver" ? "/driver" : "/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
