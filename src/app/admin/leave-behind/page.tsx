import { siteInfo } from "@/app/(site)/site-info";
import { eq } from "drizzle-orm";
import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Logo } from "@/components/brand";
import { T } from "@/components/i18n";
import Link from "@/components/link";
import { PrintButton } from "@/components/print-button";
import { PIPELINE, requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { customers, users } from "@/lib/db/schema";
import { invoiceImages } from "@/lib/invoices";
import { leaveBehindRef, popularProducts } from "@/lib/leave-behind";
import { getSettings } from "@/lib/planning";
import { mayServe } from "@/lib/rep-scope";
import { emailSiteUrl } from "@/lib/site-url";
import { ProductPicker } from "./product-picker";

export const metadata: Metadata = { title: "Foodpac trade account" };

/** Most products on the page: two rows of four fit A4 with room for the QR code. */
const MAX_SHOWN = 8;

/**
 * The page a salesperson leaves at a store: what we sell, who to call, and a QR code that opens
 * the sign-up form. Sign-ups through it are the salesperson's; printed from a store's page
 * (`?store=`), the sign-up joins that store's record. Print it, or save it as a PDF to send.
 */
export default async function LeaveBehindPage({ searchParams }: { searchParams: Promise<{ store?: string; p?: string }> }) {
  const me = await requireUser(PIPELINE);
  const { store: storeId, p } = await searchParams;
  const db = await getDb();
  const store = storeId && /^[0-9a-f-]{36}$/i.test(storeId) ? (await db.select().from(customers).where(eq(customers.id, storeId)).limit(1))[0] : null;
  if (storeId && (!store || !mayServe(me, store))) notFound();
  const [[rep], s, candidates, storeLogin] = await Promise.all([
    db.select({ name: users.name, email: users.email, phone: users.phone }).from(users).where(eq(users.id, me.id)).limit(1),
    getSettings(db),
    popularProducts(db, 60),
    store ? db.select({ id: users.id }).from(users).where(eq(users.customerId, store.id)).limit(1) : [],
  ]);
  // A store that already has a login doesn't need to sign up: the code then just says who left it.
  const forStore = store && storeLogin.length === 0 ? store : null;
  const picked = (p ?? "").split(",").filter((id) => candidates.some((c) => c.id === id)).slice(0, MAX_SHOWN);
  const shownIds = picked.length ? picked : candidates.slice(0, MAX_SHOWN).map((c) => c.id);
  const shown = shownIds.map((id) => candidates.find((c) => c.id === id)!);
  const images = await invoiceImages(db, shown.map((c) => ({ productId: c.id })));

  const site = siteInfo(s);
  const base = emailSiteUrl();
  const url = `${base}/register?ref=${leaveBehindRef(me.id, forStore?.id ?? null)}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#123524", light: "#ffffff" } });
  const label = "text-[10px] font-semibold tracking-[0.12em] text-leaf-900/45 uppercase";
  const repPhone = rep.phone || site.phone;

  return (
    <div className="text-leaf-950">
      <div className="invoice-page">
        <div className="no-print mx-auto mb-4 w-full max-w-[210mm] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href={store ? `/admin/customers/${store.id}` : "/admin/pipeline"} className="text-sm text-leaf-900/70 hover:text-leaf-950">
              ← <T>{store ? "Back to the customer" : "Back to the pipeline"}</T>
            </Link>
            <PrintButton className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-leaf-700 px-4 text-sm font-semibold text-white" label="Print / save PDF" />
          </div>
          {!rep.phone && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                <T>{"Your own phone number isn't on it yet: the office number is printed instead."}</T>{" "}
                <Link href="/account" className="font-semibold underline">
                  <T>{"Add your phone"}</T>
                </Link>
              </span>
            </p>
          )}
          {store && !forStore && (
            <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 ring-1 ring-slate-200">
              <T>{"This store already has a login, so the QR code opens the sign-up form for anyone else."}</T>
            </p>
          )}
          <ProductPicker candidates={candidates.map((c) => ({ id: c.id, name: c.name, packSize: c.packSize, hasImage: c.hasImage }))} shown={shownIds} max={MAX_SHOWN} store={store?.id ?? null} />
        </div>

        <article className="invoice-sheet mx-auto flex w-full max-w-[210mm] flex-col overflow-hidden rounded-2xl border border-leaf-950/10 bg-white text-[13px] leading-snug text-leaf-950 shadow-sm sm:min-h-[297mm]">
          <div aria-hidden className="h-1.5 shrink-0 bg-tomato" />
          <div className="flex flex-1 flex-col p-6 sm:p-[14mm] sm:pt-[12mm]">
            <header className="keep flex items-start justify-between gap-6">
              <Logo className="h-11" />
              <p className="text-right text-[11.5px] leading-relaxed text-leaf-900/65">
                <T>{"Food packaging and supplies"}</T>
                <br />
                <T>{"Delivered across South East Queensland"}</T>
              </p>
            </header>

            {/* The offer and the code, side by side. */}
            <section className="keep mt-8 grid items-center gap-6 sm:grid-cols-[1fr_auto]">
              <div>
                {forStore && (
                  <p className={label}>
                    <T vars={{ name: forStore.name }}>{"For {name}"}</T>
                  </p>
                )}
                <h1 className="mt-1.5 font-display text-[30px] leading-[1.1] font-bold tracking-tight text-leaf-900">
                  <T>{"Open your trade account"}</T>
                </h1>
                <ul className="mt-4 space-y-1.5 text-[13.5px] text-leaf-900/85">
                  <li>✓ <T>{"Your own trade prices"}</T></li>
                  <li>✓ <T>{"Order online any time, re-order in one click"}</T></li>
                  <li>✓ <T>{"Delivered on our next run, with photo and signature"}</T></li>
                  <li>✓ <T>{"Invoice terms for approved accounts"}</T></li>
                </ul>
              </div>
              <div className="flex flex-col items-center rounded-2xl border border-leaf-950/10 p-4">
                <div className="size-[38mm] [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} />
                <p className="mt-2.5 text-[13px] font-semibold">
                  <T>{"Scan to sign up"}</T>
                </p>
                <p className="text-[10.5px] text-leaf-900/55">{base.replace(/^https?:\/\/(www\.)?/, "")}/register</p>
              </div>
            </section>

            <section className="mt-9">
              <p className={label}>
                <T>{"Popular with stores like yours"}</T>
              </p>
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {shown.map((c) => (
                  <li key={c.id} className="keep overflow-hidden rounded-xl border border-leaf-950/8">
                    <div className="grid aspect-[4/3] place-items-center bg-white p-2">
                      {images[c.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element -- loaded straight away so it's there when printed
                        <img src={images[c.id]} alt="" loading="eager" className="size-full object-contain" />
                      ) : (
                        <span className="text-[11px] text-leaf-900/30">{c.category}</span>
                      )}
                    </div>
                    <div className="border-t border-leaf-950/8 px-2.5 py-2">
                      <p className="line-clamp-2 text-[11.5px] leading-snug font-medium">{c.name}</p>
                      {c.packSize && <p className="mt-0.5 text-[10.5px] text-leaf-900/50">{c.packSize}</p>}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11.5px] text-leaf-900/60">
                <T>{"Prices show once your account is approved. Ask us for a price on anything you use now: we'll see if we can beat it."}</T>
              </p>
            </section>

            <footer className="keep mt-auto pt-9">
              <div className="flex flex-wrap items-end justify-between gap-6 rounded-2xl bg-leaf-900 px-5 py-4 text-white">
                <div>
                  <p className="text-[10px] font-semibold tracking-[0.12em] text-white/60 uppercase">
                    <T>{"Your contact"}</T>
                  </p>
                  <p className="mt-1 text-[17px] font-semibold">{rep.name}</p>
                  <p className="text-[13px] text-white/85">{[repPhone, rep.email].filter(Boolean).join(" · ")}</p>
                </div>
                <p className="text-right text-[11px] leading-relaxed text-white/70">
                  {site.name}
                  {site.abn && (
                    <>
                      <br />
                      ABN {site.abn}
                    </>
                  )}
                  {site.phone && (
                    <>
                      <br />
                      {site.phone}
                    </>
                  )}
                </p>
              </div>
            </footer>
          </div>
        </article>
      </div>
    </div>
  );
}
