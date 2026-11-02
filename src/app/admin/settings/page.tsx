import { asc, desc, ne } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { apiKeys, depots, orderFeeds, users } from "@/lib/db/schema";
import { geocoderName } from "@/lib/geo/geocode";
import { routingName } from "@/lib/geo/routing";
import { getSettings } from "@/lib/planning";
import { IntegrationsCard } from "./integrations";
import { SettingsClient } from "./settings-client";
import { ShopSettingsCard } from "./shop-settings";
import { stripeEnabled } from "@/lib/stripe";
import { databaseUrl } from "@/lib/db/url";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireUser(["admin"]);
  const db = await getDb();
  const [s, userRows, depotRows, keyRows, feedRows] = await Promise.all([
    getSettings(db),
    db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(ne(users.role, "customer")).orderBy(asc(users.role), asc(users.name)),
    db.select().from(depots).orderBy(asc(depots.createdAt)),
    db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)),
    db.select().from(orderFeeds).orderBy(asc(orderFeeds.createdAt)),
  ]);

  return (
    <SettingsClient
      settings={s}
      meId={me.id}
      users={userRows}
      depots={depotRows.map((d) => ({ id: d.id, name: d.name, address: d.address, located: d.lat !== null, active: d.active }))}
      services={{
        database: databaseUrl() ? "PostgreSQL (DATABASE_URL / POSTGRES_URL)" : "Embedded local database (.data/pglite) — set DATABASE_URL for production",
        geocoder: geocoderName() === "google" ? "Google Geocoding API" : "OpenStreetMap Nominatim (free, 1 request/sec)",
        "map display": process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? "Google Maps" : "OpenStreetMap — set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY for Google Maps",
        routing: routingName(),
        "card payments": stripeEnabled() ? "Stripe" : "Off — set STRIPE_SECRET_KEY to accept cards",
        "scheduled sync": process.env.CRON_SECRET ? "Cron enabled (see vercel.json for the schedule)" : "Set CRON_SECRET to enable scheduled feed sync",
      }}
    >
      <ShopSettingsCard
        deliveryFeeCents={s.deliveryFeeCents}
        freeDeliveryOverCents={s.freeDeliveryOverCents}
        minOrderCents={s.minOrderCents}
        orderCutoffMin={s.orderCutoffMin}
        deliveryDays={s.deliveryDays}
        bankDetails={s.bankDetails}
        stripe={stripeEnabled()}
      />
      <IntegrationsCard
        keys={keyRows.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          createdAt: k.createdAt.toISOString(),
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          revoked: !!k.revokedAt,
        }))}
        feeds={feedRows.map((f) => ({
          id: f.id,
          name: f.name,
          url: f.url,
          format: f.format,
          dateMode: f.dateMode,
          enabled: f.enabled,
          hasAuth: !!f.authHeader,
          mapping: f.mapping,
          lastResult: f.lastResult,
        }))}
      />
    </SettingsClient>
  );
}
