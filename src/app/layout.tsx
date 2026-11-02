import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });

const description =
  "Foodpac Distribution supplies cafés, restaurants and takeaway shops with packaging, consumables and dry goods. Order online at your own prices and track every delivery.";

// Icons (favicon.ico, icon.png, apple-icon.png) and the link-preview image (opengraph-image.png)
// are picked up from files in this folder.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "Foodpac Distribution — food & packaging supplies", template: "%s · Foodpac Distribution" },
  description,
  applicationName: "Foodpac Distribution",
  openGraph: { type: "website", siteName: "Foodpac Distribution", locale: "en_AU", url: "/", title: "Foodpac Distribution", description },
  twitter: { card: "summary_large_image", title: "Foodpac Distribution", description },
};

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${bricolage.variable}`}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
