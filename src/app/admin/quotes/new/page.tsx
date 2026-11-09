import type { Metadata } from "next";
import { orderFormData } from "@/app/admin/sales/form-data";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { shiftDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { QUOTE_VALID_DAYS } from "@/lib/quote-status";
import { QuoteForm } from "../quote-form";

export const metadata: Metadata = { title: "New Quote" };

/** ?customer= starts the quote for that customer (the "New quote" button on a customer card). */
export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  await requireUser(STAFF);
  const sp = await searchParams;
  const customerId = sp.customer && /^[0-9a-f-]{36}$/i.test(sp.customer) ? sp.customer : undefined;
  const data = await orderFormData(await getDb(), customerId ? { customerId } : {});
  return (
    <QuoteForm
      customers={data.customers}
      products={data.products}
      prices={data.prices}
      fees={data.fees}
      today={data.today}
      defaultValidUntil={shiftDate(data.today, QUOTE_VALID_DAYS)}
      initialCustomerId={customerId}
    />
  );
}
