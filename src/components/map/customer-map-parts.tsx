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

const STORE_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/></svg>';

const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Size of a customer pin; its tip (bottom centre) sits on the customer's position. */
export const PIN = { width: 38, height: 43 };

/** Zoom from which each pin also shows the customer's name. */
export const NAMES_FROM_ZOOM = 15;

/**
 * One customer: a map pin with a shop icon in its sales-stage colour, a small "?" when the
 * position is approximate, and the customer's name beside it when zoomed in.
 */
export function pinHtml(p: CustomerPin, withName: boolean) {
  const c = STAGE_COLOR[p.stage];
  const cls = `cust-pin${p.active ? "" : " is-inactive"}`;
  const rough = p.approximate ? '<span class="cust-pin-rough">?</span>' : "";
  const name = withName ? `<span class="cust-pin-name">${escapeHtml(p.name)}</span>` : "";
  return `<div class="${cls}" style="--c:${c}"><span class="cust-pin-head"></span><span class="cust-pin-icon">${STORE_ICON}</span>${rough}${name}</div>`;
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
