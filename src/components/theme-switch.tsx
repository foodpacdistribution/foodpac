"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useState, useTransition } from "react";
import { setTheme } from "@/app/actions/auth";
import { useT } from "./i18n";
import { cx } from "./ui";
import type { Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Auto", icon: Monitor },
];

/**
 * Light / dark / follow the device, for the back office on this device. The screen changes at
 * once (a short crossfade where the browser can); the choice is saved in the background.
 * `compact`: icons only, for the menu.
 */
export function ThemeSwitch({ current, compact }: { current: Theme; compact?: boolean }) {
  const tr = useT();
  const [theme, setLocal] = useState(current);
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setLocal(current);
  }
  const [, start] = useTransition();
  const pick = (t: Theme) => {
    if (t === theme) return;
    const root = document.querySelector<HTMLElement>("[data-app-theme]");
    const apply = () => {
      root?.setAttribute("data-theme", t);
      setLocal(t);
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce && "startViewTransition" in document) document.startViewTransition(apply);
    else apply();
    start(() => setTheme(t));
  };
  return (
    <div
      role="radiogroup"
      aria-label={tr("Theme")}
      className={cx("inline-flex shrink-0 items-center gap-0.5 rounded-full bg-slate-200/60 p-0.5 text-xs font-semibold text-slate-500", !compact && "text-sm")}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          onClick={() => pick(value)}
          title={tr(label)}
          aria-label={compact ? tr(label) : undefined}
          className={cx(
            "flex items-center gap-1.5 rounded-full transition-colors duration-150 pointer-coarse:py-2",
            compact ? "px-2 py-1.5" : "px-3.5 py-1.5",
            theme === value ? "bg-white text-slate-900 shadow-sm" : "hover:text-slate-800",
          )}
        >
          <Icon className="size-3.5" />
          {!compact && tr(label)}
        </button>
      ))}
    </div>
  );
}
