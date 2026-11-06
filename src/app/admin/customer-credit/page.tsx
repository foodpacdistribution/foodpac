import { desc, eq } from "drizzle-orm";
import { Wallet } from "lucide-react";
import type { Metadata } from "next";
import { CreditHistory } from "@/components/credit-history";
import { T } from "@/components/i18n";
import Link from "@/components/link";
import { Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customerCreditAccounts, customerCreditTransactions, customers, users } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { money, toCents } from "@/lib/purchasing/labels";

export const metadata: Metadata = { title: "Store Credit" };

export default async function CustomerCreditPage() {
  await requireUser(STAFF);
  const db = await getDb();
  const [accounts, recent, s] = await Promise.all([
    db
      .select({ a: customerCreditAccounts, name: customers.name })
      .from(customerCreditAccounts)
      .innerJoin(customers, eq(customers.id, customerCreditAccounts.customerId))
      .orderBy(desc(customerCreditAccounts.balance)),
    db
      .select({ t: customerCreditTransactions, customer: customers.name, by: users.name })
      .from(customerCreditTransactions)
      .innerJoin(customers, eq(customers.id, customerCreditTransactions.customerId))
      .leftJoin(users, eq(users.id, customerCreditTransactions.createdBy))
      .orderBy(desc(customerCreditTransactions.createdAt))
      .limit(100),
    getSettings(db),
  ]);
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "medium", timeStyle: "short" });
  const outstanding = accounts.reduce((t, r) => t + toCents(r.a.balance), 0) / 100;
  const holders = accounts.filter((r) => r.a.balance > 0);

  return (
    <>
      <PageHeader
        title={<T>{"Store Credit"}</T>}
        subtitle={<T>{"Credit customers hold with us, from returns or given by an admin. It's money we owe them in goods, so it isn't income until they use it."}</T>}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label={<T>{"Credit customers hold"}</T>} value={money(outstanding)} hint={<T>{"Owed to customers (a liability)"}</T>} tone="amber" />
        <Stat label={<T>{"Customers with credit"}</T>} value={holders.length} tone="blue" />
        <Stat label={<T>{"Used on orders, all time"}</T>} value={money(accounts.reduce((t, r) => t + toCents(r.a.totalUsed), 0) / 100)} tone="green" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <Card className="h-fit overflow-hidden">
          <CardHeader title={<T>{"Accounts"}</T>} />
          {!accounts.length ? (
            <EmptyState icon={Wallet} title="No store credit yet">
              {"Credit appears when a customer return is turned into credit, or an admin gives some."}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {accounts.map(({ a, name }) => (
                <li key={a.id}>
                  <Link href={`/admin/customers/${a.customerId}#credit`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50">
                    <span>
                      <span className="font-medium text-slate-900">{name}</span>
                      <span className="block text-xs text-slate-500"><T vars={{ issued: money(a.totalIssued), used: money(a.totalUsed) }}>{"{issued} given · {used} used"}</T></span>
                    </span>
                    <span className="font-semibold tabular-nums">{money(a.balance)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title={<T>{"Latest credit transactions"}</T>} />
          <CreditHistory staff rows={recent.map(({ t, customer, by }) => ({ ...t, by, description: [customer, t.description].filter(Boolean).join(" · "), when: fmt.format(t.createdAt) }))} />
        </Card>
      </div>
    </>
  );
}
