import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { orderFormData } from "@/app/admin/sales/form-data";
import { T, Tx } from "@/components/i18n";
import Link from "@/components/link";
import { Card } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { quoteEditBlocker, quoteWithItems } from "@/lib/quotes";
import { QuoteForm } from "../../quote-form";

export const metadata: Metadata = { title: "Edit Quote" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(STAFF);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const found = await quoteWithItems(db, id);
  if (!found) notFound();
  const { quote: q, items } = found;
  const blocked = quoteEditBlocker(q);
  if (blocked) {
    return (
      <>
        <Link href={`/admin/quotes/${q.id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="size-4" /> <T vars={{ number: q.number }}>{"Quote {number}"}</T>
        </Link>
        <Card className="p-6 text-sm text-slate-600">
          <Tx>{blocked}</Tx>
        </Card>
      </>
    );
  }
  const data = await orderFormData(db, { customerId: q.customerId });
  return (
    <QuoteForm
      customers={data.customers}
      products={data.products}
      prices={data.prices}
      fees={data.fees}
      today={data.today}
      defaultValidUntil={q.validUntil}
      quote={{
        id: q.id,
        number: q.number,
        customerId: q.customerId,
        validUntil: q.validUntil,
        deliveryFeeCents: q.deliveryFeeCents,
        notes: q.notes,
        internalNote: q.internalNote,
        lines: items.filter((it) => it.productId).map((it) => ({ productId: it.productId!, qty: it.qty, unitPriceCents: it.unitPriceCents })),
      }}
    />
  );
}
