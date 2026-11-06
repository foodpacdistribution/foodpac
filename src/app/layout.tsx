import type { Metadata, Viewport } from "next";
import { Archivo, Inter } from "next/font/google";
import { I18nProvider } from "@/components/i18n";
import { getLocale } from "@/lib/i18n/server";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Headlines: a plain, sturdy grotesque that reads like carton print rather than a startup landing page.
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo" });

const description =
  "Wholesale food packaging, takeaway containers, cups, cleaning supplies and dry goods for cafés, restaurants and takeaway shops across Brisbane and South East Queensland. Order online at your trade prices and track every delivery.";

// Icons (favicon.ico, icon.png, apple-icon.png) and the link-preview image (opengraph-image.png)
// are picked up from files in this folder.
// No page should take anywhere near this; if one ever hangs, it fails after a minute (and shows
// the "Try again" screen) instead of leaving the browser waiting five.
export const maxDuration = 60;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "Foodpac Distribution — Wholesale Food Packaging & Supplies, Brisbane", template: "%s · Foodpac Distribution" },
  description,
  applicationName: "Foodpac Distribution",
  // Set GOOGLE_SITE_VERIFICATION to the code from Google Search Console ("HTML tag" method).
  ...(process.env.GOOGLE_SITE_VERIFICATION ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } } : {}),
  openGraph: { type: "website", siteName: "Foodpac Distribution", locale: "en_AU", url: "/", title: "Foodpac Distribution", description },
  twitter: { card: "summary_large_image", title: "Foodpac Distribution", description },
};

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"} className={`${inter.variable} ${archivo.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
