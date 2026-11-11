"use client";

import Link from "@/components/link";
import { useT } from "@/components/i18n";
import { bubbleStyle, type CustomerPin, STAGE_COLOR } from "@/lib/customer-map";
import { STAGE_INFO } from "@/lib/sales-stage";

/** Map start when there's nothing to frame yet (Brisbane). */
export const DEFAULT_CENTER = { lat: -27.47, lng: 153.02 };

/** A group of customers: a round bubble with the count. Same look on Google and OpenStreetMap. */
export function bubbleHtml(n: number) {
  const { size, color } = bubbleStyle(n);
  return {
    size,
    html: `<div class="cust-bubble" style="width:${size}px;height:${size}px;background:${color};--ring:${color}40">${n}</div>`,
  };
}

/** One customer: a dot in its sales-stage colour; hollow when the position is approximate. */
export function dotHtml(p: CustomerPin) {
  const c = STAGE_COLOR[p.stage];
  return `<div class="cust-dot" style="background:${p.approximate ? "white" : c};border-color:${p.approximate ? c : "white"};opacity:${p.active ? 1 : 0.55}"></div>`;
}

/** What opens when a customer (or a group at one address) is clicked. */
export function CustomerPopup({ pins }: { pins: CustomerPin[] }) {
  const tr = useT();
  return (
    <div className="max-h-64 min-w-48 space-y-2 overflow-y-auto text-[13px] leading-snug">
      {pins.length > 1 && <p className="text-xs font-semibold text-slate-500">{tr("{n} customers here", { n: pins.length })}</p>}
      {pins.map((p) => (
        <div key={p.id}>
          <p className="font-semibold text-slate-900">
            {p.href ? (
              <Link href={p.href} className="hover:text-blue-600 hover:underline">
                {p.name}
              </Link>
            ) : (
              p.name
            )}
            <span className="ml-1.5 font-normal text-slate-400">{p.code}</span>
          </p>
          <p className="flex items-center gap-1.5 text-slate-600">
            <span className="inline-block size-2 rounded-full" style={{ background: STAGE_COLOR[p.stage] }} />
            {tr(STAGE_INFO[p.stage].label)}
            {!p.active && <span className="text-slate-400">· {tr("Inactive")}</span>}
          </p>
          <p className="text-slate-500">{p.address}</p>
          {p.approximate && <p className="text-xs text-amber-700">{tr("Placed roughly: check the address")}</p>}
          {p.phone && (
            <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`} className="font-medium text-blue-600">
              {p.phone}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
