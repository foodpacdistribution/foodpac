import { CURRENT_BUILD } from "@/lib/build";

// Which version of the site is live, so a page left open across a new release can tell that its
// own code is out of date (see lib/stale-build.ts) and load afresh instead of showing an error.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ build: CURRENT_BUILD }, { headers: { "Cache-Control": "no-store" } });
}
