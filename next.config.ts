import type { NextConfig } from "next";

// On every response. The CSP only covers what can't break the pages (who may frame the site, where
// forms may post); limiting scripts as well would need a nonce on each page.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The driver app and customer map use the phone's location; the camera is for delivery photos.
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), browsing-topics=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self' https://checkout.stripe.com" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers: async () => [{ source: "/((?!_next/image).*)", headers: securityHeaders }],
  // The commit this build is from, in the browser code as well, so an open page can tell when a
  // newer version has gone live (lib/stale-build.ts, /api/version).
  env: { NEXT_PUBLIC_BUILD: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
  // Skips re-rendering what hasn't changed (a tap that opens a form no longer redraws a long list
  // behind it), which phones feel most. The code already follows its rules (react-hooks lint).
  reactCompiler: true,
  // Embedded Postgres (WASM) for local dev must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  images: {
    // Only our own logo files, product photos and home page posters are optimised (no query strings).
    localPatterns: [
      { pathname: "/brand/**", search: "" },
      { pathname: "/api/products/**", search: "" },
      { pathname: "/api/posters/**", search: "" },
    ],
    formats: ["image/avif", "image/webp"],
    // Fewer sizes than the default: every width is listed in the page for every photo, and each one
    // is another copy to generate. 2048 is enough for the full-width posters.
    deviceSizes: [640, 828, 1200, 2048],
    imageSizes: [48, 96, 128, 256, 384],
    // Product photo URLs change whenever the photo does, so optimised copies can be kept long.
    minimumCacheTTL: 2678400,
  },
  experimental: {
    // Off: inlined, the whole stylesheet (~170 KB) went into every page three times over (the HTML
    // and its data) and again with each click. As a file it's ~27 KB compressed, downloaded once and
    // cached for good, which pages and clicks (sign-in page 94 KB → 8 KB compressed) feel on a phone.
    inlineCss: false,
    // Delivery photos + signatures are sent with the "Delivered" action (photos are resized on the phone first).
    serverActions: { bodySizeLimit: "8mb" },
    // Revisiting a page within 30 s (tabs, back/forward) shows it instantly. Saves and live
    // updates call revalidatePath / router.refresh, which clear this cache, so data stays current.
    // `static` also bounds pages loaded ahead on hover (below): at most a minute old when opened.
    staleTimes: { dynamic: 30, static: 60 },
    // Pointing at or touching a link loads the whole page ahead (see components/link.tsx).
    dynamicOnHover: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
