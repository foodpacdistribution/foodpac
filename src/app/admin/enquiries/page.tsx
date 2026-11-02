import { desc } from "drizzle-orm";
import { Inbox, Mail, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { enquiries } from "@/lib/db/schema";
import { getSettings } from "@/lib/planning";
import { StatusSelect } from "./status-select";
import { T } from "@/components/i18n";

export const metadata: Metadata = { title: "Website Enquiries" };

export default async function EnquiriesPage() {
  await requireUser(STAFF);
  const db = await getDb();
  const [s, rows] = await Promise.all([getSettings(db), db.select().from(enquiries).orderBy(desc(enquiries.createdAt)).limit(200)]);
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, dateStyle: "medium", timeStyle: "short" });
  const fresh = rows.filter((r) => r.status === "new").length;

  return (
    <>
      <PageHeader
        title={<T>{"Website Enquiries"}</T>}
        subtitle={fresh ? `${fresh} new message${fresh === 1 ? "" : "s"} from the contact form` : "Messages sent from the contact form on your website"}
      />
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={Inbox} title={<T>{"No enquiries yet"}</T>}>
            <T>{"When someone fills in the contact form on the website, it shows up here."}</T></EmptyState>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((e) => (
            <Card key={e.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    {e.name}
                    {e.business && <span className="font-normal text-slate-500">· {e.business}</span>}
                    {e.status === "new" && <Badge tone="blue"><T>{"New"}</T></Badge>}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <a href={`mailto:${e.email}`} className="flex items-center gap-1 text-blue-700 hover:underline">
                      <Mail className="size-3.5" />
                      {e.email}
                    </a>
                    {e.phone && (
                      <a href={`tel:${e.phone}`} className="flex items-center gap-1 hover:underline">
                        <Phone className="size-3.5" />
                        {e.phone}
                      </a>
                    )}
                    {e.suburb && (
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3.5" />
                        {e.suburb}
                      </span>
                    )}
                    <span>{fmt.format(e.createdAt)}</span>
                  </div>
                </div>
                <StatusSelect id={e.id} status={e.status} />
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{e.message}</p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
