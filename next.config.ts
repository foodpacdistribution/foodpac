import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Embedded Postgres (WASM) for local dev must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  images: {
    // Only our own logo files and product photos are optimised (no query strings).
    localPatterns: [
      { pathname: "/brand/**", search: "" },
      { pathname: "/api/products/**", search: "" },
    ],
    formats: ["image/avif", "image/webp"],
    // Product photo URLs change whenever the photo does, so optimised copies can be kept long.
    minimumCacheTTL: 2678400,
  },
  experimental: {
    // Delivery photos + signatures are sent with the "Delivered" action (photos are resized on the phone first).
    serverActions: { bodySizeLimit: "8mb" },
    // Revisiting a page within 30 s (tabs, back/forward) shows it instantly. Saves and live
    // updates call revalidatePath / router.refresh, which clear this cache, so data stays current.
    staleTimes: { dynamic: 30, static: 300 },
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
