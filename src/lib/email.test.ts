import { describe, expect, it } from "vitest";
import { esc, layout } from "./email";
import { signResetToken, signSession, verifyResetToken } from "./auth/session";

describe("email HTML", () => {
  it("escapes what customers type", () => {
    expect(esc(`<img src=x onerror="a('b')"> & co`)).toBe("&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt; &amp; co");
    expect(layout({ heading: "<b>Hi</b>", body: "" })).toContain("&lt;b&gt;Hi&lt;/b&gt;");
  });
});

describe("password reset links", () => {
  it("only accept reset tokens, for the user they were made for", async () => {
    const token = await signResetToken("user-1", "stamp-a");
    expect(await verifyResetToken(token)).toEqual({ sub: "user-1", stamp: "stamp-a" });
    expect(await verifyResetToken(token.slice(0, -2) + "xx")).toBeNull();
    // A sign-in session must not double as a reset link.
    expect(await verifyResetToken(await signSession({ sub: "user-1", role: "admin", name: "A", driverId: null }))).toBeNull();
  });
});
