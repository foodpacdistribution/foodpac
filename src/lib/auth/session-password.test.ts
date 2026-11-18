import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { productColumns } from "../db/product-columns";
import { hashPassword, passwordStamp, sessionMatchesPassword } from "./password";
import { signingKey, signSession, verifySession } from "./session";

const person = { sub: "user-1", role: "admin" as const, name: "A", driverId: null };

describe("a session and the password it was signed in with", () => {
  it("stops counting once the password changes", async () => {
    const before = await hashPassword("first-password");
    const after = await hashPassword("second-password");
    const session = await verifySession(await signSession({ ...person, stamp: passwordStamp(before) }));
    expect(sessionMatchesPassword(session!.stamp, before)).toBe(true);
    expect(sessionMatchesPassword(session!.stamp, after)).toBe(false);
  });

  it("leaves sessions signed before this release alone until they expire", async () => {
    const old = await new SignJWT({ role: "admin", name: "A", driverId: null }).setProtectedHeader({ alg: "HS256" }).setSubject("user-1").setExpirationTime("1h").sign(signingKey());
    const session = await verifySession(old);
    expect(session!.stamp).toBeNull();
    expect(sessionMatchesPassword(session!.stamp, await hashPassword("any-password"))).toBe(true);
  });
});

describe("productColumns", () => {
  it("leaves the photo out and keeps what orders and quotes read", () => {
    expect(productColumns).not.toHaveProperty("image");
    for (const c of ["id", "sku", "name", "packSize", "unit", "gst", "priceCents"]) expect(productColumns).toHaveProperty(c);
  });
});
