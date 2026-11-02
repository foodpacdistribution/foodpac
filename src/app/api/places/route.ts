import { getCurrentUser } from "@/lib/auth/dal";
import { placeDetail, suggestPlaces } from "@/lib/geo/places";

const num = (v: string | null) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Address suggestions for signed-in users (keeps the Google quota to our own people).
 * ?q=…&lat=…&lng=…&session=… → suggestions; ?id=…&session=… → the chosen place's position.
 */
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return new Response("Unauthorised", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const session = (sp.get("session") ?? "").replace(/[^\w-]/g, "").slice(0, 64);
  const id = sp.get("id");
  if (id) return Response.json({ place: await placeDetail(id, session) });
  const lat = num(sp.get("lat"));
  const lng = num(sp.get("lng"));
  const near = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  return Response.json({ suggestions: await suggestPlaces(sp.get("q") ?? "", near, session) });
}
