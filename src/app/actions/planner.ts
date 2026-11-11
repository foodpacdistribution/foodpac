"use server";

import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { applyManualEdit, deletePlan, getSettings, learnTiming, type OptimiseInput, optimisePlan, setPlanDispatched, UserError } from "@/lib/planning";

function revalidate() {
  revalidatePath("/admin/planner");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/history");
  revalidatePath("/admin");
  revalidatePath("/driver");
}

export async function optimise(input: OptimiseInput) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new UserError("Invalid date.");
    if (!["balanced", "time", "distance"].includes(input.objective)) throw new UserError("Invalid objective.");
    if (input.mode !== undefined && input.mode !== "full" && input.mode !== "insert") throw new UserError("Invalid mode.");
    // Learned from the drivers' own deliveries; worked out here so it's always current.
    const db = await getDb();
    const learned = input.learnedTiming ? await learnTiming(db, (await getSettings(db)).timezone) : null;
    const trafficFactor = Math.min(2, Math.max(1, learned?.trafficFactor ?? (Number(input.trafficFactor) || 1)));
    const startMin = Math.min(23 * 60, Math.max(0, Math.round(input.startMin)));
    const defaultServiceMin = Math.min(240, Math.max(0, Math.round(learned?.serviceMin ?? input.defaultServiceMin)));
    const r = await optimisePlan({ ...input, trafficFactor, startMin, defaultServiceMin }, user.id);
    revalidate();
    const t = await getT();
    return {
      message: [
        input.mode === "insert"
          ? t("{n} order(s) added to the routes; stops already on them kept their order", { n: r.added })
          : t("Routes optimised in {secs}s", { secs: (r.solverMs / 1000).toFixed(1) }),
        learned && t("timed from your deliveries (+{pct}% driving, {min} min per stop)", { pct: Math.round((trafficFactor - 1) * 100), min: defaultServiceMin }),
        r.unassigned > 0 && t("{n} order(s) could not be assigned", { n: r.unassigned }),
        r.matrixSource === "estimate" && t("road data unavailable, times are straight-line estimates"),
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
}

export async function saveManualEdit(date: string, assignment: { driverId: string; orderIds: string[] }[]) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    await applyManualEdit(date, assignment, user.id);
    revalidate();
    return { message: "Changes saved and times recalculated" };
  });
}

export async function dispatch(date: string, dispatched: boolean) {
  return attempt(async () => {
    await assertUser(STAFF);
    await setPlanDispatched(date, dispatched);
    revalidate();
    return { message: dispatched ? "Routes sent to drivers" : "Plan recalled to draft" };
  });
}

export async function deleteDayPlan(date: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserError("Invalid date.");
    await deletePlan(await getDb(), date);
    revalidate();
    return { message: "Plan deleted. Its orders are back to unplanned." };
  });
}
