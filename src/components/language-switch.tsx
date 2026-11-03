"use client";

import { Languages } from "lucide-react";
import { useTransition } from "react";
import { setLocale } from "@/app/actions/auth";
import { LOCALES } from "@/lib/i18n";
import { useLocale } from "./i18n";
import { cx } from "./ui";

/** EN / 中文 toggle. Saves the choice and re-renders the page in the new language. */
export function LanguageSwitch({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  const current = useLocale();
  const [pending, start] = useTransition();
  return (
    <div
      role="group"
      aria-label="Language / 语言"
      className={cx(
        "inline-flex items-center gap-0.5 rounded-full p-0.5 text-xs font-semibold",
        tone === "dark" ? "bg-white/10 text-slate-300" : "bg-leaf-950/5 text-leaf-900/70",
        pending && "opacity-60",
        className,
      )}
    >
      <Languages className="mx-1 size-3.5 opacity-60" aria-hidden />
      {LOCALES.map((l) => (
        <button
          key={l.code}
          type="button"
          aria-pressed={current === l.code}
          disabled={pending}
          onClick={() =>
            start(async () => {
              await setLocale(l.code);
            })
          }
          className={cx(
            "rounded-full px-2.5 py-1 transition-colors",
            current === l.code ? (tone === "dark" ? "bg-white text-navy-900" : "bg-white text-leaf-950 shadow-sm") : "hover:opacity-100",
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
