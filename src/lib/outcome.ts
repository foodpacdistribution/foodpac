import "server-only";
import { FAILURE_REASONS } from "./orders";
import { UserError } from "./planning";
import { readUpload } from "./proofs";

// What a driver submits when a stop is done (driver app and Quick route share the form):
// the outcome, who received it, photo / signature, and where the phone was.

export type Fix = { lat: number; lng: number; accuracy: number | null };
type Upload = { data: Uint8Array; mime: string } | null;

export type Outcome =
  | { type: "delivered"; recipient: string | null; note: string | null; photo: Upload; signature: Upload; at: Fix | null }
  | { type: "failed"; reason: string; note: string | null; photo: Upload; signature: null; at: Fix | null };

/** The phone's GPS fix sent with the outcome; ignored when missing or not a real coordinate. */
function readFix(form: FormData): Fix | null {
  const lat = Number(form.get("lat"));
  const lng = Number(form.get("lng"));
  const accuracy = Number(form.get("accuracy"));
  if (!form.get("lat") || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null };
}

export const clean = (v: FormDataEntryValue | null, max = 500) => {
  const s = String(v ?? "").trim().slice(0, max);
  return s || null;
};

/**
 * Reads and checks a delivered / failed submission. `proofRequired` = a photo or a signature
 * must come with every delivery, on top of the photo / signature settings.
 */
export async function readOutcome(
  form: FormData,
  type: "delivered" | "failed",
  rules: { requirePhoto: boolean; requireSignature: boolean; proofRequired?: boolean },
): Promise<Outcome> {
  const at = readFix(form);
  const note = clean(form.get("note"));
  const photo = await readUpload(form.get("photo"), "Photo");
  if (type === "failed") {
    const reason = String(form.get("reason") ?? "");
    if (!FAILURE_REASONS.includes(reason)) throw new UserError("Choose what happened.");
    if (reason === "Other" && !note) throw new UserError("Describe what happened in the note.");
    return { type, reason, note, photo, signature: null, at };
  }
  const signature = await readUpload(form.get("signature"), "Signature");
  const recipient = clean(form.get("recipient"), 120);
  if (rules.requirePhoto && !photo) throw new UserError("A delivery photo is required.");
  if (rules.requireSignature && !signature) throw new UserError("The customer's signature is required.");
  if (rules.proofRequired && !photo && !signature) throw new UserError("Take a photo or get a signature to confirm the delivery.");
  return { type, recipient, note, photo, signature, at };
}
