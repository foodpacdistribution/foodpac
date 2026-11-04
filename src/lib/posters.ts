import "server-only";
import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { DB } from "./db";
import { posters, settings } from "./db/schema";

/** Everything about a poster except the pictures themselves. */
const posterColumns = {
  id: posters.id,
  name: posters.name,
  eyebrow: posters.eyebrow,
  headline: posters.headline,
  text: posters.text,
  buttonLabel: posters.buttonLabel,
  href: posters.href,
  focus: posters.focus,
  hasMobileImage: sql<boolean>`${posters.mobileImage} is not null`,
  sortOrder: posters.sortOrder,
  active: posters.active,
  startsOn: posters.startsOn,
  endsOn: posters.endsOn,
  updatedAt: posters.updatedAt,
};

export type PosterRow = Awaited<ReturnType<typeof listPosters>>[number];

/** Every uploaded poster, in the order they show (back office). */
export function listPosters(db: DB) {
  return db.select(posterColumns).from(posters).orderBy(asc(posters.sortOrder), asc(posters.createdAt));
}

/** The uploaded posters showing on the home page today (in the business's time zone): switched on and inside their dates. */
export function livePosters(db: DB) {
  // Worked out in the database, so this runs alongside the settings query rather than after it.
  const today = sql`(now() at time zone (select ${settings.timezone} from ${settings} where ${settings.id} = 1))::date`;
  return db
    .select(posterColumns)
    .from(posters)
    .where(and(eq(posters.active, true), or(isNull(posters.startsOn), lte(posters.startsOn, today)), or(isNull(posters.endsOn), gte(posters.endsOn, today))))
    .orderBy(asc(posters.sortOrder), asc(posters.createdAt));
}

/** A link a poster may use: a page on this site, or a full http(s) address. */
export function cleanPosterHref(href: string) {
  const h = href.trim();
  if (!h) return "";
  if (/^\/(?![/\\])/.test(h)) return h;
  try {
    const u = new URL(h);
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
  } catch {}
  return null;
}
