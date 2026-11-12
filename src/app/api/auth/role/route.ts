import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/dal";
import { homeFor, SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";

// Puts a login back on a role it still has (after a job it had switched to was taken away), then
// opens that role's home. Only a route handler can rewrite the cookie a page read.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.redirect(new URL("/login", req.url), 303);
  const token = await signSession({ sub: user.id, role: user.role, name: user.name, driverId: user.driverId });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);
  return Response.redirect(new URL(homeFor(user.role), req.url), 303);
}
