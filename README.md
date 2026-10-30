# AI Delivery Planner

Turn each day's orders into optimised, multi-driver delivery routes — then dispatch them to drivers' phones and track progress.

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
2. Paste the addresses, one per line.
3. Choose how the route ends: at the last stop, back at the start, or at the depot.
4. The page geocodes the addresses, fetches the OSRM matrix (with the traffic buffer), and returns the fastest order. For each stop it shows the drive time and distance from the previous stop and the ETA. It also shows how much driving that saves compared with the order you typed. Up to 9 stops, every possible order is compared, so the result is exact. Above 9, the solver's heuristic is used (max 25 stops).
5. *Start navigation* hands one stop at a time to Google Maps or Apple Maps, so the navigation app can't reorder the stops. Mark each stop *Delivered* or *Couldn't deliver* to move on. *Re-plan remaining* re-optimises what's left from the current GPS position.

Quick routes are not saved to the database. The route in progress lives in the phone's browser storage, so it survives a page refresh.

## Roles

- **Admin:** everything, including settings, staff logins and drivers.
- **Dispatcher:** orders, planning, dispatch, history.
- **Driver:** only their own dispatched route (`/driver`). The server enforces this on every action, not just by hiding buttons.

## Production setup

1. Postgres: create a Supabase or Neon database and set `DATABASE_URL`. Then run:
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
- **Scheduled feeds.** Point at a CSV/JSON URL your system exports to. Columns are mapped automatically or with a JSON mapping. Pull it with *Sync now*, or every 15 minutes via Vercel Cron (`vercel.json`, needs `CRON_SECRET`).
- Orders already planned or out for delivery are never changed by a sync; they're reported as *locked*. Re-sending identical data is a no-op.
- New addresses are geocoded in the background.

## Not built yet

- Native mobile app for background GPS
- Pickup + delivery pairs; customer notifications by SMS or email
