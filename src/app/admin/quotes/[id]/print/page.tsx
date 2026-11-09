import { siteInfo } from "@/app/(site)/site-info";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuoteSheet } from "@/components/quote-sheet";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customers, quotes } from "@/lib/db/schema";
import { invoiceImages } from "@/lib/invoices";
import { getSettings } from "@/lib/planning";
import { quoteWithItems } from "@/lib/quotes";

/** The title is the PDF's file name when the quote is saved from the print window. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: "Quote" };
  const [q] = await (await getDb()).select({ number: quotes.number }).from(quotes).where(eq(quotes.id, id)).limit(1);
  return { title: q ? `Quote ${q.number}` : "Quote" };
}

export default async function QuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(STAFF);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const found = await quoteWithItems(db, id);
  if (!found) notFound();
  const [[c], s, images] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, found.quote.customerId)).limit(1),
    getSettings(db),
    invoiceImages(db, found.items),
  ]);
  const issued = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "long" }).format(found.quote.createdAt);
  return (
    <div className="text-leaf-950">
      <QuoteSheet quote={found.quote} customer={c} items={found.items} issued={issued} site={siteInfo(s)} images={images} />
    </div>
  );
}
