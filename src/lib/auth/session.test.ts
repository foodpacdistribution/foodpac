import { describe, expect, it } from "vitest";
import { afterLogin } from "./session";

describe("afterLogin", () => {
  it("returns customers to the shop page they came from", () => {
    expect(afterLogin("customer", "/checkout")).toBe("/checkout");
    expect(afterLogin("customer", "/portal/orders?x=1")).toBe("/portal/orders?x=1");
  });
  it("never sends a role somewhere it can't go", () => {
    expect(afterLogin("customer", "/admin/sales")).toBe("/portal");
    expect(afterLogin("driver", "/admin")).toBe("/driver");
    expect(afterLogin("admin", "/portal")).toBe("/admin");
  });
  it("rejects external and malformed targets", () => {
    expect(afterLogin("admin", "https://evil.example")).toBe("/admin");
    expect(afterLogin("admin", "//evil.example")).toBe("/admin");
    expect(afterLogin("admin", "/\\evil.example")).toBe("/admin");
    expect(afterLogin("customer", null)).toBe("/portal");
  });
});
