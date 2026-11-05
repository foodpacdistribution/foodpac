import { jwtVerify, SignJWT } from "jose";
import type { Role } from "../db/schema";

export const SESSION_COOKIE = "dp_session";
const MAX_AGE_S = 60 * 60 * 24 * 7;

export type SessionPayload = { sub: string; role: Role; name: string; driverId: string | null };

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be set in production");
    return new TextEncoder().encode("dev-only-insecure-secret-change-me-0123456789");
  }
  return new TextEncoder().encode(s);
}

/** The one back-office page sales staff use. */
export const SALES_HOME = "/admin/pipeline";

/** Where each role lands after signing in, and where it is sent when it opens a page it can't use. */
export function homeFor(role: Role) {
  return role === "driver" ? "/driver" : role === "customer" ? "/portal" : role === "sales" ? SALES_HOME : "/admin";
}

/**
 * Where to go after signing in: the page the user was trying to open, if it's a local path
 * their role may use, otherwise their home. Never an external URL (open-redirect safe).
 */
export function afterLogin(role: Role, next: string | null | undefined) {
  const home = homeFor(role);
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/login")) return home;
  const path = next.split(/[?#]/)[0];
  const under = (p: string) => path === p || path.startsWith(`${p}/`);
  const ok =
    role === "sales"
      ? under(SALES_HOME) || path === "/account" || !(under("/admin") || under("/portal") || under("/driver") || path === "/quick-route")
      : role === "customer"
      ? !under("/admin") && !under("/driver") && !under("/quick-route")
      : role === "driver"
        ? under("/driver") || path === "/quick-route" || !(under("/admin") || under("/portal"))
        : !under("/portal") && !under("/driver");
  return ok ? next : home;
}

export async function signSession(payload: SessionPayload) {
  return new SignJWT({ role: payload.role, name: payload.name, driverId: payload.driverId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      role: payload.role as Role,
      name: String(payload.name ?? ""),
      driverId: (payload.driverId as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * A one-hour link to choose a new password. `stamp` comes from the current password hash, so
 * the link stops working as soon as the password changes (it can't be used twice).
 */
export async function signResetToken(userId: string, stamp: string) {
  return new SignJWT({ purpose: "reset", stamp }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("1h").sign(secret());
}

export async function verifyResetToken(token: string): Promise<{ sub: string; stamp: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.purpose !== "reset" || !payload.sub || typeof payload.stamp !== "string") return null;
    return { sub: payload.sub, stamp: payload.stamp };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_S,
};
