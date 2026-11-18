import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algo, saltB64, hashB64] = stored.split(":");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Ties a sign-in or a reset link to the password it was made with, so it dies once the password changes. */
export const passwordStamp = (hash: string) => createHash("sha256").update(hash).digest("hex").slice(0, 16);

/**
 * Whether a session still belongs to the current password. Sessions signed before stamps existed
 * have none and stay valid until they expire (a week at most), so nobody is signed out by the release.
 */
export const sessionMatchesPassword = (stamp: string | null, hash: string) => stamp === null || stamp === passwordStamp(hash);
