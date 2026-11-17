import type { SalesStage } from "./db/schema";

/** How each pipeline stage is named and coloured, in order. Safe for client components. */
export const STAGE_INFO: Record<SalesStage, { label: string; hint: string; tone: "slate" | "blue" | "amber" | "green" | "red"; dot: string }> = {
  new: { label: "New customer", hint: "Not contacted yet", tone: "slate", dot: "bg-slate-400" },
  interested: { label: "Interested", hint: "Keen to work with us", tone: "blue", dot: "bg-blue-500" },
  negotiating: { label: "In talks", hint: "Prices or terms being discussed", tone: "amber", dot: "bg-amber-500" },
  won: { label: "Won", hint: "Buying from us", tone: "green", dot: "bg-emerald-500" },
  not_now: { label: "Not now", hint: "Said no for now: try again later", tone: "red", dot: "bg-rose-300" },
};

export const SALES_STAGES = Object.keys(STAGE_INFO) as SalesStage[];

export const isSalesStage = (v: unknown): v is SalesStage => typeof v === "string" && Object.hasOwn(STAGE_INFO, v);
