import { ArrowRight, Check, Truck } from "lucide-react";
import Image from "next/image";
import Link from "@/components/link";
import { cx } from "@/components/ui";
import { T } from "@/components/i18n";
import { CATEGORIES, categoryHref, categoryInfo, type Poster } from "./content";
import { ProductImage } from "./shop-ui";

type Photo = { id: string; sku: string; name: string; category: string; updatedAt: Date; hasImage: boolean };

const TONES: Record<Poster["tone"], { bg: string; glow: string; accent: string; primary: string }> = {
  leaf: {
    bg: "bg-leaf-900",
    glow: "bg-[radial-gradient(55%_75%_at_85%_25%,rgb(37_138_86/0.55),transparent_70%),radial-gradient(40%_60%_at_0%_100%,rgb(224_98_12/0.18),transparent_70%)]",
    accent: "text-tomato",
    primary: "bg-tomato text-white hover:bg-tomato-dark",
  },
  tomato: {
    bg: "bg-gradient-to-br from-[#b84b07] via-[#9a3c06] to-[#5c2204]",
    glow: "bg-[radial-gradient(50%_70%_at_80%_30%,rgb(255_190_120/0.35),transparent_70%)]",
    accent: "text-amber-200",
    primary: "bg-white text-tomato-dark hover:bg-cream",
  },
  navy: {
    bg: "bg-navy-900",
    glow: "bg-[radial-gradient(55%_75%_at_80%_30%,rgb(31_58_102/0.9),transparent_70%),radial-gradient(35%_50%_at_10%_90%,rgb(224_98_12/0.22),transparent_70%)]",
    accent: "text-tomato",
    primary: "bg-tomato text-white hover:bg-tomato-dark",
  },
  night: {
    bg: "bg-leaf-950",
    glow: "bg-[radial-gradient(50%_70%_at_90%_20%,rgb(30_107_68/0.6),transparent_70%),radial-gradient(45%_60%_at_60%_110%,rgb(224_98_12/0.25),transparent_70%)]",
    accent: "text-tomato",
    primary: "bg-tomato text-white hover:bg-tomato-dark",
  },
};

/** One poster: headline and buttons on the left, an illustration (or a poster photo) behind or beside it. */
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
  const Watermark = poster.art === "delivery" ? Truck : categoryInfo(poster.categories?.[0] ?? "").icon;

  return (
    <div className={cx("relative h-full overflow-hidden", tone.bg)}>
      {/* Background: soft light, a fine dot grid, and the poster photo when there is one. */}
      <div aria-hidden className="hero-bg absolute inset-0">
        {poster.image && (
          <>
            <Image src={poster.image} alt="" fill priority={first} sizes="100vw" className="object-cover object-right" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-transparent" />
          </>
        )}
        <div className={cx("absolute inset-0", tone.glow)} />
        <div className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255/0.07)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_left,black,transparent_75%)]" />
        {!poster.image && <Watermark className="absolute -right-10 -bottom-16 size-72 text-white/[0.04] lg:hidden" strokeWidth={1} />}
      </div>

      <div className="relative mx-auto grid min-h-[400px] max-w-6xl items-center gap-10 px-4 pt-12 pb-20 sm:px-6 lg:min-h-[460px] lg:grid-cols-[1.15fr_1fr] lg:pt-14 lg:pb-24">
        <div className="hero-copy">
          <p className={cx("text-xs font-semibold tracking-[0.18em] uppercase", tone.accent)}>
            <T>{poster.eyebrow}</T>
          </p>
          <Heading className="mt-3 max-w-xl font-display text-4xl leading-[1.05] font-semibold tracking-tight text-balance text-white sm:text-5xl">
            <T>{poster.title}</T>
          </Heading>
          <p className="mt-4 max-w-lg text-cream/75">
            <T>{poster.text}</T>
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href={poster.cta.href}
              className={cx(
                "group/cta inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm font-semibold shadow-lg shadow-black/20 transition-[background-color,scale] active:scale-[0.97]",
                tone.primary,
              )}
            >
              <T>{poster.cta.label}</T>
              <ArrowRight className="size-4 transition-transform group-hover/cta:translate-x-0.5" />
            </Link>
            {secondary && (
              <Link
                href={secondary.href}
                className="inline-flex h-12 items-center rounded-full px-5 text-sm font-semibold text-white ring-1 ring-white/30 transition-[background-color,scale] hover:bg-white/10 active:scale-[0.97]"
              >
                <T>{secondary.label}</T>
              </Link>
            )}
          </div>
        </div>
        {!poster.image && (
          <div className="hero-art hidden lg:block">
            {poster.art === "categories" && <CategoryTiles counts={counts} />}
            {poster.art === "products" && <PhotoCollage photos={photos} categories={poster.categories ?? []} />}
            {poster.art === "delivery" && <DeliveryCard />}
            {poster.art === "ranges" && <RangeGrid />}
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryTiles({ counts }: { counts: { name: string; n: number }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {CATEGORIES.slice(0, 4).map(({ icon: Icon, title }) => (
        <Link
          key={title}
          href={categoryHref(title)}
          className="group rounded-2xl bg-white/[0.06] p-5 ring-1 ring-white/10 backdrop-blur-sm transition-[background-color,translate,scale] hover:-translate-y-0.5 hover:bg-white/[0.12] active:scale-[0.98]"
        >
          <span className="grid size-11 place-items-center rounded-xl bg-tomato/15 text-tomato transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
            <Icon className="size-5" />
          </span>
          <p className="mt-4 text-sm font-semibold text-white">
            <T>{title}</T>
          </p>
          <p className="text-xs text-cream/55">
            <T vars={{ n: counts.find((c) => c.name === title)?.n ?? 0 }}>{"{n} products"}</T>
          </p>
        </Link>
      ))}
    </div>
  );
}

const COLLAGE = [
  "left-0 top-[6%] w-[56%] aspect-[4/5] -rotate-[4deg]",
  "right-[2%] top-0 w-[46%] aspect-square rotate-[5deg]",
  "right-[8%] bottom-0 w-[44%] aspect-[4/3] -rotate-[2deg]",
];

function PhotoCollage({ photos, categories }: { photos: Photo[]; categories: string[] }) {
  // Not enough photos yet: the missing spots show the range's icon instead.
  const spots = COLLAGE.map((place, i) => ({ place, photo: photos[i], category: categories[i % Math.max(categories.length, 1)] ?? "" }));
  return (
    <div className="relative mx-auto aspect-[5/4] w-full max-w-md">
      {spots.map(({ place, photo, category }, i) =>
        photo ? (
          <Link
            key={i}
            href={`/products/${encodeURIComponent(photo.sku)}`}
            className={cx("absolute overflow-hidden rounded-3xl bg-white shadow-2xl shadow-black/40 ring-4 ring-white/15 transition-[rotate,scale] duration-500 hover:z-10 hover:scale-[1.04] hover:rotate-0", place)}
          >
            <ProductImage p={photo} className="size-full" sizes="280px" />
          </Link>
        ) : (
          <Link
            key={i}
            href={categoryHref(category)}
            className={cx("absolute grid place-items-center rounded-3xl bg-white/[0.08] ring-1 ring-white/15 backdrop-blur transition-[rotate,scale] duration-500 hover:z-10 hover:scale-[1.04] hover:rotate-0", place)}
          >
            <IconBadge category={category} />
          </Link>
        ),
      )}
      <div className="absolute bottom-[8%] left-[3%] rounded-2xl bg-white px-4 py-3 text-leaf-950 shadow-xl shadow-black/30">
        <p className="text-[11px] font-semibold tracking-wider text-tomato uppercase">
          <T>{"Trade prices"}</T>
        </p>
        <p className="text-sm font-semibold">
          <T>{"Sold by the carton"}</T>
        </p>
      </div>
    </div>
  );
}

function IconBadge({ category }: { category: string }) {
  const Icon = categoryInfo(category).icon;
  return (
    <span className="flex flex-col items-center gap-2 px-3 text-center">
      <Icon className="size-10 text-amber-200" strokeWidth={1.5} />
      <span className="text-xs font-semibold text-white/80">
        <T>{category}</T>
      </span>
    </span>
  );
}

function DeliveryCard() {
  const steps = [
    { label: "Order packed", state: "done" },
    { label: "Out for delivery", state: "live" },
    { label: "Photo & signature at the door", state: "next" },
  ] as const;
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="rounded-3xl bg-white p-5 pb-11 text-leaf-950 shadow-2xl shadow-black/40">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-leaf-700 text-white">
            <Truck className="size-5" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold">
              <T>{"Today's delivery"}</T>
            </p>
            <p className="text-xs text-leaf-900/55">
              <T>{"On the morning run"}</T>
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-leaf-50 px-2.5 py-1 text-[11px] font-semibold text-leaf-700">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-leaf-600 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-leaf-600" />
            </span>
            <T>{"Live"}</T>
          </span>
        </div>
        {/* A little route map: the line draws itself from the depot to the stops. */}
        <svg viewBox="0 0 320 120" className="mt-4 h-28 w-full rounded-2xl bg-leaf-50" aria-hidden>
          <path d="M0 40h320M0 85h320M70 0v120M190 0v120M260 0v120" stroke="rgb(17 58 39 / 0.06)" strokeWidth="10" />
          <path d="M30 95 C 70 95, 70 45, 120 45 S 170 80, 205 70 S 250 25, 290 30" fill="none" stroke="rgb(17 58 39 / 0.15)" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 8" />
          <path className="route-draw" d="M30 95 C 70 95, 70 45, 120 45 S 170 80, 205 70 S 250 25, 290 30" fill="none" stroke="#1e6b44" strokeWidth="4" strokeLinecap="round" pathLength={1} />
          <circle cx="30" cy="95" r="7" fill="#113a27" />
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
                  s.state === "done" && "bg-leaf-600 text-white",
                  s.state === "live" && "bg-tomato/15 ring-2 ring-tomato",
                  s.state === "next" && "ring-2 ring-leaf-900/15",
                )}
              >
                {s.state === "done" && <Check className="size-3" strokeWidth={3} />}
                {s.state === "live" && <span className="size-1.5 animate-pulse rounded-full bg-tomato" />}
              </span>
              <span className={cx(s.state === "next" ? "text-leaf-900/50" : "font-medium")}>
                <T>{s.label}</T>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="absolute -bottom-5 -left-6 rounded-2xl bg-tomato px-4 py-3 text-white shadow-xl shadow-black/30">
        <p className="text-[11px] font-semibold tracking-wider text-white/75 uppercase">
          <T>{"Delivery window"}</T>
        </p>
        <p className="text-sm font-semibold">
          <T>{"Before service"}</T>
        </p>
      </div>
    </div>
  );
}

function RangeGrid() {
  return (
    <div className="grid grid-cols-3 gap-3">
      {CATEGORIES.map(({ icon: Icon, title }, i) => (
        <Link
          key={title}
          href={categoryHref(title)}
          style={{ animationDelay: `${i * -0.7}s` }}
          className="float group flex aspect-square flex-col items-center justify-center gap-2.5 rounded-2xl bg-white/[0.06] p-3 text-center ring-1 ring-white/10 backdrop-blur-sm transition-[background-color,scale] hover:bg-white/[0.12] active:scale-[0.97]"
        >
          <span className="grid size-12 place-items-center rounded-full bg-tomato/15 text-tomato transition-transform duration-300 group-hover:scale-110">
            <Icon className="size-5" />
          </span>
          <span className="text-xs leading-tight font-semibold text-white/85">
            <T>{title}</T>
          </span>
        </Link>
      ))}
    </div>
  );
}
