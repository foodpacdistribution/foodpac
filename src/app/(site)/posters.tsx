import { ArrowRight, Check } from "lucide-react";
import Image from "next/image";
import Link from "@/components/link";
import { cx } from "@/components/ui";
import { T } from "@/components/i18n";
import { posterImageUrl } from "@/lib/poster-image";
import type { PosterRow } from "@/lib/posters";
import { categoryHref, categoryInfo, type Poster, stockedCategories } from "./content";
import { ProductCount, ProductImage } from "./shop-ui";

type Photo = { id: string; sku: string; name: string; category: string; updatedAt: Date; hasImage: boolean };

const TONES: Record<Poster["tone"], { bg: string; accent: string; primary: string }> = {
  leaf: { bg: "bg-leaf-900", accent: "text-cream/60", primary: "bg-tomato text-white hover:bg-tomato-dark" },
  tomato: { bg: "bg-[#a4440a]", accent: "text-white/65", primary: "bg-white text-tomato-dark hover:bg-cream" },
  navy: { bg: "bg-navy-900", accent: "text-white/55", primary: "bg-tomato text-white hover:bg-tomato-dark" },
  night: { bg: "bg-leaf-950", accent: "text-cream/55", primary: "bg-tomato text-white hover:bg-tomato-dark" },
};

/** One poster: headline and buttons on the left, a picture of the offer (or a poster photo) beside it. */
export function PosterSlide({
  poster,
  first,
  signedIn,
  counts,
  photos,
}: {
  poster: Poster;
  first: boolean;
  signedIn: boolean;
  counts: { name: string; n: number }[];
  photos: Photo[];
}) {
  const tone = TONES[poster.tone];
  const Heading = first ? "h1" : "h2";
  const secondary = signedIn ? poster.secondary?.customer : poster.secondary?.guest;

  return (
    <div className={cx("relative h-full overflow-hidden", tone.bg)}>
      {poster.image && (
        <div aria-hidden className="hero-bg absolute inset-0">
          <Image src={poster.image} alt="" fill priority={first} sizes="100vw" className="object-cover object-right" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-transparent" />
        </div>
      )}

      <div className="relative mx-auto grid h-full min-h-[400px] max-w-6xl items-center gap-12 px-4 pt-12 pb-20 sm:px-6 lg:min-h-[460px] lg:grid-cols-[1.1fr_1fr] lg:pt-14 lg:pb-24">
        <div className="hero-copy">
          <p className={cx("text-sm font-medium", tone.accent)}>
            <T>{poster.eyebrow}</T>
          </p>
          <Heading className="mt-3 max-w-xl font-display text-[2.4rem] leading-[1.04] font-bold tracking-[-0.02em] text-balance text-white sm:text-[3.2rem]">
            <T>{poster.title}</T>
          </Heading>
          <p className="mt-5 max-w-md leading-relaxed text-white/75">
            <T>{poster.text}</T>
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href={poster.cta.href} className={cx("group/cta inline-flex h-12 items-center gap-2 rounded-md px-6 text-sm font-semibold transition-colors", tone.primary)}>
              <T>{poster.cta.label}</T>
              <ArrowRight className="size-4 transition-transform group-hover/cta:translate-x-0.5" />
            </Link>
            {secondary && (
              // A real button too: for a new trade customer, opening an account is the first step.
              <Link
                href={secondary.href}
                className="inline-flex h-12 items-center rounded-md px-6 text-sm font-semibold text-white ring-1 ring-white/45 transition-colors ring-inset hover:bg-white/10 hover:ring-white"
              >
                <T>{secondary.label}</T>
              </Link>
            )}
          </div>
        </div>
        {!poster.image && (
          <div className="hero-art hidden lg:block">
            {poster.art === "categories" && <RangeIndex counts={counts} />}
            {poster.art === "products" && <PhotoGrid photos={photos} categories={poster.categories ?? []} />}
            {poster.art === "delivery" && <DeliveryCard />}
            {poster.art === "ranges" && <OneDocket counts={counts} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** The ranges on sale with how many products each has, as a ruled list. */
function RangeIndex({ counts }: { counts: { name: string; n: number }[] }) {
  return (
    <ul className="ml-auto max-w-md border-t border-white/15">
      {stockedCategories(counts).map(({ title }) => (
        <li key={title} className="border-b border-white/15">
          <Link href={categoryHref(title)} className="group flex items-baseline justify-between gap-4 py-3.5 text-white">
            <span className="font-display text-lg font-medium group-hover:underline group-hover:underline-offset-4">
              <T>{title}</T>
            </span>
            <span className="flex items-center gap-2 text-sm text-white/50 tabular-nums">
              <ProductCount n={counts.find((c) => c.name === title)?.n ?? 0} />
              <ArrowRight className="size-3.5 -translate-x-1 opacity-0 transition-[opacity,translate] group-hover:translate-x-0 group-hover:opacity-100" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Three product photos in a tidy grid: one tall on the left, two stacked on the right. */
function PhotoGrid({ photos, categories }: { photos: Photo[]; categories: string[] }) {
  const spots = [0, 1, 2].map((i) => ({ photo: photos[i], category: categories[i % Math.max(categories.length, 1)] ?? "" }));
  return (
    <div className="ml-auto grid aspect-[5/4] max-w-md grid-cols-2 grid-rows-2 gap-2.5">
      {spots.map(({ photo, category }, i) => {
        const place = i === 0 ? "row-span-2" : "";
        return photo ? (
          <Link key={i} href={`/products/${encodeURIComponent(photo.sku)}`} className={cx("overflow-hidden rounded-md bg-white", place)}>
            <ProductImage p={photo} className="size-full transition-transform duration-500 hover:scale-[1.03]" sizes="240px" />
          </Link>
        ) : (
          <Link key={i} href={categoryHref(category)} className={cx("flex flex-col justify-end rounded-md bg-white/[0.07] p-4 ring-1 ring-white/10 transition-colors hover:bg-white/[0.12]", place)}>
            <MissingPhoto category={category} />
          </Link>
        );
      })}
    </div>
  );
}

function MissingPhoto({ category }: { category: string }) {
  const Icon = categoryInfo(category).icon;
  return (
    <>
      <Icon className="size-7 text-white/35" strokeWidth={1.25} />
      <span className="mt-2 text-sm font-medium text-white/85">
        <T>{category}</T>
      </span>
    </>
  );
}

/** A delivery as the customer sees it in their account: the run, and where it's up to. */
function DeliveryCard() {
  const steps = [
    { label: "Order packed", state: "done" },
    { label: "Out for delivery", state: "live" },
    { label: "Photo & signature at the door", state: "next" },
  ] as const;
  return (
    <div className="ml-auto w-full max-w-sm rounded-lg bg-white p-5 text-leaf-950 shadow-xl shadow-black/25">
      <div className="flex items-baseline justify-between gap-3 border-b border-leaf-950/10 pb-3">
        <p className="font-semibold">
          <T>{"Today's delivery"}</T>
        </p>
        <p className="text-xs text-leaf-900/55">
          <T>{"On the morning run"}</T>
        </p>
      </div>
      {/* A little route map: the line draws itself from the depot to the stops. */}
      <svg viewBox="0 0 320 120" className="mt-4 h-28 w-full rounded bg-[#eef1ec]" aria-hidden>
        <path d="M0 40h320M0 85h320M70 0v120M190 0v120M260 0v120" stroke="rgb(17 58 39 / 0.07)" strokeWidth="10" />
        <path d="M30 95 C 70 95, 70 45, 120 45 S 170 80, 205 70 S 250 25, 290 30" fill="none" stroke="rgb(17 58 39 / 0.15)" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 8" />
        <path className="route-draw" d="M30 95 C 70 95, 70 45, 120 45 S 170 80, 205 70 S 250 25, 290 30" fill="none" stroke="#1e6b44" strokeWidth="4" strokeLinecap="round" pathLength={1} />
        <rect x="23" y="88" width="14" height="14" rx="2" fill="#113a27" />
        <circle cx="120" cy="45" r="6" fill="#258a56" stroke="white" strokeWidth="2" />
        <circle cx="205" cy="70" r="6" fill="#258a56" stroke="white" strokeWidth="2" />
        <circle cx="290" cy="30" r="8" fill="#e0620c" stroke="white" strokeWidth="3" />
      </svg>
      <ol className="mt-4 space-y-2.5">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-3 text-sm">
            <span
              className={cx(
                "grid size-5 shrink-0 place-items-center rounded-full",
                s.state === "done" && "bg-leaf-700 text-white",
                s.state === "live" && "ring-2 ring-tomato",
                s.state === "next" && "ring-2 ring-leaf-900/15",
              )}
            >
              {s.state === "done" && <Check className="size-3" strokeWidth={3} />}
              {s.state === "live" && <span className="size-2 rounded-full bg-tomato" />}
            </span>
            <span className={cx(s.state === "next" ? "text-leaf-900/50" : "font-medium")}>
              <T>{s.label}</T>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One delivery docket with a line for every range: the point of ordering everything from one place. */
function OneDocket({ counts }: { counts: { name: string; n: number }[] }) {
  return (
    <div className="ml-auto w-full max-w-sm rounded-lg bg-cream p-6 text-leaf-950 shadow-xl shadow-black/25">
      <div className="flex items-baseline justify-between border-b-2 border-leaf-950 pb-2">
        <p className="font-display font-bold tracking-tight">
          <T>{"Delivery docket"}</T>
        </p>
        <p className="text-xs text-leaf-900/55">
          <T>{"1 drop"}</T>
        </p>
      </div>
      <ul className="divide-y divide-dashed divide-leaf-950/20 text-sm">
        {stockedCategories(counts).map(({ title }) => (
          <li key={title}>
            <Link href={categoryHref(title)} className="flex items-center justify-between gap-3 py-2.5 hover:underline hover:underline-offset-2">
              <T>{title}</T>
              <Check className="size-4 text-leaf-700" strokeWidth={2.5} />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 border-t-2 border-leaf-950 pt-2 text-right text-sm font-semibold">
        <T>{"One invoice"}</T>
      </p>
    </div>
  );
}

const FOCUS = { left: "object-left", center: "object-center", right: "object-right" } as const;

/**
 * A poster uploaded in the back office. With a headline, its words sit over the picture (with a
 * dark fade for legibility); without one, the picture is the poster and the whole of it is the link.
 * A picture-only poster is shown whole over a blurred copy of itself, so words designed into it are
 * never cut off; on phones its upright phone picture is used instead when there is one.
 */
export function UploadedPosterSlide({ poster: p, first }: { poster: PosterRow; first: boolean }) {
  const Heading = first ? "h1" : "h2";
  const external = /^https?:\/\//.test(p.href);
  const wordsOver = !!p.headline;
  const desktop = posterImageUrl(p);
  const alt = wordsOver ? "" : p.name;
  // A designed poster (words in the picture) is never cropped: it's shown whole, any gap filled by a blurred copy.
  const whole = !wordsOver;

  const pictures = (
    <div className="hero-bg absolute inset-0">
      {whole && (
        <Image src={desktop} alt="" aria-hidden fill sizes="50vw" className={cx("scale-110 object-cover opacity-60 blur-2xl", p.hasMobileImage && "max-md:hidden")} />
      )}
      <Image
        src={desktop}
        alt={alt}
        fill
        priority={first}
        sizes="100vw"
        className={cx(whole ? "object-contain" : "object-cover", FOCUS[p.focus], p.hasMobileImage && "max-md:hidden")}
      />
      {p.hasMobileImage && <Image src={posterImageUrl(p, "mobile")} alt={alt} fill priority={first} sizes="100vw" className="object-cover md:hidden" />}
    </div>
  );
  const box = cx(
    "relative block h-full w-full overflow-hidden bg-leaf-950 lg:aspect-[3/1] lg:min-h-[460px]",
    p.hasMobileImage ? "aspect-[4/5] md:aspect-auto md:min-h-[400px]" : "min-h-[300px] md:min-h-[400px]",
  );

  if (!wordsOver) {
    const inner = (
      <>
        {pictures}
        {first && <h1 className="sr-only">{p.name}</h1>}
      </>
    );
    if (!p.href) return <div className={box}>{inner}</div>;
    return external ? (
      <a href={p.href} rel="noopener" className={box}>
        {inner}
      </a>
    ) : (
      <Link href={p.href} className={box}>
        {inner}
      </Link>
    );
  }

  return (
    <div className={box}>
      {pictures}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/0 md:bg-gradient-to-r md:from-black/80 md:via-black/40" />
      <div className="relative mx-auto flex h-full max-w-6xl items-end px-4 pt-12 pb-20 sm:px-6 md:items-center lg:pt-14 lg:pb-24">
        <div className="hero-copy max-w-xl">
          {p.eyebrow && <p className="text-sm font-medium text-white/70">{p.eyebrow}</p>}
          <Heading className="mt-3 font-display text-3xl leading-[1.04] font-bold tracking-[-0.02em] text-balance text-white sm:text-5xl">{p.headline}</Heading>
          {p.text && <p className="mt-4 max-w-lg text-cream/80">{p.text}</p>}
          {p.href && (
            <div className="mt-7">
              <PosterButton href={p.href} external={external}>
                {p.buttonLabel || <T>{"Shop now"}</T>}
              </PosterButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PosterButton({ href, external, children }: { href: string; external: boolean; children: React.ReactNode }) {
  const cls =
    "group/cta inline-flex h-12 items-center gap-2 rounded-md bg-tomato px-6 text-sm font-semibold text-white transition-colors hover:bg-tomato-dark";
  const inner = (
    <>
      {children}
      <ArrowRight className="size-4 transition-transform group-hover/cta:translate-x-0.5" />
    </>
  );
  return external ? (
    <a href={href} rel="noopener" className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}
