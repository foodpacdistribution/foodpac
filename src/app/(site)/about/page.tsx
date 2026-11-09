import type { Metadata } from "next";
import Link from "@/components/link";
import { JsonLd } from "@/components/json-ld";
import { getDb } from "@/lib/db";
import { getLocale, getT, languageAlternates } from "@/lib/i18n/server";
import { aud } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { listCategories } from "@/lib/shop";
import { siteUrl } from "@/lib/site-url";
import { formatMinutesClock } from "@/lib/time";
import { CATEGORIES, categoryHref, SITE, STEPS } from "../content";
import { siteInfo } from "../site-info";

/**
 * Who Foodpac is, what it supplies, where and when it delivers, and how ordering works, in plain
 * words and in both languages (/about, /zh/about). Search engines and AI assistants answer
 * "who supplies takeaway containers in Brisbane?" from pages like this. Every fact comes from
 * Settings and the site's own content, so it stays true when those change.
 */

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  const description = tr(
    "Foodpac Distribution supplies food packaging, takeaway containers, cups, bags, cutlery, cleaning supplies and pantry staples to cafés, restaurants and takeaway shops across {area}, delivered by our own drivers.",
    { area: tr(SITE.serviceArea) },
  );
  const alternates = await languageAlternates("/about");
  return {
    title: tr("About us"),
    description,
    alternates,
    openGraph: { title: `${tr("About us")} · ${SITE.name}`, description, url: alternates.canonical },
  };
}

function weekdays(days: number[], locale: "en" | "zh", tr: (t: string) => string) {
  const sorted = [...days].sort();
  if (sorted.join() === "1,2,3,4,5") return tr("Monday to Friday");
  // 2026-11-09 is a Monday, so day n is 2026-11-(8+n).
  const name = (n: number) => new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-AU", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 8 + n)));
  return sorted.map(name).join(locale === "zh" ? "、" : ", ");
}

export default async function AboutPage() {
  const [tr, locale, db] = await Promise.all([getT(), getLocale(), getDb()]);
  const [s, counts] = await Promise.all([getSettings(db), listCategories(db)]);
  const site = siteInfo(s);
  const area = tr(SITE.serviceArea);
  const days = weekdays(s.deliveryDays, locale, tr);
  const cutoff = formatMinutesClock(s.orderCutoffMin);
  const stocked = (name: string) => counts.some((c) => c.name === name && c.n > 0);
  const base = siteUrl();

  const fees =
    s.deliveryFeeCents > 0
      ? s.freeDeliveryOverCents > 0
        ? tr("Delivery is free on orders over {free}; smaller orders have a {fee} delivery fee.", { free: aud(s.freeDeliveryOverCents), fee: aud(s.deliveryFeeCents) })
        : tr("Delivery costs {fee} per order.", { fee: aud(s.deliveryFeeCents) })
      : tr("Delivery is free.");
  const minimum = s.minOrderCents > 0 ? tr("The minimum order is {min}.", { min: aud(s.minOrderCents) }) : tr("There is no minimum order.");

  const faq = [
    {
      q: tr("Who can buy from Foodpac Distribution?"),
      a: tr("We supply businesses: cafés, restaurants, takeaway shops, bakeries, caterers and other food businesses. Open a free trade account to see your prices and order online."),
    },
    {
      q: tr("What do you supply?"),
      a: tr("Takeaway containers and food boxes, cups and lids, bags and wraps, cutlery and napkins, cleaning and hygiene supplies, and pantry staples such as sauces, oils and rice."),
    },
    {
      q: tr("Where do you deliver?"),
      a: tr("Across Brisbane and {area}, with our own drivers on planned runs. Further out? Ask about scheduled runs.", { area }),
    },
    {
      q: tr("When will my order arrive?"),
      a: tr("We deliver {days}. Orders placed by {cutoff} go out on the next delivery day.", { days, cutoff }),
    },
    { q: tr("Is there a delivery fee or minimum order?"), a: `${fees} ${minimum}` },
    {
      q: tr("Can I see prices without an account?"),
      a: tr("Prices are trade prices set for each account. Opening an account is free, and you see your prices as soon as it's approved."),
    },
  ];

  const h2 = "font-display text-2xl font-bold tracking-tight text-leaf-950";
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-leaf-950 sm:px-6 sm:py-16">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "AboutPage", "@id": `${base}/about`, url: `${base}/about`, name: tr("About us"), inLanguage: locale === "zh" ? "zh-CN" : "en-AU", about: { "@id": `${base}/#organization` } },
            { "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
          ],
        }}
      />
      <p className="text-sm font-semibold text-tomato">{tr("About us")}</p>
      <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">{tr("Food packaging and kitchen supplies for food businesses in {area}", { area })}</h1>
      <p className="mt-5 text-lg leading-relaxed text-leaf-900/80">
        {tr(
          "{name} is a wholesale supplier of food packaging and kitchen supplies for cafés, restaurants, takeaway shops and caterers across Brisbane and {area}. We stock takeaway containers, cups and lids, bags, cutlery, cleaning supplies and pantry staples, and deliver them with our own drivers on planned runs.",
          { name: SITE.name, area },
        )}
      </p>

      <section className="mt-12">
        <h2 className={h2}>{tr("What we supply")}</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <li key={c.title} className="rounded-lg bg-white p-4 ring-1 ring-leaf-950/10">
              {stocked(c.title) ? (
                <Link href={categoryHref(c.title)} className="font-semibold text-leaf-950 underline decoration-leaf-800/30 underline-offset-2 hover:decoration-leaf-800">
                  {tr(c.title)}
                </Link>
              ) : (
                <p className="font-semibold">{tr(c.title)}</p>
              )}
              <p className="mt-1 text-sm text-leaf-900/70">{tr(c.text)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className={h2}>{tr("Who we work with")}</h2>
        <p className="mt-3 leading-relaxed text-leaf-900/80">
          {tr("Cafés, restaurants, takeaway shops, sushi and noodle bars, bakeries and caterers: any food business that packs food to go or runs a busy kitchen. One supplier and one delivery for packaging, cleaning supplies and pantry staples.")}
        </p>
      </section>

      <section className="mt-12">
        <h2 className={h2}>{tr("Delivery")}</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed text-leaf-900/80">
          <li>{tr("Our own drivers deliver {days} across Brisbane and {area}.", { days, area })}</li>
          <li>{tr("Orders placed by {cutoff} go out on the next delivery day.", { cutoff })}</li>
          <li>
            {fees} {minimum}
          </li>
          <li>{tr("Every drop is recorded with a photo and signature, and you can follow the van on the day.")}</li>
        </ul>
      </section>

      <section className="mt-12">
        <h2 className={h2}>{tr("How ordering works")}</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 leading-relaxed text-leaf-900/80">
          {STEPS.map((step) => (
            <li key={step.title}>
              <span className="font-semibold text-leaf-950">{tr(step.title)}.</span> {tr(step.text)}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12">
        <h2 className={h2}>{tr("Frequently asked questions")}</h2>
        <dl className="mt-4 divide-y divide-leaf-950/10 border-y border-leaf-950/10">
          {faq.map((f) => (
            <div key={f.q} className="py-4">
              <dt className="font-semibold">{f.q}</dt>
              <dd className="mt-1 leading-relaxed text-leaf-900/80">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-12 rounded-xl bg-leaf-900 p-6 text-white">
        <h2 className="font-display text-2xl font-bold">{tr("Talk to us")}</h2>
        <dl className="mt-3 space-y-1 text-sm text-white/80">
          {site.phone && (
            <div>
              {tr("Phone")}: <a href={`tel:${site.phone.replace(/\s/g, "")}`} className="font-semibold text-white">{site.phone}</a>
            </div>
          )}
          {site.email && (
            <div>
              {tr("Email")}: <a href={`mailto:${site.email}`} className="font-semibold text-white">{site.email}</a>
            </div>
          )}
          {site.address && <div>{site.address}</div>}
          <div>{tr(site.hours)}</div>
          {site.abn && <div>ABN {site.abn}</div>}
        </dl>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/register" className="inline-flex h-11 items-center rounded-md bg-tomato px-5 text-sm font-semibold text-white hover:bg-tomato-dark">
            {tr("Open a trade account")}
          </Link>
          <Link href="/#contact" className="inline-flex h-11 items-center rounded-md px-5 text-sm font-semibold ring-1 ring-white/40 ring-inset hover:bg-white/10">
            {tr("Ask for a price list")}
          </Link>
        </div>
      </section>
    </main>
  );
}
