import { afterEach, describe, expect, it, vi } from "vitest";
import { emailSiteUrl, LIVE_SITE } from "./site-url";

describe("emailSiteUrl", () => {
  afterEach(() => vi.unstubAllEnvs());
  const withSite = (url: string, vercel = "") => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", url);
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", vercel);
  };

  it("links emails to the live site when testing on a computer", () => {
    withSite("");
    expect(emailSiteUrl()).toBe(LIVE_SITE);
    withSite("http://localhost:3000/");
    expect(emailSiteUrl()).toBe(LIVE_SITE);
    withSite("http://127.0.0.1:3000");
    expect(emailSiteUrl()).toBe(LIVE_SITE);
  });

  it("never links to a vercel.app address", () => {
    withSite("", "foodpac.vercel.app");
    expect(emailSiteUrl()).toBe(LIVE_SITE);
  });

  it("keeps the site's own domain", () => {
    withSite("https://www.foodpacdistribution.com.au/");
    expect(emailSiteUrl()).toBe("https://www.foodpacdistribution.com.au");
    withSite("", "www.foodpacdistribution.com.au");
    expect(emailSiteUrl()).toBe("https://www.foodpacdistribution.com.au");
  });
});
