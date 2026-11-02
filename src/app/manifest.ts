import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Foodpac Distribution",
    short_name: "Foodpac",
    description: "Order food and packaging supplies and track your deliveries.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf6ee",
    theme_color: "#ffffff",
    icons: [
      { src: "/brand/foodpac-icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
