"use server";

import { asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { posters, settings } from "@/lib/db/schema";
import { UserError } from "@/lib/planning";
import { cleanPosterHref } from "@/lib/posters";
import { readUpload } from "@/lib/proofs";

function revalidate() {
  revalidatePath("/admin/posters");
  revalidatePath("/");
}

const day = (v: string, label: string) => {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new UserError(`${label} must be a date.`);
  return v;
};

/** Adds or updates a poster (pictures arrive already resized in the browser). */
export async function savePoster(_prev: unknown, form: FormData) {
  return attempt(async () => {
    await assertUser(STAFF);
    const db = await getDb();
    const get = (k: string, max = 300) => String(form.get(k) ?? "").trim().slice(0, max);
    const id = get("id") || null;
    const name = get("name", 80);
    if (!name) throw new UserError("Give the poster a name.");
    const href = cleanPosterHref(get("href", 500));
    if (href === null) throw new UserError("The link must be a page on this site (starting with /) or a full https:// address.");
    const startsOn = day(get("startsOn"), "Start date");
    const endsOn = day(get("endsOn"), "End date");
    if (startsOn && endsOn && endsOn < startsOn) throw new UserError("The end date is before the start date.");
    const focus = (["left", "center", "right"] as const).find((f) => f === get("focus")) ?? "center";
    const image = await readUpload(form.get("image"), "Poster picture");
    const mobile = await readUpload(form.get("mobileImage"), "Phone picture");
    if (!id && !image) throw new UserError("Choose a picture for the poster.");

    const values = {
      name,
      eyebrow: get("eyebrow", 80),
      headline: get("headline", 140),
      text: get("text", 400),
      buttonLabel: get("buttonLabel", 40),
      href,
      focus,
      active: form.get("active") === "on",
      startsOn,
      endsOn,
      updatedAt: new Date(),
      ...(image ? { image: image.data, imageMime: image.mime } : {}),
      ...(mobile ? { mobileImage: mobile.data, mobileImageMime: mobile.mime } : {}),
      ...(form.get("removeMobileImage") === "on" && !mobile ? { mobileImage: null, mobileImageMime: null } : {}),
    };
    if (id) {
      const [row] = await db.update(posters).set(values).where(eq(posters.id, id)).returning({ id: posters.id });
      if (!row) throw new UserError("That poster no longer exists.");
    } else {
      // New posters go to the end of the line.
      const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${posters.sortOrder}), -1)::int + 1` }).from(posters);
      await db.insert(posters).values({ ...values, image: image!.data, imageMime: image!.mime, sortOrder: next });
    }
    revalidate();
    return { message: id ? "Poster saved" : "Poster added" };
  });
}

export async function deletePoster(id: string) {
  return attempt(async () => {
    await assertUser(STAFF);
    const db = await getDb();
    await db.delete(posters).where(eq(posters.id, id));
    revalidate();
    return { message: "Poster deleted" };
  });
}

export async function setPosterActive(id: string, active: boolean) {
  return attempt(async () => {
    await assertUser(STAFF);
    const db = await getDb();
    await db.update(posters).set({ active }).where(eq(posters.id, id));
    revalidate();
    return { message: active ? "Poster is showing" : "Poster hidden" };
  });
}

/** Moves a poster one place earlier (-1) or later (+1) in the carousel. */
export async function movePoster(id: string, by: -1 | 1) {
  return attempt(async () => {
    await assertUser(STAFF);
    const db = await getDb();
    await db.transaction(async (tx) => {
      const rows = await tx.select({ id: posters.id }).from(posters).orderBy(asc(posters.sortOrder), asc(posters.createdAt));
      const from = rows.findIndex((r) => r.id === id);
      const to = from + by;
      if (from < 0 || to < 0 || to >= rows.length) return;
      [rows[from], rows[to]] = [rows[to], rows[from]];
      // Renumber everything so the order is always clean (0, 1, 2…).
      for (const [i, r] of rows.entries()) await tx.update(posters).set({ sortOrder: i }).where(eq(posters.id, r.id));
    });
    revalidate();
  });
}

export async function setBuiltInPosters(on: boolean) {
  return attempt(async () => {
    await assertUser(STAFF);
    const db = await getDb();
    await db.update(settings).set({ builtInPosters: on }).where(eq(settings.id, 1));
    revalidate();
    return { message: on ? "Built-in posters are showing" : "Built-in posters hidden" };
  });
}
