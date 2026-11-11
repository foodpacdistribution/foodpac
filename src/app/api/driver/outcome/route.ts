import { AuthError, getCurrentUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { doneAt, finishStop } from "@/lib/driver-stops";
import { readOutcome } from "@/lib/outcome";
import { getSettings, UserError } from "@/lib/planning";

// A finished stop from the driver app: delivered or failed, with photo, signature and location.
// The phone keeps each one until this answers, so a signature taken where there's no signal is
// sent later by itself. A plain URL (not a server action) so a delivery saved before a new
// version of the app went live still uploads after it.
//
// Answers { ok: true } once saved (also when it was already saved by an earlier try), or
// { ok: false, error, retry }: retry = true means try again later (signed out, server trouble);
// false means it will never be accepted as sent, and the driver needs to see why.

const answer = (body: { ok: boolean; error?: string; retry?: boolean; already?: boolean }, status = 200) => Response.json(body, { status });

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "driver") return answer({ ok: false, error: "Sign in again to send it.", retry: true }, 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    // The connection dropped part way through the upload.
    return answer({ ok: false, error: "The upload was cut off.", retry: true }, 400);
  }
  const kind = form.get("kind");
  if (kind !== "delivered" && kind !== "failed") return answer({ ok: false, error: "Unknown result.", retry: false }, 400);

  try {
    const db = await getDb();
    const outcome = await readOutcome(form, kind, await getSettings(db));
    const r = await finishStop(String(form.get("stopId") ?? ""), outcome, doneAt(form.get("doneAt")));
    return answer({ ok: true, already: r.already });
  } catch (err) {
    if (err instanceof UserError || err instanceof AuthError) return answer({ ok: false, error: err.message, retry: false }, 422);
    console.error("[driver outcome]", err);
    return answer({ ok: false, error: "The server couldn't save it.", retry: true }, 500);
  }
}
