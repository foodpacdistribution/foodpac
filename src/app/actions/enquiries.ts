"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { attempt } from "@/lib/action";
import { assertUser, STAFF } from "@/lib/auth/dal";
import { countAttempt } from "@/lib/auth/throttle";
import { getDb } from "@/lib/db";
import { type EnquiryStatus, enquiries } from "@/lib/db/schema";
import { UserError } from "@/lib/planning";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Contact form on the public website. Anyone can call this, so it is rate limited per IP. */
export async function submitEnquiry(_prev: unknown, form: FormData) {
  return attempt(async () => {
    const get = (k: string, max = 200) => String(form.get(k) ?? "").trim().slice(0, max);
    // Hidden field that people never see; bots fill it in. Pretend it worked.
    if (get("website")) return { message: "sent" };

    const name = get("name");
    const email = get("email").toLowerCase();
    const message = get("message", 4000);
    if (!name) throw new UserError("Please tell us your name.");
    if (!EMAIL.test(email)) throw new UserError("Please enter a valid email address.");
    if (message.length < 5) throw new UserError("Please add a short message so we know how to help.");

    const db = await getDb();
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    if ((await countAttempt(db, [{ key: `enquiry:${ip}`, max: 5 }])) > 0) {
      throw new UserError("You've sent a few messages already. Please try again a little later, or give us a call.");
    }

    await db.insert(enquiries).values({
      name,
      email,
      message,
      business: get("business") || null,
      phone: get("phone", 40) || null,
      suburb: get("suburb", 80) || null,
    });
    revalidatePath("/admin/enquiries");
    revalidatePath("/admin", "layout");
    return { message: "sent" };
  });
}

export async function setEnquiryStatus(id: string, status: EnquiryStatus) {
  return attempt(async () => {
    await assertUser(STAFF);
    if (!["new", "contacted", "closed"].includes(status)) throw new UserError("Unknown status.");
    const db = await getDb();
    await db.update(enquiries).set({ status }).where(eq(enquiries.id, id));
    revalidatePath("/admin/enquiries");
    revalidatePath("/admin", "layout");
  });
}
