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

describe("Resend refusals", () => {
  it("say what to fix", async () => {
    const { explainResendError, DEFAULT_FROM } = await import("./email");
    expect(DEFAULT_FROM).toMatch(/@foodpacdistribution\.com\.au>$/);
    expect(explainResendError(403, "You can only send testing emails to your own email address (x@gmail.com).")).toMatch(/test mode/);
    expect(explainResendError(403, "The foodpac.com domain is not verified.")).toMatch(/isn't verified/);
    expect(explainResendError(422, "Invalid `to` field.")).toMatch(/couldn't send to that address/);
  });
});

describe("Resend API key", () => {
  it("uses only the key when more was pasted into the setting", async () => {
    const { resendKey, resendKeyHasExtra } = await import("./email");
    const before = process.env.RESEND_API_KEY;
    try {
      process.env.RESEND_API_KEY = "re_abc123\nOFFICE_EMAIL=office@example.com";
      expect(resendKey()).toBe("re_abc123");
      expect(resendKeyHasExtra()).toBe(true);
      process.env.RESEND_API_KEY = "  re_abc123  ";
      expect(resendKey()).toBe("re_abc123");
      expect(resendKeyHasExtra()).toBe(false);
      process.env.RESEND_API_KEY = "";
      expect(resendKey()).toBeUndefined();
    } finally {
      process.env.RESEND_API_KEY = before;
      if (before === undefined) delete process.env.RESEND_API_KEY;
    }
  });
});
