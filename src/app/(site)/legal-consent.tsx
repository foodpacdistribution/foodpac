"use client";

import { useT } from "@/components/i18n";

const LINKS = [
  { href: "/terms", label: "Terms of sale" },
  { href: "/returns", label: "Returns and refunds" },
  { href: "/privacy", label: "Privacy policy" },
];

/** The line under a sign-up or order button. Links open in a new tab so what's been typed isn't left behind. */
export function LegalConsent({ lead, className }: { lead: string; className?: string }) {
  const tr = useT();
  return (
    <p className={className}>
      {tr(lead)}{" "}
      {LINKS.map((l, i) => (
        <span key={l.href}>
          {i > 0 && " · "}
          <a href={l.href} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-leaf-950">
            {tr(l.label)}
          </a>
        </span>
      ))}
    </p>
  );
}
