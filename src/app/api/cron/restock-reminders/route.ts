import { getDb } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { sendRestockReminders } from "@/lib/restock";

export const maxDuration = 300;

/**
 * "Time to reorder?" emails for regular customers due to order (see lib/restock). Called every
 * morning by Vercel Cron (see vercel.json), which sends "Authorization: Bearer $CRON_SECRET".
 * Does nothing while reminders are switched off in Settings.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorised", { status: 401 });
  try {
    return Response.json(await sendRestockReminders(await getDb()));
  } catch (err) {
    await reportError(err, { area: "Reorder reminders", detail: "Today's reminder emails may not have gone out." });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
