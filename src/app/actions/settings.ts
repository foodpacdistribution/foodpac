"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { attempt } from "@/lib/action";
import { assertUser } from "@/lib/auth/dal";
import { hashPassword } from "@/lib/auth/password";
import { getDb } from "@/lib/db";
import { apiKeys, depots, orderFeeds, settings, users } from "@/lib/db/schema";
import { geocodeAddress } from "@/lib/geo/geocode";
import { createApiKey, geocodeOrderIds, runFeed } from "@/lib/sync";
import { getSettings, UserError } from "@/lib/planning";
import { inputToMinutes } from "@/lib/time";

export async function saveSettings(_prev: unknown, form: FormData) {
  return attempt(async () => {
    await assertUser(["admin"]);
    const db = await getDb();
    const current = await getSettings(db);
    const get = (k: string) => String(form.get(k) ?? "").trim();

    const timezone = get("timezone");
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      throw new UserError("Unknown timezone.");
    }
    const num = (k: string, min: number, max: number) => {
      const n = Number(get(k));
      if (!Number.isFinite(n) || n < min || n > max) throw new UserError(`${k} must be between ${min} and ${max}.`);
      return n;
    };

    await db
      .update(settings)
      .set({
        companyName: get("companyName") || current.companyName,
        timezone,
        defaultServiceMin: Math.round(num("defaultServiceMin", 0, 240)),
        defaultStartMin: inputToMinutes(get("defaultStart")) ?? current.defaultStartMin,
        defaultMaxShiftMin: Math.round(num("defaultMaxShiftHours", 1, 16) * 60),
        trafficFactor: num("trafficFactor", 1, 2),
        returnToDepot: form.get("returnToDepot") === "on",
        reloadMin: Math.round(num("reloadMin", 0, 120)),
        requirePhoto: form.get("requirePhoto") === "on",
        requireSignature: form.get("requireSignature") === "on",
      })
      .where(eq(settings.id, 1));
    const message = "Settings saved";
    revalidatePath("/", "layout");
    return { message };
  });
}

export async function createStaffUser(_prev: unknown, form: FormData) {
  return attempt(async () => {
    await assertUser(["admin"]);
    const db = await getDb();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const name = String(form.get("name") ?? "").trim();
    const role = String(form.get("role"));
    const password = String(form.get("password") ?? "");
    if (!email || !name) throw new UserError("Name and email are required.");
    if (role !== "admin" && role !== "dispatcher") throw new UserError("Choose a role.");
    if (password.length < 8) throw new UserError("Password must be at least 8 characters.");
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (exists) throw new UserError("That email already has a login.");
    await db.insert(users).values({ email, name, role, passwordHash: await hashPassword(password) });
    revalidatePath("/settings");
    return { message: `Login created for ${name}` };
  });
}

export async function deleteUser(userId: string) {
  return attempt(async () => {
    const me = await assertUser(["admin"]);
    if (me.id === userId) throw new UserError("You can't remove your own login.");
    await (await getDb()).delete(users).where(eq(users.id, userId));
    revalidatePath("/settings");
    return { message: "Login removed" };
  });
}

// ---------------------------------------------------------------------------
// Depots
// ---------------------------------------------------------------------------

export async function saveDepot(_prev: unknown, form: FormData) {
  return attempt(async () => {
    await assertUser(["admin"]);
    const db = await getDb();
    const id = String(form.get("id") ?? "") || null;
    const name = String(form.get("name") ?? "").trim();
    const address = String(form.get("address") ?? "").trim();
    if (!name || !address) throw new UserError("Depot name and address are required.");
    const active = form.get("active") === "on";
    const [prev] = id ? await db.select().from(depots).where(eq(depots.id, id)).limit(1) : [];
    let coords = { lat: prev?.lat ?? null, lng: prev?.lng ?? null };
    let message = id ? "Depot updated" : "Depot added";
    if (!prev || prev.address !== address || prev.lat === null) {
      const r = await geocodeAddress(db, address);
      if (r.status === "failed") throw new UserError("Couldn't find that address. Try adding the suburb and postcode.");
      coords = { lat: r.lat, lng: r.lng };
      message += ` · located at ${r.label}`;
    }
    if (id) await db.update(depots).set({ name, address, active, ...coords }).where(eq(depots.id, id));
    else await db.insert(depots).values({ name, address, active, ...coords });
    revalidatePath("/", "layout");
    return { message };
  });
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export async function createKey(name: string) {
  return attempt(async () => {
    await assertUser(["admin"]);
    if (!name.trim()) throw new UserError("Give the key a name, e.g. the system that will use it.");
    const key = await createApiKey(await getDb(), name.trim().slice(0, 60));
    revalidatePath("/settings");
    return { data: key, message: "Key created. Copy it now — it won't be shown again." };
  });
}

export async function revokeKey(id: string) {
  return attempt(async () => {
    await assertUser(["admin"]);
    await (await getDb()).update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
    revalidatePath("/settings");
    return { message: "Key revoked" };
  });
}

export async function saveFeed(_prev: unknown, form: FormData) {
  return attempt(async () => {
    await assertUser(["admin"]);
    const db = await getDb();
    const get = (k: string) => String(form.get(k) ?? "").trim();
    const id = get("id") || null;
    const name = get("name");
    const url = get("url");
    if (!name) throw new UserError("Name the feed.");
    try {
      const u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    } catch {
      throw new UserError("Enter a valid http(s) URL.");
    }
    let mapping: Record<string, string> = {};
    if (get("mapping")) {
      try {
        mapping = JSON.parse(get("mapping"));
        if (typeof mapping !== "object" || Array.isArray(mapping)) throw new Error();
      } catch {
        throw new UserError('Column mapping must be JSON like {"orderNumber": "Order No", "address": "Ship To"}.');
      }
    }
    const values = {
      name,
      url,
      format: get("format") === "json" ? ("json" as const) : ("csv" as const),
      // Blank keeps the saved header when editing; "-" removes it.
      ...(get("authHeader") ? { authHeader: get("authHeader") === "-" ? null : get("authHeader") } : id ? {} : { authHeader: null }),
      mapping,
      dateMode: get("dateMode") === "tomorrow" ? ("tomorrow" as const) : ("today" as const),
      enabled: form.get("enabled") === "on",
    };
    if (id) await db.update(orderFeeds).set(values).where(eq(orderFeeds.id, id));
    else await db.insert(orderFeeds).values(values);
    revalidatePath("/settings");
    return { message: id ? "Feed updated" : "Feed added" };
  });
}

export async function deleteFeed(id: string) {
  return attempt(async () => {
    await assertUser(["admin"]);
    await (await getDb()).delete(orderFeeds).where(eq(orderFeeds.id, id));
    revalidatePath("/settings");
    return { message: "Feed removed" };
  });
}

export async function syncFeedNow(id: string) {
  return attempt(async () => {
    await assertUser(["admin", "dispatcher"]);
    const db = await getDb();
    const s = await getSettings(db);
    const r = await runFeed(db, id, s.timezone);
    if (r.geocodeIds.length) after(() => geocodeOrderIds(db, r.geocodeIds));
    revalidatePath("/settings");
    revalidatePath("/orders");
    if (!r.ok) throw new UserError(`Sync failed: ${r.message}`);
    return { message: `Synced: ${r.inserted} new, ${r.updated} updated, ${r.skipped} locked (already planned) · ${r.message}` };
  });
}
