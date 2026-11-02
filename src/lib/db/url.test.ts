import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseUrl, passwordProblem, supabaseAddressProblem } from "./url";

afterEach(() => vi.unstubAllEnvs());

describe("databaseUrl", () => {
  it("prefers DATABASE_URL and falls back to the integrations' POSTGRES_URL", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("POSTGRES_URL", "");
    expect(databaseUrl()).toBeUndefined();
    vi.stubEnv("POSTGRES_URL", "postgres://u:p@host:6543/postgres");
    expect(databaseUrl()).toBe("postgres://u:p@host:6543/postgres");
    vi.stubEnv("DATABASE_URL", "postgres://a:b@other:5432/db");
    expect(databaseUrl()).toBe("postgres://a:b@other:5432/db");
  });

  it("keeps sslmode but drops parameters the server would reject", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("POSTGRES_URL", "postgres://u:p%40ss@aws.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x");
    expect(databaseUrl()).toBe("postgres://u:p%40ss@aws.pooler.supabase.com:6543/postgres?sslmode=require");
  });
});

describe("supabaseAddressProblem", () => {
  it("flags Supabase's API and direct database addresses but not the pooler", () => {
    expect(supabaseAddressProblem("postgres://postgres:x@xkbxnronqrlremqunzpz.supabase.co:5432/postgres")).toContain("pooler");
    expect(supabaseAddressProblem("postgres://postgres:x@db.xkbxnronqrlremqunzpz.supabase.co:5432/postgres")).toContain("IPv6");
    expect(supabaseAddressProblem("postgres://postgres.xkbxnronqrlremqunzpz:x@aws-0-eu-west-1.pooler.supabase.com:6543/postgres")).toBeNull();
    expect(supabaseAddressProblem("postgres://u:p@ep-cool.neon.tech/db")).toBeNull();
  });
});

describe("passwordProblem", () => {
  const url = (pw: string) => `postgresql://postgres.ref:${pw}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`;
  it("spots placeholders, API keys and missing passwords", () => {
    expect(passwordProblem(url("[YOUR-PASSWORD]"))).toContain("placeholder");
    expect(passwordProblem(url("[s3cret]"))).toContain("placeholder");
    expect(passwordProblem(url("sb_secret_abc"))).toContain("API key");
    expect(passwordProblem("postgresql://postgres.ref@host:6543/postgres")).toContain("no password");
  });
  it("accepts a real (encoded) password", () => {
    expect(passwordProblem(url("Gh7kLm2Qp9"))).toBeNull();
    expect(passwordProblem(url("p%40ss%23word"))).toBeNull();
  });
});
