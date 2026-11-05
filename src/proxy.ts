import { type NextRequest, NextResponse } from "next/server";
import { homeFor, SALES_HOME, SESSION_COOKIE, verifySession } from "./lib/auth/session";

// The public website is open to everyone; only the back office and the driver app need a session.
const PROTECTED = ["/admin", "/driver", "/quick-route", "/portal", "/account"];
const isProtected = (pathname: string) => PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));

// Optimistic redirects only. Real authorisation happens in requireUser/assertUser
// on every page and server action.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname !== "/login" && !isProtected(pathname)) return NextResponse.next();
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    if (session) return NextResponse.redirect(new URL(homeFor(session.role), request.url));
    return NextResponse.next();
  }
  if (!session) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  if (session.role === "driver" && !pathname.startsWith("/driver") && pathname !== "/quick-route" && pathname !== "/account") {
    return NextResponse.redirect(new URL("/driver", request.url));
  }
  // Sales staff only have the pipeline (and their own profile).
  if (session.role === "sales" && !(pathname === SALES_HOME || pathname.startsWith(`${SALES_HOME}/`)) && pathname !== "/account") {
    return NextResponse.redirect(new URL(SALES_HOME, request.url));
  }
  if (session.role === "customer" && !pathname.startsWith("/portal")) {
    return NextResponse.redirect(new URL(pathname === "/account" ? "/portal/profile" : "/portal", request.url));
  }
  if (session.role !== "customer" && pathname.startsWith("/portal")) return NextResponse.redirect(new URL(homeFor(session.role), request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webmanifest)$).*)"],
};
