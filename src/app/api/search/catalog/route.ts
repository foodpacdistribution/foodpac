import { getDb } from "@/lib/db";
import { searchIndex } from "@/lib/shop";

/**
 * The whole catalogue's searchable fields (no prices), loaded once by the search box so
 * suggestions appear as you type without a server round trip. Public data, so the CDN keeps a
 * copy near the visitor: fresh for 2 minutes, then served while a new copy is fetched.
 */
export async function GET() {
  return Response.json(await searchIndex(await getDb()), {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=86400" },
  });
}
