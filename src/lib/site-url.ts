/** Public address of the site, for absolute links in metadata, the sitemap and structured data. */
export function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

/** The live site, on the same domain emails are sent from. */
export const LIVE_SITE = "https://www.foodpacdistribution.com.au";

/**
 * Base address for links and images in emails. Never localhost: the person reading the email
 * can't open it, the logo shows broken, and links or images on another domain than the sender
 * (localhost, *.vercel.app) make spam filters suspicious. So emails sent while testing on a
 * computer still point at the live site.
 */
export function emailSiteUrl() {
  const url = siteUrl();
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$|\.vercel\.app$/i.test(url) ? LIVE_SITE : url;
}
