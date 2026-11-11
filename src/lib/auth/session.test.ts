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
    expect(afterLogin("sales", "/admin/sales")).toBe("/admin/pipeline");
    expect(afterLogin("sales", "/quick-route")).toBe("/admin/pipeline");
  });
  it("lands sales staff on the pipeline", () => {
    expect(afterLogin("sales", null)).toBe("/admin/pipeline");
    expect(afterLogin("sales", "/admin/pipeline?stage=won")).toBe("/admin/pipeline?stage=won");
    expect(afterLogin("sales", "/account")).toBe("/account");
    expect(afterLogin("sales", "/admin/customer-map")).toBe("/admin/customer-map");
    expect(afterLogin("sales", "/admin/customers")).toBe("/admin/pipeline");
  });
  it("rejects external and malformed targets", () => {
    expect(afterLogin("admin", "https://evil.example")).toBe("/admin");
    expect(afterLogin("admin", "//evil.example")).toBe("/admin");
    expect(afterLogin("admin", "/\\evil.example")).toBe("/admin");
    expect(afterLogin("customer", null)).toBe("/portal");
  });
});
