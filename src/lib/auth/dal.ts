import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "../db";
import { type Role, users } from "../db/schema";
import { SESSION_COOKIE, verifySession } from "./session";

export type CurrentUser = { id: string; name: string; email: string; role: Role; driverId: string | null };

/** Verifies the cookie and re-reads the user, so deleted users / role changes take effect immediately. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, session.sub)).limit(1);
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, driverId: u.driverId };
});

/** For pages: redirects when not signed in or not allowed. */
export async function requireUser(roles?: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect(user.role === "driver" ? "/driver" : "/");
  return user;
}

export class AuthError extends Error {}

/** For server actions: throws instead of redirecting. */
export async function assertUser(roles: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || !roles.includes(user.role)) throw new AuthError("Not authorised");
  return user;
}

export const STAFF: Role[] = ["admin", "dispatcher"];
