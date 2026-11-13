import { describe, expect, it } from "vitest";
import { rolesOf } from "./roles";
import { salesMayOpen } from "./sales-pages";
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
    expect(afterLogin("sales", "/admin/customers")).toBe("/admin/customers");
    expect(afterLogin("sales", "/admin/customers/import")).toBe("/admin/pipeline");
  });
  it("rejects external and malformed targets", () => {
    expect(afterLogin("admin", "https://evil.example")).toBe("/admin");
    expect(afterLogin("admin", "//evil.example")).toBe("/admin");
    expect(afterLogin("admin", "/\\evil.example")).toBe("/admin");
    expect(afterLogin("customer", null)).toBe("/portal");
  });
});

describe("salesMayOpen", () => {
  it("lets sales staff see the customer list, but not the office pages under it", () => {
    expect(salesMayOpen("/admin/customers")).toBe(true);
    expect(salesMayOpen("/admin/customers/import")).toBe(false);
    // A customer's page, but not the price list under it.
    expect(salesMayOpen("/admin/customers/0a6084c0-0000-0000-0000-000000000000")).toBe(true);
    expect(salesMayOpen("/admin/customers/0a6084c0-0000-0000-0000-000000000000/prices")).toBe(false);
    expect(salesMayOpen("/admin/customer-map")).toBe(true);
    expect(salesMayOpen("/admin/pipeline")).toBe(true);
    expect(salesMayOpen("/admin/orders")).toBe(false);
  });
});

describe("rolesOf", () => {
  it("is the login's own role first, then the extra jobs, never a customer", () => {
    expect(rolesOf({ role: "driver", extraRoles: ["sales"] })).toEqual(["driver", "sales"]);
    expect(rolesOf({ role: "driver", extraRoles: ["driver", "customer", "sales", "sales"] })).toEqual(["driver", "sales"]);
    expect(rolesOf({ role: "admin", extraRoles: [] })).toEqual(["admin"]);
  });
});
