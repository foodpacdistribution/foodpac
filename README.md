# Foodpac Distribution System

One platform from the customer's order to the signed delivery:

| Area | URL | Who |
| --- | --- | --- |
| Online shop (catalogue, search, cart, checkout) | `/`, `/products`, `/cart`, `/checkout` | Customers (prices after sign-in) |
| Customer account (orders, live tracking, proof of delivery, invoices, quick order, addresses) | `/portal` | Customers |
| Back office (sales orders, products & stock, customers & price lists, delivery planning, tracking, enquiries) | `/admin` | Admin, dispatcher |
| Driver app (route, navigation, photo + signature + GPS at each drop) | `/driver` | Drivers |

**Order flow:** customer places an order → stock is reserved → card orders wait for Stripe, bank-transfer and invoice orders are confirmed straight away → a confirmed order becomes a delivery order on its delivery day → warehouse picks, packs, loads → the planner optimises routes → driver delivers with photo, signature and a GPS fix → the customer sees it all in `/portal`.

Order, payment, warehouse, delivery and proof-of-delivery status are stored separately.

## Online shop

- **Prices** are worked out on the server for the signed-in customer: their own price (Back office → Customers → Price list) or the list price. Guests and unapproved accounts see no prices. Prices are ex GST; GST (10%) applies to taxable lines and the delivery fee.
- **Stock** is reserved with a conditional update when the order is placed (no overselling) and returned when an order is cancelled or an unpaid card checkout expires (30 min).
- **Payment methods:** card (Stripe Checkout, only when `STRIPE_SECRET_KEY` is set), bank transfer, and pay by invoice for customers with invoice terms (Net 7/14/30) within their credit limit.
- **Checkout** checks delivery days and the order cut-off (Settings → Online shop), the minimum order and the free-delivery threshold. A double-click can't place the order twice (idempotency key).
- **Customers** can register themselves at `/register`; staff approve them under Customers. Orders imported or synced for a customer's name or phone are linked to their account automatically.
- **Customer tracking** shows the van live only for the last leg to that customer (never other customers' stops), plus the photo, signature, recipient and how far from the address the driver confirmed delivery.
- Edit the public wording, categories and company details (phone, email, ABN for invoices) in `src/app/(site)/content.ts`.

---

The delivery engine below plans and dispatches the routes.

**Daily flow:** import orders → verify addresses → optimise routes → adjust if needed → dispatch → drivers navigate and mark stops delivered/failed → history and analytics.

## Run it locally (no accounts or API keys needed)

```bash
npm install
npm run dev
```

Open http://localhost:3000. The first request creates an embedded Postgres database in `.data/pglite` with demo data: a Brisbane depot, 3 drivers and 30 orders for today.

| Login | Role |
| --- | --- |
| `admin@demo.local` / `demo1234` | Admin |
| `dispatch@demo.local` / `demo1234` | Dispatcher |
| `john@demo.local` / `demo1234` (also `mia@`, `sam@`) | Driver (open on a phone) |
| `customer@demo.local` / `demo1234` | Customer (shop + portal) |

To start from scratch: stop the dev server, run `npm run reset-local`, and start it again.

## How routes are calculated

Routes are calculated, never guessed. The pipeline is:

1. **Geocoding.** Turns each address into coordinates. Uses OpenStreetMap Nominatim by default, or Google if `GOOGLE_MAPS_API_KEY` is set. Results are cached, and every address is marked *Verified*, *Approximate* or *Not found*.
2. **Road travel matrix.** OSRM supplies real driving time and distance between every pair of stops. A *traffic buffer* (+15% by default) covers congestion and parking, because OSRM times assume free-flowing traffic.
3. **Optimiser** (`src/lib/vrp`). A vehicle-routing solver with:
   - delivery time windows, vehicle capacity, a maximum shift length per driver, unload time per stop
   - priority orders, and orders pinned to a specific driver
   - regret insertion, then local search (relocate, or-opt, swap, 2-opt), then ruin-and-recreate until the time budget runs out
   - orders it can't serve are left unassigned with a reason ("window can't be reached", "no capacity left", …). It never forces them in silently.
4. **Results.** For each driver: ETAs, total distance, driving, unloading and waiting time, and finish time. Across the fleet: the overall "all done by" time, plus a **before vs after** comparison against the orders driven in spreadsheet order, using the same road data.

Objectives:
- *Finish everyone early* (balanced workload)
- *Least total driving time*
- *Shortest distance*

**Manual changes.** Dispatchers can reorder stops, move them between drivers (drag and drop on the Dispatch board) or unassign them. Clicking *Recalculate* re-times the plan using the stored matrix. Every optimisation and edit is kept in the plan history.

**Mid-day changes.** Re-optimising after dispatch keeps completed stops untouched. Remaining and new orders are re-planned from each driver's last completed stop, starting from the current time.

## Quick route (single driver)

`/quick-route` is for when a driver just has a handful of drops to do: no orders, plan or dispatch needed. Drivers open it from the *Quick route* button on their page; staff use *Quick Route* in the sidebar.

1. Choose a start: the phone's GPS position (needs HTTPS or localhost), the depot, or a typed address.
2. Paste the addresses, one per line, and tap *Check addresses*. They're located one at a time, with progress shown.
3. **Check the pins.** Approximate matches are amber. Drag any pin that's on the wrong building. Addresses that aren't found must be edited, pinned by hand or removed before planning, because a wrong pin means a wrong route.
4. Choose how the route ends: at the last stop, back at the start, or at the depot.
5. The page fetches the OSRM matrix for the confirmed pins (with the traffic buffer) and returns the fastest order. For each stop it shows the drive time and distance from the previous stop and the ETA. It also shows how much driving that saves compared with the order you typed. Up to 9 stops, every possible order is compared, so the result is exact. Above 9, the solver's heuristic is used (max 25 stops).
6. *Start navigation* hands one stop at a time to Google Maps or Apple Maps, so the navigation app can't reorder the stops. Mark each stop *Delivered* or *Couldn't deliver* to move on. *Re-plan remaining* re-optimises what's left from the current GPS position.
7. **Live ETAs.** While driving, the remaining ETAs and the finish time are re-timed from when each stop was actually finished. If the driver is still on the way to a stop after its planned arrival, the ETAs move later. Stops more than 3 minutes behind the plan are flagged.

Quick routes are not saved to the database. The route in progress lives in the phone's browser storage, so it survives a page refresh.

## Sign-in protection

Each email gets 5 sign-in attempts and each IP gets 30 per 15 minutes. After that, sign-in is refused until the window ends, even with the right password. A successful sign-in clears the email's count. Attempts are counted in Postgres (`login_throttle`) before the password is checked, so they add up correctly across server instances and parallel requests. The IP comes from `x-forwarded-for`, which Vercel sets.

## Roles

- **Admin:** everything, including settings, staff logins and drivers.
- **Dispatcher:** orders, planning, dispatch, history.
- **Driver:** only their own dispatched route (`/driver`). The server enforces this on every action, not just by hiding buttons.

## Production setup

1. Postgres: create a Supabase or Neon database and set `DATABASE_URL`. On Vercel, migrations run automatically before each build, and the first admin is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (optional `ADMIN_NAME`) if none exists. Elsewhere, run:
   ```bash
   npm run db:migrate
   npm run create-admin -- you@company.com "Your Name" 'a-long-password'
   ```
2. Set `AUTH_SECRET` (`openssl rand -base64 32`).
3. Routing: self-host OSRM with an Australia extract and set `OSRM_URL`. The public demo server is fine for trials only.
4. Map tiles: set `NEXT_PUBLIC_TILE_URL` to a commercial tile provider.
5. Optional: set `GOOGLE_MAPS_API_KEY` for more accurate geocoding of unit and shop addresses.
6. Deploy to Vercel (or any Node host).

See `.env.example` for every variable.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server (embedded DB if no `DATABASE_URL`) |
| `npm test` | Solver, time-parsing and import tests |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run db:generate` | New migration after editing `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |

## Phase 2 features

**Multiple depots.** Add depots in Settings (each address is located on the map when you save).
- Each driver has a home depot: their route starts, reloads and ends there.
- An order can be tied to a "ship from" depot, from the order form or a `Depot` column in imports and feeds. Only drivers based at that depot will be given it.

**Multiple trips.** Set "Trips per day" on a driver.
- When the next stop would overflow the vehicle, the optimiser inserts a return to the depot to reload, using the reload time from Settings.
- Trips, reload times and the reload leg are shown in the planner, on the map and on the driver's phone.

**Live GPS tracking.** Drivers share their phone's location from the driver page.
- The server accepts fixes only while that driver's route is in progress, so nothing is collected before they start or after they finish.
- *Live Tracking* shows each driver's position, driven trail, distance to the next stop and speed.
- It also flags signal loss, long stops away from any delivery address, and drivers running behind.
- History shows GPS-measured kilometres against planned kilometres.
- Browsers pause GPS when the app is in the background or the screen locks. The page keeps the screen awake, but a native app is needed for guaranteed background tracking.

**Photos and signatures.**
- *Delivered* takes a camera photo (resized on the phone to ~100–300 KB) and an on-screen signature. *Problem* can also attach a photo.
- Settings can make the photo and/or signature mandatory; the server enforces this.
- Staff open the delivery record from the order's status badge.
- Proof images are stored in Postgres. For high volume, move them to object storage by replacing the two functions in `src/lib/proofs.ts`.

**Automatic order sync.**
- **API.** Create a key in Settings → Order sync, then:
  - push orders with `POST /api/v1/orders` (create or update, matched by order number + date)
  - read delivery status, recipient and failure reason with `GET /api/v1/orders?date=`
  - cancel with `DELETE /api/v1/orders/{orderNumber}?date=`
- **Scheduled feeds.** Point at a CSV/JSON URL your system exports to. Columns are mapped automatically or with a JSON mapping. Pull it with *Sync now*, or on a schedule via Vercel Cron (`vercel.json`, needs `CRON_SECRET`). The default is once a day at 5am Brisbane time (19:00 UTC), the most often Vercel's free plan allows; on Pro, change it to `*/15 * * * *` for every 15 minutes.
- Orders already planned or out for delivery are never changed by a sync; they're reported as *locked*. Re-sending identical data is a no-op.
- New addresses are geocoded in the background.

## Not built yet

- Native mobile app for background GPS
- Pickup + delivery pairs; customer notifications by SMS or email

## Backups

Supabase's free plan keeps no backups, so `.github/workflows/db-backup.yml` backs up the live
database every night at 3am Brisbane time and keeps each backup for 30 days. The repository is
public, so every backup is encrypted with `BACKUP_PASSPHRASE` before it is stored.

**Setup (once):** in GitHub → Settings → Secrets and variables → Actions, add `DATABASE_URL` (the
Supabase pooler address with the password, as in Vercel) and `BACKUP_PASSPHRASE` (a long random
passphrase, e.g. from `openssl rand -base64 32`). Keep a copy of the passphrase in a password
manager: without it the backups can't be opened. Run the workflow once by hand (Actions →
Database backup → Run workflow) to check it works.

**Restore:**

1. Actions → Database backup → the night you want → Artifacts → download it and unzip.
2. `gpg --decrypt foodpac-db-YYYY-MM-DD.dump.gpg > backup.dump` (asks for the passphrase).
3. Restore into an **empty** database (a new Supabase project, or a scratch one to look at it
   first), with the pooler's session port 5432:
   `pg_restore --no-owner --no-privileges -d "postgresql://…:5432/postgres" backup.dump`.
   One error, `schema "public" already exists`, is expected and harmless.
4. Point `DATABASE_URL` in Vercel at that database and redeploy.

The nightly cron also checks the database size and emails the office past 400 MB (the free plan
stops writes at 500 MB). `DB_SIZE_ALERT_MB` changes the threshold.
