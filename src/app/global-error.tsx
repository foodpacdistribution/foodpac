"use client";

import "./globals.css";
import { useEffect } from "react";
import { reloadOnce } from "@/lib/stale-build";

/**
 * The last line: an error the page boundaries can't catch, most often moving to another page from a
 * page opened before a new version went live (its code is gone). Loading afresh fixes that, so it
 * reloads by itself once; if the page still fails, it says so in both languages with a Reload button.
 * It replaces the whole page (no layout, no language setting), hence the plain markup.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
    reloadOnce();
  }, [error]);
  return (
    <html lang="en">
      <body className="grid min-h-dvh place-items-center bg-cream px-6 text-leaf-950">
        <div className="max-w-sm text-center">
          <p className="font-display text-xl font-semibold">This page couldn’t load · 页面没有加载出来</p>
          <p className="mt-2 text-sm text-leaf-900/70">Reload to try again. · 请刷新重试。</p>
          <div className="mt-5 flex justify-center gap-2">
            <button type="button" onClick={() => window.location.reload()} className="h-11 rounded-md bg-leaf-800 px-5 text-sm font-semibold text-white">
              Reload · 刷新
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full page load on purpose: the app's own navigation is what failed */}
            <a href="/" className="inline-flex h-11 items-center rounded-md border border-leaf-950/15 bg-white px-5 text-sm font-semibold">
              Home · 首页
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
