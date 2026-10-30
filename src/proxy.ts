import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/auth/session";

// Optimistic redirects only. Real authorisation happens in requireUser/assertUser
// on every page and server action.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    if (session) return NextResponse.redirect(new URL(session.role === "driver" ? "/driver" : "/", request.url));
    return NextResponse.next();
  }
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  if (session.role === "driver" && !pathname.startsWith("/driver") && pathname !== "/quick-route") {
    return NextResponse.redirect(new URL("/driver", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webmanifest)$).*)"],
};
