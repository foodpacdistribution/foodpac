import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { getT } from "@/lib/i18n/server";
import { readUnsubscribeToken } from "@/lib/restock";
import { UnsubscribeButton } from "./unsubscribe-button";

export const metadata: Metadata = { title: "Email reminders", robots: { index: false } };

/**
 * Where "Turn them off" in a reorder reminder lands. Turning off takes a tap on the page, not just
 * opening the link, since mail scanners open links on their own.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const tr = await getT();
  const token = (await searchParams).t ?? "";
  const id = token ? await readUnsubscribeToken(token) : null;
  const [c] = id ? await (await getDb()).select({ name: customers.name, on: customers.restockEmails }).from(customers).where(eq(customers.id, id)).limit(1) : [];
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <div className="rounded-3xl border border-leaf-950/10 bg-white p-6 sm:p-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{tr("Reorder reminders")}</h1>
        {!c ? (
          <p className="mt-3 text-leaf-900/70">{tr("This link isn't valid any more. Sign in and turn reminders off on your profile.")}</p>
        ) : !c.on ? (
          <p className="mt-3 text-leaf-900/70">{tr("Reorder reminders are off for {name}. You can turn them back on from your profile.", { name: c.name })}</p>
        ) : (
          <>
            <p className="mt-3 text-leaf-900/70">{tr("Stop the emails reminding {name} when it's time to reorder? Order and delivery emails still come.", { name: c.name })}</p>
            <UnsubscribeButton token={token} />
          </>
        )}
      </div>
    </main>
  );
}
