import type { Metadata } from "next";
import Link from "@/components/link";
import { getDb } from "@/lib/db";
import { getLocale, languageAlternates } from "@/lib/i18n/server";
import { getSettings } from "@/lib/planning";
import { LEGAL, LEGAL_PATH, LEGAL_UPDATED, type LegalKey } from "./legal-content";
import { OG_IMAGE, SITE, siteInfo } from "./site-info";

export async function legalMetadata(key: LegalKey): Promise<Metadata> {
  const doc = LEGAL[key][await getLocale()];
  const alternates = await languageAlternates(LEGAL_PATH[key]);
  return {
    title: doc.title,
    description: doc.description,
    alternates,
    openGraph: { title: `${doc.title} · ${SITE.name}`, description: doc.description, url: alternates.canonical, images: [OG_IMAGE] },
  };
}

const WORDS = {
  en: { updated: "Last updated", contact: "Contact us", abn: "ABN", form: "Send us a message", also: "Also see", note: null },
  zh: { updated: "最后更新", contact: "联系我们", abn: "ABN", form: "给我们留言", also: "另请参阅", note: "本页为中文译本,如与英文版本有任何不一致,以英文版本为准。" },
};

/** A privacy, terms or returns page: the wording from legal-content.ts and the company's details from Settings. */
export async function LegalPage({ doc: key }: { doc: LegalKey }) {
  const [locale, db] = await Promise.all([getLocale(), getDb()]);
  const site = siteInfo(await getSettings(db));
  const doc = LEGAL[key][locale];
  const words = WORDS[locale];
  const others = (Object.keys(LEGAL) as LegalKey[]).filter((k) => k !== key);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-leaf-950 sm:px-6 sm:py-16">
      <h1 className="font-display text-4xl font-bold tracking-tight">{doc.title}</h1>
      <p className="mt-3 text-sm text-leaf-900/60">
        {words.updated}: {LEGAL_UPDATED[locale]}
      </p>
      {words.note && <p className="mt-4 rounded-lg bg-white p-4 text-sm text-leaf-900/75 ring-1 ring-leaf-950/10">{words.note}</p>}
      <p className="mt-6 text-lg leading-relaxed text-leaf-900/80">{doc.intro}</p>

      {doc.sections.map((s) => (
        <section key={s.heading} className="mt-10">
          <h2 className="font-display text-2xl font-bold tracking-tight">{s.heading}</h2>
          {s.paragraphs?.map((p) => (
            <p key={p} className="mt-3 leading-relaxed text-leaf-900/80">
              {p}
            </p>
          ))}
          {s.list && (
            <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed text-leaf-900/80">
              {s.list.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section className="mt-12 rounded-lg bg-white p-6 ring-1 ring-leaf-950/10">
        <h2 className="font-display text-2xl font-bold tracking-tight">{words.contact}</h2>
        <address className="mt-3 space-y-1 leading-relaxed text-leaf-900/80 not-italic">
          <p className="font-semibold text-leaf-950">{site.legalName}</p>
          {site.abn && (
            <p>
              {words.abn} {site.abn}
            </p>
          )}
          {site.address && <p>{site.address}</p>}
          {site.phone && (
            <p>
              <a href={`tel:${site.phone.replace(/\s/g, "")}`} className="underline decoration-leaf-800/30 underline-offset-2 hover:decoration-leaf-800">
                {site.phone}
              </a>
            </p>
          )}
          {site.email && (
            <p>
              <a href={`mailto:${site.email}`} className="underline decoration-leaf-800/30 underline-offset-2 hover:decoration-leaf-800">
                {site.email}
              </a>
            </p>
          )}
          <p>
            <Link href="/#contact" className="font-semibold text-leaf-800 underline decoration-leaf-800/30 underline-offset-2 hover:decoration-leaf-800">
              {words.form}
            </Link>
          </p>
        </address>
      </section>

      <p className="mt-8 text-sm text-leaf-900/70">
        {words.also}:{" "}
        {others.map((k, i) => (
          <span key={k}>
            {i > 0 && " · "}
            <Link href={LEGAL_PATH[k]} className="font-semibold text-leaf-800 underline decoration-leaf-800/30 underline-offset-2 hover:decoration-leaf-800">
              {LEGAL[k][locale].title}
            </Link>
          </span>
        ))}
      </p>
    </main>
  );
}
