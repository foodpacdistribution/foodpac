import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Embedded Postgres (WASM) for local dev must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
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
