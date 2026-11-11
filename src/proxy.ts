import { type NextRequest, NextResponse } from "next/server";
import { homeFor, SALES_HOME, salesMayOpen, SESSION_COOKIE, verifySession } from "./lib/auth/session";
import { hasZhPage, LOCALE_COOKIE, stripZh, URL_LOCALE_HEADER } from "./lib/i18n";

// The public website is open to everyone; only the back office and the driver app need a session.
const PROTECTED = ["/admin", "/driver", "/quick-route", "/portal", "/account"];
const isProtected = (pathname: string) => PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));

// Optimistic redirects only. Real authorisation happens in requireUser/assertUser
// on every page and server action.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Chinese pages at their own address (/zh, /zh/products/…): serve the normal page in Chinese.
  const english = stripZh(pathname);
  if (english !== null) {
    const url = request.nextUrl.clone();
    url.pathname = english;
    // Only public shop pages have a Chinese address; anything else goes to the normal page.
    if (!hasZhPage(english)) return NextResponse.redirect(url);
    const headers = new Headers(request.headers);
    headers.set(URL_LOCALE_HEADER, "zh");
    const res = NextResponse.rewrite(url, { request: { headers } });
    // Remember it, so the visitor keeps reading Chinese on the pages they click through to.
    res.cookies.set(LOCALE_COOKIE, "zh", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return res;
  }
  if (pathname !== "/login" && !isProtected(pathname)) {
    // The language header is ours to set (above); never take it from the request itself.
    if (!request.headers.has(URL_LOCALE_HEADER)) return NextResponse.next();
    const headers = new Headers(request.headers);
    headers.delete(URL_LOCALE_HEADER);
    return NextResponse.next({ request: { headers } });
  }
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
  // Sales staff only have the pipeline and the customer map (and their own profile).
  if (session.role === "sales" && !salesMayOpen(pathname)) {
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
