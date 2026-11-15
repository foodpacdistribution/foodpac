import type { Metadata } from "next";
import { orderFormData } from "@/app/admin/sales/form-data";
import { PIPELINE, requireUser } from "@/lib/auth/dal";
import { shiftDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { QUOTE_VALID_DAYS } from "@/lib/quote-status";
import { QuoteForm } from "../quote-form";

export const metadata: Metadata = { title: "New Quote" };

/** ?customer= starts the quote for that customer (the "New quote" button on a customer card). */
/** ?add= lists products (comma-separated ids) to start the quote with. */
export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ customer?: string; add?: string }> }) {
  const me = await requireUser(PIPELINE);
  const sp = await searchParams;
  const customerId = sp.customer && /^[0-9a-f-]{36}$/i.test(sp.customer) ? sp.customer : undefined;
  const data = await orderFormData(await getDb(), { ...(customerId ? { customerId } : {}), user: me });
  return (
    <QuoteForm
      customers={data.customers}
      products={data.products}
      prices={data.prices}
      fees={data.fees}
      today={data.today}
      defaultValidUntil={shiftDate(data.today, QUOTE_VALID_DAYS)}
      initialCustomerId={customerId}
      startProducts={(sp.add ?? "").split(",").filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 50)}
    />
  );
}
