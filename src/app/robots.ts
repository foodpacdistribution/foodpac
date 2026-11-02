import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

/** The shop is public; accounts, the back office, the driver app and APIs stay out of search results. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/portal", "/driver", "/quick-route", "/account", "/cart", "/checkout", "/api/"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
