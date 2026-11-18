import { cookies } from "next/headers";
import { getCurrentUser, renewSession } from "@/lib/auth/dal";
import { homeFor, SESSION_COOKIE } from "@/lib/auth/session";

// Puts a login back on a role it still has (after a job it had switched to was taken away), then
// opens that role's home; a cookie that no longer counts is cleared and the sign-in page opened.
// Only a route handler can rewrite the cookie a page read.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    (await cookies()).delete(SESSION_COOKIE);
    return Response.redirect(new URL("/login", req.url), 303);
  }
  await renewSession(user, user.role);
  return Response.redirect(new URL(homeFor(user.role), req.url), 303);
}
