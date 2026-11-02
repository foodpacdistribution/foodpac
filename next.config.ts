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
