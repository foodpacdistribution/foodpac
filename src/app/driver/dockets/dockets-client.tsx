"use client";

import { Camera, CheckCircle2, ChevronRight, FileText, Images, Pencil, RotateCcw, Search, Trash2, TriangleAlert, UserCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { deleteDocket, deliverDocketsNow, findForDocket, saveDocket, uploadDocket } from "@/app/actions/dockets";
import { Toast, type ToastMessage } from "@/components/client-ui";
import { Tx, useT } from "@/components/i18n";
import Link from "@/components/link";
import { btn, cx, inputCls, Spinner } from "@/components/ui";
import { prettyDate } from "@/lib/dates";
import type { DocketPick, DocketView } from "@/lib/dockets";
import { aud } from "@/lib/money";
import { resizeImage } from "@/lib/resize-image";

/**
 * The text in a photo, recognised on the phone itself (free; the photo isn't sent anywhere for
 * it). The recogniser loads once (a few MB, then cached by the browser) and is reused. Empty
 * when it can't run: the server then has only the photo.
 */
let recogniser: Promise<{ recognize: (f: File) => Promise<{ data: { text: string } }> }> | null = null;
async function recognise(file: File): Promise<string> {
  try {
    recogniser ??= import("tesseract.js").then((t) => t.createWorker("eng"));
    const w = await recogniser;
    const { data } = await Promise.race([w.recognize(file), new Promise<never>((_, no) => setTimeout(() => no(new Error("slow")), 45_000))]);
    return data.text;
  } catch {
    recogniser = null;
    return "";
  }
}

/** Photos sent at the same time: quick on 4G without choking a weak signal. */
const AT_ONCE = 3;

type Upload = { key: number; file: File; preview: string; error: string | null; busy: boolean };

/**
 * The driver photographs the invoices they've been handed (the camera one by one, or a stack
 * from the album), checks what was read off each, and adds them to today's route in one go.
 */
export function DocketsClient({ today, linked, dockets }: { today: string; linked: boolean; dockets: DocketView[] }) {
  const tr = useT();
  const router = useRouter();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [viewing, setViewing] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [adding, startAdding] = useTransition();
  const queue = useRef<Upload[]>([]);
  const running = useRef(0);
  const nextKey = useRef(1);
  const clearToast = useCallback(() => setToast(null), []);

  const drafts = dockets.filter((d) => !d.added);
  const added = dockets.filter((d) => d.added);
  const ready = (d: DocketView) => !!d.customerName && !!d.address;
  const chosen = drafts.filter((d) => ready(d) && !skipped.has(d.id));

  // Each photo goes up on its own, a few at a time, and the list refreshes as each is read.
  const send = async (up: Upload) => {
    setUploads((all) => all.map((u) => (u.key === up.key ? { ...u, busy: true, error: null } : u)));
    let error: string | null = null;
    try {
      const file = await resizeImage(up.file, 2000, 0.85);
      const form = new FormData();
      form.append("photo", file);
      const text = await recognise(file);
      if (text) form.append("text", text);
      const r = await uploadDocket(form);
      if (!r.ok) error = r.error;
    } catch {
      error = "No signal. Try again when you have reception.";
    }
    if (error) setUploads((all) => all.map((u) => (u.key === up.key ? { ...u, busy: false, error } : u)));
    else {
      URL.revokeObjectURL(up.preview);
      setUploads((all) => all.filter((u) => u.key !== up.key));
      router.refresh();
    }
  };
  const work = async () => {
    for (let up = queue.current.shift(); up; up = queue.current.shift()) await send(up);
    running.current--;
  };
  const pump = () => {
    while (running.current < AT_ONCE && queue.current.length) {
      running.current++;
      void work();
    }
  };

  const addFiles = (files: FileList | null) => {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name)).slice(0, 30);
    if (!list.length) return;
    const ups = list.map((file) => ({ key: nextKey.current++, file, preview: URL.createObjectURL(file), error: null, busy: false }));
    setUploads((all) => [...all, ...ups]);
    queue.current.push(...ups);
    pump();
  };
  const retry = (up: Upload) => {
    queue.current.push(up);
    pump();
  };
  const dropUpload = (up: Upload) => {
    URL.revokeObjectURL(up.preview);
    setUploads((all) => all.filter((u) => u.key !== up.key));
  };

  const addToRoute = () =>
    startAdding(async () => {
      const r = await deliverDocketsNow(chosen.map((d) => d.id));
      if (!r.ok) {
        setToast({ id: Date.now(), text: r.error, tone: "warn" });
        return;
      }
      const failed = (r.data ?? []).filter((x) => !x.ok);
      setErrors(Object.fromEntries(failed.map((x) => [x.id, x.error ?? "Couldn't add this one."])));
      const ok = (r.data ?? []).length - failed.length;
      if (failed.length) {
        setToast({ id: Date.now(), text: ok ? tr("{n} added · {m} need checking", { n: ok, m: failed.length }) : tr("Check the ones marked in red"), tone: "warn" });
        router.refresh();
      } else {
        router.push("/driver");
      }
    });

  if (!linked) {
    return (
      <div className="min-h-dvh">
        <Header />
        <main className="mx-auto -mt-12 max-w-lg px-4">
          <section className="rounded-2xl bg-white p-8 text-center shadow-card">
            <p className="font-semibold text-slate-900">{tr("Your login isn't linked to a driver yet")}</p>
            <p className="mt-1 text-sm text-slate-500">{tr("Ask the office to link it, then photograph your invoices here.")}</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <Header date={today} />
      <main className="mx-auto -mt-12 max-w-lg space-y-4 px-4 pb-4">
        <section className="rounded-2xl bg-white p-4 shadow-card">
          <div className="grid grid-cols-2 gap-2">
            <label className={btn("primary", "lg", "h-auto min-h-14 w-full cursor-pointer gap-2 rounded-xl px-2 py-2 text-sm leading-tight whitespace-normal")}>
              <Camera className="size-5 shrink-0" /> {tr("Take photo")}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <label className={btn("secondary", "lg", "h-auto min-h-14 w-full cursor-pointer gap-2 rounded-xl border-dashed px-2 py-2 text-sm leading-tight whitespace-normal")}>
              <Images className="size-5 shrink-0" /> {tr("Choose several")}
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            {tr("One photo per invoice, flat and in focus. The invoice number and customer are read for you and the address comes from the customer on file: check them, then add them to your route.")}
          </p>
        </section>

        {uploads.length > 0 && (
          <section className="overflow-hidden rounded-2xl bg-white shadow-card">
            <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold text-slate-900">
              {tr("Reading {n}…", { n: uploads.length })}
            </h2>
            <ul className="divide-y divide-line">
              {uploads.map((up) => (
                <li key={up.key} className="flex items-center gap-3 px-4 py-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the photo being sent */}
                  <img src={up.preview} alt="" className="h-14 w-11 shrink-0 rounded-md bg-slate-100 object-cover" />
                  {up.error ? (
                    <>
                      <p className="min-w-0 flex-1 text-sm text-red-600">{tr(up.error)}</p>
                      <button type="button" onClick={() => retry(up)} className={btn("secondary", "icon")} aria-label={tr("Try again")}>
                        <RotateCcw className="size-4" />
                      </button>
                      <button type="button" onClick={() => dropUpload(up)} className={btn("ghost", "icon")} aria-label={tr("Remove photo")}>
                        <X className="size-4" />
                      </button>
                    </>
                  ) : (
                    <p className="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-500">
                      <Spinner className="text-blue-600" /> {up.busy ? tr("Reading the invoice…") : tr("Waiting…")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {drafts.length > 0 && (
          <section className="space-y-2.5">
            <h2 className="px-1 text-sm font-semibold text-slate-900">{tr("Check and add ({n})", { n: drafts.length })}</h2>
            {drafts.map((d) => (
              <DocketCard
                key={d.id}
                d={d}
                error={errors[d.id] ?? null}
                selected={ready(d) && !skipped.has(d.id)}
                onSelect={(on) =>
                  setSkipped((s) => {
                    const next = new Set(s);
                    if (on) next.delete(d.id);
                    else next.add(d.id);
                    return next;
                  })
                }
                onView={() => setViewing(d.id)}
                onChanged={(text) => {
                  setErrors((e) => {
                    const { [d.id]: _, ...rest } = e;
                    return rest;
                  });
                  setToast({ id: Date.now(), text, tone: "ok" });
                  router.refresh();
                }}
              />
            ))}
          </section>
        )}

        {drafts.length > 0 && (
          <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 pt-1">
            <button type="button" disabled={!chosen.length || adding} onClick={addToRoute} className={btn("success", "lg", "w-full rounded-xl shadow-pop")}>
              {adding ? <Spinner /> : <CheckCircle2 className="size-5" />}
              {adding ? tr("Adding to your route…") : chosen.length ? tr("Add {n} to today's deliveries", { n: chosen.length }) : tr("Fill in the customer and address first")}
            </button>
          </div>
        )}

        {added.length > 0 && (
          <section className="overflow-hidden rounded-2xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="text-sm font-semibold text-slate-900">{tr("On today's route ({n})", { n: added.length })}</h2>
              <Link href="/driver" className="flex items-center text-xs font-medium text-blue-600">
                {tr("My deliveries")} <ChevronRight className="size-4" />
              </Link>
            </div>
            <ul className="divide-y divide-line">
              {added.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                  <button type="button" onClick={() => setViewing(d.id)} className="shrink-0" aria-label={tr("View photo")}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- private photo, served with the driver's session */}
                    <img src={`/api/dockets/${d.id}`} alt="" loading="lazy" className="h-12 w-9 rounded bg-slate-100 object-cover" />
                  </button>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium text-slate-900">{d.customerName}</p>
                    <p className="truncate font-mono text-[11px] text-slate-400">{d.orderNumber}</p>
                  </div>
                  <DeliveryBadge d={d} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {!drafts.length && !added.length && !uploads.length && (
          <section className="rounded-2xl bg-white p-8 text-center shadow-card">
            <FileText className="mx-auto size-10 text-slate-300" />
            <p className="mt-3 font-semibold text-slate-900">{tr("No invoices photographed today")}</p>
            <p className="mt-1 text-sm text-slate-500">{tr("Photograph the invoices you've been given to deliver, and they become stops on your route.")}</p>
          </section>
        )}
      </main>

      {viewing && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label={tr("Invoice photo")}>
          <div className="flex justify-end p-3">
            <button type="button" onClick={() => setViewing(null)} className="grid size-10 place-items-center rounded-full bg-white/15 text-white" aria-label={tr("Close")}>
              <X className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-6">
            {/* eslint-disable-next-line @next/next/no-img-element -- private photo, served with the driver's session */}
            <img src={`/api/dockets/${viewing}`} alt={tr("Invoice photo")} className="mx-auto w-full max-w-3xl" />
          </div>
        </div>
      )}
      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}

function Header({ date }: { date?: string }) {
  const tr = useT();
  return (
    <header className="bg-navy-900 px-4 pt-5 pb-16 text-white">
      <div className="mx-auto max-w-lg">
        {date && <p className="text-xs text-slate-400">{<Tx>{prettyDate(date, { weekday: "long", day: "numeric", month: "long" })}</Tx>}</p>}
        <h1 className="mt-0.5 text-xl font-semibold">{tr("Photograph invoices")}</h1>
      </div>
    </header>
  );
}

function DeliveryBadge({ d }: { d: DocketView }) {
  const tr = useT();
  const s = d.delivery?.status;
  if (s === "delivered") return <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">{tr("Delivered")}</span>;
  if (s === "failed") return <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-red-200">{tr("Not delivered")}</span>;
  return <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-blue-200">{tr("To deliver")}</span>;
}

function DocketCard({
  d,
  error,
  selected,
  onSelect,
  onView,
  onChanged,
}: {
  d: DocketView;
  error: string | null;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onView: () => void;
  onChanged: (message: string) => void;
}) {
  const tr = useT();
  const [editing, setEditing] = useState(!d.customerName || !d.address);
  const [busy, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [f, setF] = useState({ orderNumber: d.orderNumber ?? "", customerName: d.customerName ?? "", address: d.address ?? "", phone: d.phone ?? "" });
  const complete = !!d.customerName && !!d.address;
  const items = d.goods.length;

  // What the server has changes after a save: start the form from it again.
  useEffect(() => {
    queueMicrotask(() => setF({ orderNumber: d.orderNumber ?? "", customerName: d.customerName ?? "", address: d.address ?? "", phone: d.phone ?? "" }));
  }, [d.orderNumber, d.customerName, d.address, d.phone]);

  const save = (values: typeof f & { customerId?: string | null } = f) =>
    start(async () => {
      const r = await saveDocket(d.id, values);
      if (!r.ok) return setFormError(r.error);
      setFormError(null);
      setEditing(false);
      onChanged("Saved");
    });
  const remove = () => {
    if (!window.confirm(tr("Delete this photo?"))) return;
    start(async () => {
      const r = await deleteDocket(d.id);
      if (!r.ok) return setFormError(r.error);
      onChanged("Deleted");
    });
  };

  return (
    <article className={cx("overflow-hidden rounded-2xl bg-white shadow-card", error && "ring-2 ring-red-300", busy && "opacity-70")}>
      <div className="flex gap-3 p-3">
        <button type="button" onClick={onView} className="relative shrink-0" aria-label={tr("View photo")}>
          {/* eslint-disable-next-line @next/next/no-img-element -- private photo, served with the driver's session */}
          <img src={`/api/dockets/${d.id}`} alt="" className="h-24 w-[4.5rem] rounded-lg bg-slate-100 object-cover ring-1 ring-line" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] text-slate-400">{d.orderNumber || tr("No invoice number")}</p>
              <p className="truncate font-semibold text-slate-900">{d.customerName || <span className="text-red-600">{tr("Customer missing")}</span>}</p>
            </div>
            <label className={cx("flex shrink-0 items-center", !complete && "invisible")}>
              <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} className="size-5 accent-emerald-600" aria-label={tr("Add this one")} />
            </label>
          </div>
          <p className={cx("mt-0.5 line-clamp-2 text-sm", d.address ? "text-slate-600" : "text-red-600")}>{d.address || tr("Address missing")}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            {d.known && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200">
                <UserCheck className="size-3" /> {tr("Customer on file")}
              </span>
            )}
            {items > 0 && <span>{tr(items === 1 ? "1 item" : "{n} items", { n: items })}</span>}
            {d.totalCents !== null && <span className="font-medium text-slate-700">{aud(d.totalCents)}</span>}
          </div>
        </div>
      </div>
      {(error || (d.readError && !complete)) && (
        <p className="flex gap-2 border-t border-line bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          {tr(error ?? d.readError ?? "")}
        </p>
      )}
      {items > 0 && !editing && (
        <details className="border-t border-line px-3 py-2 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">{tr("Goods")}</summary>
          <ul className="mt-1.5 space-y-1">
            {d.goods.map((g, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-14 shrink-0 text-right font-medium text-slate-900 tabular-nums">
                  {g.qty ?? ""} {g.unit ?? ""}
                </span>
                <span className="min-w-0">{g.name}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {editing ? (
        <div className="space-y-2 border-t border-line bg-slate-50/60 p-3">
          <PickSearch
            onPick={(p) => {
              const values =
                p.kind === "order"
                  ? { orderNumber: p.orderNumber, customerName: p.customerName, address: p.address, phone: p.phone ?? "", customerId: p.customerId }
                  : { orderNumber: f.orderNumber, customerName: p.customerName, address: p.address, phone: p.phone ?? f.phone, customerId: p.customerId };
              setF(values);
              save(values);
            }}
          />
          <p className="pt-1 text-[11px] font-medium text-slate-500">{tr("Or type it in")}</p>
          <input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} placeholder={tr("Customer")} aria-label={tr("Customer")} className={cx(inputCls, "h-11 text-base")} />
          <textarea
            value={f.address}
            onChange={(e) => setF({ ...f, address: e.target.value })}
            placeholder={tr("Delivery address (street, suburb, postcode)")}
            aria-label={tr("Delivery address")}
            rows={2}
            className={cx(inputCls, "h-auto py-2 text-base")}
          />
          <div className="grid grid-cols-2 gap-2">
            <input value={f.orderNumber} onChange={(e) => setF({ ...f, orderNumber: e.target.value })} placeholder={tr("Invoice no.")} aria-label={tr("Invoice no.")} className={cx(inputCls, "h-11 text-base")} />
            <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder={tr("Phone")} aria-label={tr("Phone")} inputMode="tel" className={cx(inputCls, "h-11 text-base")} />
          </div>
          {formError && <p className="text-sm text-red-600">{tr(formError)}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => save()} disabled={busy} className={btn("primary", "md", "h-11 flex-1")}>
              {busy && <Spinner />} {tr("Save")}
            </button>
            {complete && (
              <button type="button" onClick={() => setEditing(false)} className={btn("secondary", "md", "h-11")}>
                {tr("Cancel")}
              </button>
            )}
            <button type="button" onClick={remove} disabled={busy} className={btn("danger", "md", "h-11")} aria-label={tr("Delete")}>
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex border-t border-line">
          <button type="button" onClick={() => setEditing(true)} className="flex h-11 flex-1 items-center justify-center gap-1.5 text-sm font-medium text-slate-600 active:bg-slate-50">
            <Pencil className="size-4" /> {tr("Edit")}
          </button>
          <button type="button" onClick={remove} disabled={busy} className="flex h-11 w-14 items-center justify-center border-l border-line text-red-600 active:bg-red-50" aria-label={tr("Delete")}>
            <Trash2 className="size-4" />
          </button>
        </div>
      )}
    </article>
  );
}

/**
 * Search as you type: today's deliveries the office already has (pick one and it's that exact
 * delivery) and customers on file (their address and phone come with them).
 */
function PickSearch({ onPick }: { onPick: (p: DocketPick) => void }) {
  const tr = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<DocketPick[] | null>(null);
  const [looking, setLooking] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      queueMicrotask(() => setHits(null));
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      setLooking(true);
      try {
        const r = await findForDocket(term);
        if (live) setHits(r);
      } catch {
        if (live) setHits([]);
      } finally {
        if (live) setLooking(false);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr("Search customer, code or invoice no.")}
          aria-label={tr("Search customer, code or invoice no.")}
          enterKeyHint="search"
          className={cx(inputCls, "h-11 pl-9 text-base")}
        />
        {looking && <Spinner className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400" />}
      </div>
      {hits && (
        <ul className="mt-1.5 max-h-72 divide-y divide-line overflow-y-auto rounded-lg bg-white ring-1 ring-line">
          {hits.length === 0 && <li className="px-3 py-2.5 text-sm text-slate-500">{tr("Nothing found. Type it in below.")}</li>}
          {hits.map((h) => (
            <li key={h.kind === "order" ? `o:${h.orderNumber}` : `c:${h.customerId}`}>
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setHits(null);
                  onPick(h);
                }}
                className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left active:bg-blue-50"
              >
                {h.kind === "order" ? <FileText className="mt-0.5 size-4 shrink-0 text-blue-600" /> : <UserCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-medium text-slate-900">
                    {h.kind === "order" && <span className="mr-1.5 font-mono text-xs text-blue-700">{h.orderNumber}</span>}
                    {h.customerName}
                  </span>
                  <span className="block truncate text-xs text-slate-500">{h.address}</span>
                  {h.kind === "order" && (
                    <span className="block text-[11px] text-slate-400">{h.driver ? tr("Today's delivery · {driver}", { driver: h.driver }) : tr("Today's delivery · not on a route yet")}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
