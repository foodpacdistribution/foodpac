import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fingerprint, reportError, resetReported, shouldSend } from "./report-error";

let sent: { to: string; subject: string; text: string }[] = [];

beforeEach(() => {
  resetReported();
  sent = [];
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("OFFICE_EMAIL", "office@example.com");
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, text: async () => JSON.stringify({ id: "e1" }) };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fingerprint", () => {
  it("treats the same error with other ids and numbers as one", () => {
    expect(fingerprint("Action", new Error('Order 123 for "Sushi" (4f1c2a3b-1111-2222-3333-444455556666) failed'))).toBe(
      fingerprint("Action", new Error('Order 987 for "Noodle Bar" (aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee) failed')),
    );
    expect(fingerprint("Action", new Error("x"))).not.toBe(fingerprint("Page", new Error("x")));
  });
});

describe("shouldSend", () => {
  it("sends an error once per 6 hours and counts the repeats", () => {
    const t = 1_000_000_000;
    expect(shouldSend("a", t)).toEqual({ send: true, again: 0 });
    expect(shouldSend("a", t + 60_000)).toEqual({ send: false });
    expect(shouldSend("a", t + 120_000)).toEqual({ send: false });
    expect(shouldSend("a", t + 6 * 3600_000 + 1)).toEqual({ send: true, again: 2 });
  });

  it("sends at most 5 emails an hour", () => {
    const t = 2_000_000_000;
    const results = Array.from({ length: 8 }, (_, i) => shouldSend(`e${i}`, t + i).send);
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(shouldSend("later", t + 3600_000 + 10).send).toBe(true);
  });
});

describe("reportError", () => {
  it("emails the office about a live error, once", async () => {
    await reportError(new Error("relation \"orders\" does not exist"), { area: "Page", path: "GET /admin/orders" });
    await reportError(new Error("relation \"orders\" does not exist"), { area: "Page", path: "GET /admin/orders" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("office@example.com");
    expect(sent[0].subject).toContain("网站出错 · Page");
    expect(sent[0].text).toContain("GET /admin/orders");
  });

  it("goes to ALERT_EMAIL when set", async () => {
    vi.stubEnv("ALERT_EMAIL", "owner@example.com");
    await reportError(new Error("boom"), { area: "API" });
    expect(sent[0].to).toBe("owner@example.com");
  });

  it("stays quiet off the live site and for noise", async () => {
    await reportError(new Error("Failed to find Server Action \"abc\""), { area: "Action" });
    await reportError(new Error("The operation was aborted"), { area: "Page" });
    vi.stubEnv("VERCEL_ENV", "preview");
    await reportError(new Error("boom"), { area: "Page" });
    expect(sent).toEqual([]);
  });

  it("never throws, even when the email can't go", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    await expect(reportError(new Error("boom"), { area: "Page" })).resolves.toBeUndefined();
  });
});
