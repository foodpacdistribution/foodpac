"use client";

import { ChevronDown, LogOut, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/app/actions/auth";
import { type AccountLink, initials, ROLE_LABEL } from "@/lib/account";
import { useT } from "./i18n";
import { LanguageSwitch } from "./language-switch";
import { cx } from "./ui";

/** Avatar button with the signed-in person's links, switch account and sign out. */
export function AccountMenu({
  name,
  email,
  role,
  subtitle,
  links,
  tone = "light",
}: {
  name: string;
  email: string;
  role: keyof typeof ROLE_LABEL;
  subtitle?: string | null;
  links: AccountLink[];
  tone?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);
  const tr = useT();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cx(
          "flex h-10 items-center gap-2 rounded-full pr-2.5 pl-1 text-sm font-medium transition-colors",
          tone === "dark" ? "text-white hover:bg-white/10" : "text-leaf-950 hover:bg-leaf-950/5",
        )}
      >
        <span className="grid size-8 place-items-center rounded-full bg-leaf-700 text-xs font-semibold text-white">{initials(name)}</span>
        <span className="hidden max-w-32 truncate sm:inline">{name.split(" ")[0]}</span>
        <ChevronDown className={cx("size-3.5 opacity-60 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-72 origin-top-right animate-pop overflow-hidden rounded-2xl border border-leaf-950/10 bg-white text-leaf-950 shadow-pop">
          <div className="flex items-center gap-3 border-b border-leaf-950/10 bg-cream/60 px-4 py-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-leaf-700 text-sm font-semibold text-white">{initials(name)}</span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-semibold">{name}</span>
              <span className="block truncate text-xs text-leaf-900/60">{email}</span>
              <span className="mt-1 inline-flex rounded-full bg-leaf-50 px-2 py-0.5 text-[11px] font-semibold text-leaf-700">
                {tr(ROLE_LABEL[role])}
                {subtitle && ` · ${subtitle}`}
              </span>
            </span>
          </div>
          <nav className="py-1.5">
            {links.map((l) => (
              <Link key={l.href} href={l.href} role="menuitem" onClick={() => setOpen(false)} className="block px-4 py-2 text-sm hover:bg-leaf-50">
                {tr(l.label)}
              </Link>
            ))}
          </nav>
          <div className="flex items-center justify-between border-t border-leaf-950/10 px-4 py-2">
            <span className="text-xs text-leaf-900/60">{tr("Language")} · 语言</span>
            <LanguageSwitch />
          </div>
          <form action={logout} className="border-t border-leaf-950/10 py-1.5">
            <button name="switch" value="1" role="menuitem" className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-leaf-50">
              <RefreshCw className="size-4 text-leaf-900/50" /> {tr("Switch account")}
            </button>
            <button role="menuitem" className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50">
              <LogOut className="size-4" /> {tr("Sign out")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
