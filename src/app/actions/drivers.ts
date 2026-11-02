"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser } from "@/lib/auth/dal";
import { hashPassword } from "@/lib/auth/password";
import { getDb } from "@/lib/db";
import { drivers, users } from "@/lib/db/schema";
import { UserError } from "@/lib/planning";
import { inputToMinutes } from "@/lib/time";

export async function saveDriver(_prev: unknown, form: FormData) {
  return attempt(async () => {
    await assertUser(["admin"]);
    const db = await getDb();
    const get = (k: string) => String(form.get(k) ?? "").trim();
    const id = get("id") || null;
    const name = get("name");
    if (!name) throw new UserError("Name is required.");
    const capacity = get("capacity") === "" ? null : Number(get("capacity"));
    if (capacity !== null && (!Number.isFinite(capacity) || capacity < 0)) throw new UserError("Capacity must be a positive number.");
    const maxShiftHours = get("maxShiftHours") === "" ? null : Number(get("maxShiftHours"));
    if (maxShiftHours !== null && (!Number.isFinite(maxShiftHours) || maxShiftHours <= 0 || maxShiftHours > 16)) {
      throw new UserError("Shift length must be between 0 and 16 hours.");
    }
    const color = /^#[0-9a-f]{6}$/i.test(get("color")) ? get("color") : "#2563eb";

    const values = {
      name,
      phone: get("phone") || null,
      vehicle: get("vehicle") || null,
      capacity: capacity === null ? null : Math.round(capacity),
      shiftStartMin: inputToMinutes(get("shiftStart")),
      maxShiftMin: maxShiftHours === null ? null : Math.round(maxShiftHours * 60),
      depotId: get("depotId") || null,
      maxTrips: Math.min(5, Math.max(1, Math.round(Number(get("maxTrips")) || 1))),
      color,
      active: form.get("active") === "on",
    };

    const email = get("email").toLowerCase();
    const password = get("password");
    if (password && password.length < 8) throw new UserError("Password must be at least 8 characters.");

    await db.transaction(async (tx) => {
      let driverId = id;
      if (id) await tx.update(drivers).set(values).where(eq(drivers.id, id));
      else driverId = (await tx.insert(drivers).values(values).returning({ id: drivers.id }))[0].id;

      if (!email) return;
      const [login] = await tx.select().from(users).where(eq(users.driverId, driverId!)).limit(1);
      const [taken] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, email), ...(login ? [ne(users.id, login.id)] : [])))
        .limit(1);
      if (taken) throw new UserError("That email is already used by another login.");
      if (login) {
        await tx
          .update(users)
          .set({ email, name, ...(password ? { passwordHash: await hashPassword(password) } : {}) })
          .where(eq(users.id, login.id));
      } else {
        if (!password) throw new UserError("Set a password to create the driver's login.");
        await tx.insert(users).values({ email, name, role: "driver", driverId, passwordHash: await hashPassword(password) });
      }
    });

    revalidatePath("/admin/drivers");
    revalidatePath("/admin/planner");
    return { message: id ? "Driver updated" : "Driver added" };
  });
}
