import { AuthError, getCurrentUser } from "@/lib/auth/dal";
import { addStopPhotos, MAX_STOP_PHOTOS } from "@/lib/driver-stops";
import { UserError } from "@/lib/planning";
import { readUpload } from "@/lib/proofs";

// Photos added to a stop after it was finished. Sent from the phone's outbox like a delivery,
// so one taken where there's no signal uploads later by itself. Same answers as
// /api/driver/outcome: { ok: true } once saved (also when already saved), or { ok: false,
// error, retry }.

const answer = (body: { ok: boolean; error?: string; retry?: boolean; added?: number }, status = 200) => Response.json(body, { status });

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "driver") return answer({ ok: false, error: "Sign in again to send it.", retry: true }, 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return answer({ ok: false, error: "The upload was cut off.", retry: true }, 400);
  }

  try {
    const files = form.getAll("photo").slice(0, MAX_STOP_PHOTOS);
    const photos = [];
    for (const f of files) {
      const p = await readUpload(f, "Photo");
      if (p) photos.push(p);
    }
    if (!photos.length) return answer({ ok: false, error: "Add a photo.", retry: false }, 422);
    const added = await addStopPhotos(String(form.get("stopId") ?? ""), photos);
    return answer({ ok: true, added });
  } catch (err) {
    if (err instanceof UserError || err instanceof AuthError) return answer({ ok: false, error: err.message, retry: false }, 422);
    console.error("[driver photos]", err);
    return answer({ ok: false, error: "The server couldn't save it.", retry: true }, 500);
  }
}
