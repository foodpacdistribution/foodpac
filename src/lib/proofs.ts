import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "./db";
import { deliveryProofs } from "./db/schema";
import { UserError } from "./planning";

// Proofs are stored in Postgres (bytea) so the app needs no extra service.
// Photos are resized on the phone (~100–300 KB). At high volume, swap these
// two functions for S3/R2/Supabase Storage and keep only the key in the table.

export const MAX_PROOF_BYTES = 4 * 1024 * 1024;

/** Detects the real image type from its first bytes instead of trusting the upload. */
export function sniffImage(data: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (String.fromCharCode(...data.slice(0, 4)) === "RIFF" && String.fromCharCode(...data.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** Reads an uploaded image from FormData; null when the field is empty. */
export async function readUpload(value: FormDataEntryValue | null, label: string) {
  if (!value || typeof value === "string" || value.size === 0) return null;
  if (value.size > MAX_PROOF_BYTES) throw new UserError(`${label} is too large (max 4 MB).`);
  const data = new Uint8Array(await value.arrayBuffer());
  const mime = sniffImage(data);
  if (!mime) throw new UserError(`${label} must be a JPEG, PNG or WebP image.`);
  return { data, mime };
}

export async function saveProof(
  db: Pick<DB, "insert">,
  p: { orderId: string; eventId: string; kind: "photo" | "signature"; mime: string; data: Uint8Array },
) {
  await db.insert(deliveryProofs).values({ ...p, bytes: p.data.byteLength, sha256: sha256(p.data) });
}

export const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

export async function readProof(db: DB, id: string) {
  const [row] = await db.select().from(deliveryProofs).where(eq(deliveryProofs.id, id)).limit(1);
  return row ?? null;
}
