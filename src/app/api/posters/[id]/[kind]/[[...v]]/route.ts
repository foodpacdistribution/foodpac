import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { posters } from "@/lib/db/schema";

/**
 * Poster pictures are public (shown on the home page). The page links to /<kind>/<version>, where
 * the version changes whenever the poster is saved, so those URLs can be cached for a year.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/posters/[id]/[kind]/[[...v]]">) {
  const { id, kind, v } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || (kind !== "desktop" && kind !== "mobile")) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [p] = await db
    .select(kind === "mobile" ? { data: posters.mobileImage, mime: posters.mobileImageMime } : { data: posters.image, mime: posters.imageMime })
    .from(posters)
    .where(eq(posters.id, id))
    .limit(1);
  if (!p?.data || !p.mime) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(p.data), {
    headers: {
      "Content-Type": p.mime,
      "Cache-Control": v?.length ? "public, max-age=31536000, immutable" : "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
