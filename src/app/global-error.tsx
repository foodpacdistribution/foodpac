"use client";

import { useEffect } from "react";
import { reloadOnce } from "@/lib/stale-build";

/**
 * The last line: an error the page boundaries can't catch, most often moving to another page from a
 * page opened before a new version went live (its code is gone). Loading afresh fixes that, so it
 * reloads by itself once; if the page still fails, it says so in both languages with a Reload button.
 * It replaces the whole page (no layout, no language setting), hence the plain markup, styled
 * inline: importing the site's stylesheet here would send a second copy of it with every page.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
    reloadOnce();
  }, [error]);
  const button: React.CSSProperties = { height: 44, padding: "0 20px", borderRadius: 6, fontSize: 14, fontWeight: 600, display: "inline-flex", alignItems: "center", cursor: "pointer", textDecoration: "none" };
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", padding: "0 24px", background: "#faf6ee", color: "#0b2a1c", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <div style={{ maxWidth: 384, textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>This page couldn’t load · 页面没有加载出来</p>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "rgb(17 58 39 / 0.7)" }}>Reload to try again. · 请刷新重试。</p>
          <div style={{ marginTop: 20, display: "flex", justifyContent: "center", gap: 8 }}>
            <button type="button" onClick={() => window.location.reload()} style={{ ...button, border: 0, background: "#175034", color: "#fff" }}>
              Reload · 刷新
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full page load on purpose: the app's own navigation is what failed */}
            <a href="/" style={{ ...button, border: "1px solid rgb(11 42 28 / 0.15)", background: "#fff", color: "#0b2a1c" }}>
              Home · 首页
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
