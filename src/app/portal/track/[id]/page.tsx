import { ArrowLeft, Camera, CheckCircle2, Clock, MapPin, PenLine, ShieldCheck, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { notFound } from "next/navigation";
import { cx } from "@/components/ui";
import { requireUser } from "@/lib/auth/dal";
import { prettyDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { formatAgo } from "@/lib/live-map";
import { haversine } from "@/lib/geo/routing";
import { DELIVERY_PLACE_WARN_M, describeDeliveryPlace } from "@/lib/orders";
import { getSettings } from "@/lib/planning";
import { getPortalOrder, type PortalOrder } from "@/lib/portal";
import { formatClock, formatMinutesClock } from "@/lib/time";
import { StageBadge, StageSteps } from "../../stage";
import { T, Tx } from "@/components/i18n";

export const metadata: Metadata = { title: "Order tracking" };

export default async function PortalOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["customer"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !user.customerId) notFound();
  const db = await getDb();
  const s = await getSettings(db);
  const o = await getPortalOrder(db, user.customerId, id, s.timezone);
  if (!o) notFound();
  const time = (iso: string) => new Intl.DateTimeFormat("en-AU", { timeZone: s.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  // Straight-line distance from the van to the customer while theirs is the next stop (no map for customers).
  const vanKm = o.van && o.point && !o.stopsBefore ? haversine(o.van, o.point) / 1000 : null;

  return (
    <>
      <Link href="/portal/deliveries" className="inline-flex items-center gap-1.5 text-sm text-leaf-900/60 hover:text-leaf-900">
        <ArrowLeft className="size-4" /> {" "}<T>{"All deliveries"}</T></Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight"><T>{"Order"}</T>{" "}{o.orderNumber}</h1>
          <p className="mt-0.5 text-sm text-leaf-900/60">
            {<Tx>{prettyDate(o.deliveryDate)}</Tx>} · {o.address}
          </p>
        </div>
        <StageBadge stage={o.stage} />
      </div>

      <div className="mt-5 rounded-3xl border border-leaf-950/10 bg-white p-5">
        <StageSteps stage={o.stage} />
        <Headline o={o} time={time} />
      </div>

      {o.stage === "out_for_delivery" && (
        <section className="mt-4 flex items-center gap-3 rounded-3xl border border-leaf-950/10 bg-white p-5">
          <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-600">
            <Truck className="size-5" />
            <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/20" />
          </span>
          <div className="text-sm">
            <p className="font-semibold">
              {o.stopsBefore
                ? <Tx>{`${o.stopsBefore} stop${o.stopsBefore === 1 ? "" : "s"} before yours`}</Tx>
                : vanKm !== null
                  ? `Your van is about ${vanKm < 1 ? `${Math.max(100, Math.round((vanKm * 1000) / 100) * 100)} m` : `${vanKm.toFixed(1)} km`} away`
                  : <T>{"You're the next stop"}</T>}
            </p>
            <p className="text-leaf-900/60">
              {o.van && !o.stopsBefore ? <><Tx>{`Updated ${formatAgo(o.van.ageS)}.`}</Tx> </> : ""}<T>{"This page updates by itself."}</T></p>
          </div>
        </section>
      )}

      {o.outcome && <Proof o={o} time={time} />}

      <section className="mt-4 rounded-3xl border border-leaf-950/10 bg-white p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-leaf-900/50"><T>{"Delivery record"}</T></h2>
        <ol className="mt-4 space-y-4">
          <Event done icon={CheckCircle2} title={<T>{"Order received"}</T>} text={`Booked in for ${prettyDate(o.deliveryDate)}.`} />
          {o.windowStartMin !== null || o.windowEndMin !== null ? (
            <Event
              done={o.stage !== "received"}
              icon={Clock}
              title={<T>{"Delivery window"}</T>}
              text={`${o.windowStartMin !== null ? formatMinutesClock(o.windowStartMin) : "Any time"} – ${o.windowEndMin !== null ? formatMinutesClock(o.windowEndMin) : "end of day"}`}
            />
          ) : null}
          <Event
            done={!!o.pickedUpAt}
            icon={Truck}
            title={<T>{"Picked up & out for delivery"}</T>}
            text={o.pickedUpAt ? `Loaded at our warehouse${o.driverFirstName ? ` and on the road with ${o.driverFirstName}` : ""} from ${time(o.pickedUpAt)}.` : "Not yet."}
          />
          <Event
            done={!!o.outcome}
            tone={o.outcome?.type === "failed" ? "red" : undefined}
            icon={o.outcome?.type === "failed" ? Clock : ShieldCheck}
            title={<T>{o.outcome?.type === "failed" ? "Delivery attempted" : "Delivered"}</T>}
            text={
              <Tx>
                {o.outcome
                  ? o.outcome.type === "delivered"
                    ? `${time(o.outcome.at)}${o.outcome.recipient ? ` · received by ${o.outcome.recipient}` : ""}`
                    : `${time(o.outcome.at)} · ${o.outcome.reason ?? "Couldn't deliver"}. We'll be in touch to rebook.`
                  : "Not yet."}
              </Tx>
            }
          />
        </ol>
      </section>
    </>
  );
}

function Headline({ o, time }: { o: PortalOrder; time: (iso: string) => string }) {
  const box = "mt-5 rounded-2xl px-4 py-3";
  if (o.stage === "out_for_delivery") {
    return (
      <div className={cx(box, "bg-amber-50")}>
        <p className="font-display text-xl font-semibold text-amber-900">{o.etaS !== null ? `Arriving around ${formatClock(o.etaS)}` : <T>{"On the way"}</T>}</p>
        <p className="mt-0.5 text-sm text-amber-900/75">
          {o.stopsBefore === 0 ? <T>{"You're the next stop."}</T> : o.stopsBefore ? <Tx>{`${o.stopsBefore} stop${o.stopsBefore === 1 ? "" : "s"} before yours.`}</Tx> : <T>{"Your order has left our warehouse."}</T>}
          {o.pickedUpAt && ` Picked up at ${time(o.pickedUpAt)}.`}
        </p>
      </div>
    );
  }
  if (o.stage === "delivered" && o.outcome) {
    return (
      <div className={cx(box, "bg-leaf-50")}>
        <p className="font-display text-xl font-semibold text-leaf-800"><T>{"Delivered at"}</T>{" "}{time(o.outcome.at)}</p>
        <p className="mt-0.5 text-sm text-leaf-900/70">
          {o.outcome.recipient ? `Signed for by ${o.outcome.recipient}.` : <T>{"Proof of delivery is below."}</T>}
        </p>
      </div>
    );
  }
  if (o.stage === "failed" && o.outcome) {
    return (
      <div className={cx(box, "bg-red-50")}>
        <p className="font-display text-xl font-semibold text-red-800"><T>{"We couldn't deliver this order"}</T></p>
        <p className="mt-0.5 text-sm text-red-900/70">
          {o.outcome.reason ?? <T>{"Delivery attempted"}</T>} {" "}<T>{"at"}</T>{" "}{time(o.outcome.at)}<T>{". Our team will contact you to rebook."}</T></p>
      </div>
    );
  }
  return (
    <div className={cx(box, "bg-[#f5f1e8]")}>
      <p className="font-display text-xl font-semibold">{o.stage === "scheduled" ? `Scheduled for ${prettyDate(o.deliveryDate)}` : <T>{"We've got your order"}</T>}</p>
      <p className="mt-0.5 text-sm text-leaf-900/70">
        {o.etaS !== null ? `Planned arrival around ${formatClock(o.etaS)}. ` : ""}
        <T>{"You'll see its progress here once it leaves our warehouse."}</T></p>
    </div>
  );
}

function Proof({ o, time }: { o: PortalOrder; time: (iso: string) => string }) {
  const out = o.outcome!;
  const photo = out.proofs.find((p) => p.kind === "photo");
  const signature = out.proofs.find((p) => p.kind === "signature");
  const placeText = out.place ? describeDeliveryPlace(out.place.distanceM, out.place.accuracyM) : null;
  const far = (out.place?.distanceM ?? 0) > DELIVERY_PLACE_WARN_M;
  return (
    <section className="mt-4 rounded-3xl border border-leaf-950/10 bg-white p-5">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-leaf-900/50">{out.type === "delivered" ? <T>{"Proof of delivery"}</T> : <T>{"Delivery attempt"}</T>}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {photo ? (
          <a href={`/api/proofs/${photo.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl border border-leaf-950/10 bg-[#f5f1e8]">
            {/* eslint-disable-next-line @next/next/no-img-element -- private, signed-in image */}
            <img src={`/api/proofs/${photo.id}`} alt="Photo taken by the driver at delivery" className="h-56 w-full object-cover" />
            <span className="flex items-center gap-1.5 px-3 py-2 text-xs text-leaf-900/70">
              <Camera className="size-3.5" /> {" "}<T>{"Photo at"}</T>{" "}{time(out.at)}
            </span>
          </a>
        ) : (
          <div className="grid h-56 place-items-center rounded-2xl border border-dashed border-leaf-950/15 text-sm text-leaf-900/50"><T>{"No photo was taken"}</T></div>
        )}
        {out.type === "delivered" &&
          (signature ? (
            <a href={`/api/proofs/${signature.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl border border-leaf-950/10 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element -- private, signed-in image */}
              <img src={`/api/proofs/${signature.id}`} alt="Signature of the person who received the order" className="h-56 w-full object-contain p-3" />
              <span className="flex items-center gap-1.5 border-t border-leaf-950/10 px-3 py-2 text-xs text-leaf-900/70">
                <PenLine className="size-3.5" /> {" "}<T>{"Signed by"}</T>{" "}{out.recipient ?? <T>{"recipient"}</T>}
              </span>
            </a>
          ) : (
            <div className="grid h-56 place-items-center rounded-2xl border border-dashed border-leaf-950/15 text-sm text-leaf-900/50"><T>{"No signature collected"}</T></div>
          ))}
      </div>
      {out.place && (
        <p className={cx("mt-3 flex items-start gap-1.5 text-sm", far ? "text-amber-800" : "text-leaf-900/70")}>
          <MapPin className="mt-0.5 size-4 shrink-0" />
          <span><T>{"Confirmed by GPS"}</T>{" "}{placeText ?? <T>{"at the delivery point"}</T>}.</span>
        </p>
      )}
      {out.note && <p className="mt-2 text-sm text-leaf-900/70"><T>{"Driver's note:"}</T>{" "}{out.note}</p>}
    </section>
  );
}

function Event({
  done,
  icon: Icon,
  title,
  text,
  tone,
}: {
  done: boolean;
  icon: typeof Clock;
  title: React.ReactNode;
  text: React.ReactNode;
  tone?: "red";
}) {
  return (
    <li className="flex gap-3">
      <span
        className={cx(
          "grid size-8 shrink-0 place-items-center rounded-full",
          tone === "red" ? "bg-red-50 text-red-600" : done ? "bg-leaf-50 text-leaf-700" : "bg-[#f1ece2] text-leaf-900/35",
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className={cx("pt-1", !done && "opacity-60")}>
        <p className="text-sm font-semibold">{<Tx>{title}</Tx>}</p>
        <p className="text-sm text-leaf-900/65">{<Tx>{text}</Tx>}</p>
      </div>
    </li>
  );
}
