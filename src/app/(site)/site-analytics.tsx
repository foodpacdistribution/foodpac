"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

/** Addresses are reported without their query string: those can hold sign-up and unsubscribe links. */
const withoutQuery = <E extends { url: string }>(event: E): E => ({ ...event, url: event.url.split(/[?#]/)[0] });

/** Visits and real-world page speed on the public shop (no cookies). The back office and portal aren't measured. */
export function SiteAnalytics() {
  return (
    <>
      <Analytics beforeSend={withoutQuery} />
      <SpeedInsights beforeSend={withoutQuery} />
    </>
  );
}
