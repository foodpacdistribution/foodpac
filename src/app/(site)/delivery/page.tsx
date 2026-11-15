import { MapPin, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { JsonLd } from "@/components/json-ld";
import { servedSuburbs } from "@/lib/area-insights";
import { getDb } from "@/lib/db";
import { getLocale, getT, languageAlternates } from "@/lib/i18n/server";
import { aud } from "@/lib/money";
import { getSettings } from "@/lib/planning";
import { siteUrl } from "@/lib/site-url";
import { formatMinutesClock, todayIn } from "@/lib/time";
import { OG_IMAGE, SITE } from "../content";
import { weekdays } from "../weekdays";

/**
 * Where and when we deliver (/delivery, /zh/delivery): the days, cut-off and fees from Settings,
 * and the suburbs we've actually delivered to lately. One honest page for "food packaging
 * delivered to Logan / the Gold Coast / …" searches, rather than a thin page per suburb.
 */

/** Suburbs listed on the page (and named to search engines), busiest first. */
const MAX_SUBURBS = 150;

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  const title = tr("Delivery areas: Brisbane and {area}", { area: tr(SITE.serviceArea) });
  const description = tr(
    "Where and when {name} delivers food packaging and kitchen supplies: our own drivers on weekday runs across Brisbane and {area}, with the suburbs we deliver to.",
    { name: SITE.name, area: tr(SITE.serviceArea) },
  );
  const alternates = await languageAlternates("/delivery");
  return { title, description, alternates, openGraph: { title: `${title} · ${SITE.name}`, description, url: alternates.canonical, images: [OG_IMAGE] } };
}

export default async function DeliveryPage() {
  const [tr, locale, db] = await Promise.all([getT(), getLocale(), getDb()]);
  const s = await getSettings(db);
  const suburbs = (await servedSuburbs(db, todayIn(s.timezone))).slice(0, MAX_SUBURBS);
  const area = tr(SITE.serviceArea);
  const days = weekdays(s.deliveryDays, locale, tr);
  const cutoff = formatMinutesClock(s.orderCutoffMin);
  const fees =
    s.deliveryFeeCents > 0
      ? s.freeDeliveryOverCents > 0
        ? tr("Delivery is free on orders over {free}; smaller orders have a {fee} delivery fee.", { free: aud(s.freeDeliveryOverCents), fee: aud(s.deliveryFeeCents) })
        : tr("Delivery costs {fee} per order.", { fee: aud(s.deliveryFeeCents) })
      : tr("Delivery is free.");
  const minimum = s.minOrderCents > 0 ? tr("The minimum order is {min}.", { min: aud(s.minOrderCents) }) : tr("There is no minimum order.");
  const alphabetical = [...suburbs].sort((a, b) => a.name.localeCompare(b.name));
  const base = siteUrl();
  const h2 = "font-display text-2xl font-bold tracking-tight text-leaf-950";

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-leaf-950 sm:px-6 sm:py-16">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Service",
          "@id": `${base}/delivery#service`,
          name: tr("Wholesale food packaging delivery"),
          serviceType: "Wholesale food packaging and kitchen supplies delivery",
          url: `${base}/delivery`,
          provider: { "@id": `${base}/#organization` },
          areaServed: [
            { "@type": "City", name: "Brisbane" },
            { "@type": "AdministrativeArea", name: SITE.serviceArea },
            ...suburbs.map((x) => ({ "@type": "Place", name: `${x.name.replace(/\s+\d{4}$/, "")} QLD ${x.name.slice(-4)}` })),
          ],
        }}
      />
      <p className="text-sm font-semibold text-tomato">{tr("Delivery")}</p>
      <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">{tr("Where we deliver")}</h1>
      <p className="mt-5 text-lg leading-relaxed text-leaf-900/80">
        {tr("Our own drivers deliver food packaging and kitchen supplies to cafés, restaurants and takeaway shops across Brisbane and {area}, on planned runs {days}.", { area, days })}
      </p>

      <section className="mt-10">
        <h2 className={h2}>{tr("Delivery days and times")}</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed text-leaf-900/80">
          <li>{tr("Our own drivers deliver {days} across Brisbane and {area}.", { days, area })}</li>
          <li>{tr("Orders placed by {cutoff} go out on the next delivery day.", { cutoff })}</li>
          <li>
            {fees} {minimum}
          </li>
          <li>{tr("Choose a delivery window when you order and we plan the run around it.")}</li>
          <li>{tr("Every drop is recorded with a photo and signature, and you can follow the van on the day.")}</li>
        </ul>
      </section>

      {alphabetical.length > 0 && (
        <section className="mt-10">
          <h2 className={h2}>{tr("Suburbs we deliver to")}</h2>
          <p className="mt-2 text-sm text-leaf-900/70">{tr("Places our vans have delivered to in the last six months.")}</p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {alphabetical.map((x) => (
              <li key={x.name} className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm ring-1 ring-leaf-950/10">
                <MapPin className="size-3.5 text-leaf-700" /> {x.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10 rounded-2xl bg-leaf-950 p-6 text-cream">
        <p className="flex items-center gap-2 font-display text-xl font-bold">
          <Truck className="size-5" /> {alphabetical.length ? tr("Not on the list?") : tr("Not sure we come to you?")}
        </p>
        <p className="mt-2 text-cream/80">{tr("We add new suburbs to our runs all the time. Tell us where you are and what you need, and we'll let you know your delivery day.")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/register" className="inline-flex h-11 items-center rounded-md bg-tomato px-5 text-sm font-semibold text-white hover:bg-tomato-dark">
            {tr("Open a trade account")}
          </Link>
          <Link href="/#contact" className="inline-flex h-11 items-center rounded-md bg-white/10 px-5 text-sm font-semibold hover:bg-white/15">
            {tr("Ask us")}
          </Link>
        </div>
      </section>
    </main>
  );
}
