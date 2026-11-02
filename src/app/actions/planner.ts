"use server";

import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { applyManualEdit, type OptimiseInput, optimisePlan, setPlanDispatched, UserError } from "@/lib/planning";

function revalidate() {
  revalidatePath("/admin/planner");
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  revalidatePath("/driver");
}

export async function optimise(input: OptimiseInput) {
  return attempt(async () => {
    const user = await assertUser(STAFF);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new UserError("Invalid date.");
    if (!["balanced", "time", "distance"].includes(input.objective)) throw new UserError("Invalid objective.");
    const trafficFactor = Math.min(2, Math.max(1, Number(input.trafficFactor) || 1));
    const startMin = Math.min(23 * 60, Math.max(0, Math.round(input.startMin)));
    const defaultServiceMin = Math.min(240, Math.max(0, Math.round(input.defaultServiceMin)));
    const r = await optimisePlan({ ...input, trafficFactor, startMin, defaultServiceMin }, user.id);
    revalidate();
    const secs = (r.solverMs / 1000).toFixed(1);
    return {
      message:
        `Routes optimised in ${secs}s` +
        (r.unassigned ? ` · ${r.unassigned} order(s) could not be assigned` : "") +
        (r.matrixSource === "estimate" ? " · road data unavailable, times are straight-line estimates" : ""),
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
