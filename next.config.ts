import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    // Product photo URLs change whenever the photo does, so optimised copies can be kept long.
    minimumCacheTTL: 2678400,
  },
  experimental: {
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
