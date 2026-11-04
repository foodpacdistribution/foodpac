"use client";

import { ArrowDown, ArrowUp, ExternalLink, Eye, EyeOff, GalleryHorizontal, Pencil, Plus, Smartphone, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState, useTransition } from "react";
import { deletePoster, movePoster, savePoster, setBuiltInPosters, setPosterActive } from "@/app/actions/posters";
import { FormError, Modal, Toast, type ToastMessage } from "@/components/client-ui";
import { Badge, btn, Card, cx, EmptyState, Field, inputCls, PageHeader, Spinner } from "@/components/ui";
import { useT } from "@/components/i18n";
import type { ActionResult } from "@/lib/action";
import { posterImageUrl } from "@/lib/poster-image";
import { ImageInput } from "@/components/image-input";

type Poster = {
  id: string;
  name: string;
  eyebrow: string;
  headline: string;
  text: string;
  buttonLabel: string;
  href: string;
  focus: "left" | "center" | "right";
  hasMobileImage: boolean;
  active: boolean;
  startsOn: string | null;
  endsOn: string | null;
  updatedAt: Date;
};

const STATUS = {
  live: { label: "Showing", tone: "green" },
  scheduled: { label: "Scheduled", tone: "blue" },
  ended: { label: "Ended", tone: "slate" },
  hidden: { label: "Hidden", tone: "amber" },
} as const;

function statusOf(p: Poster, today: string): keyof typeof STATUS {
  if (!p.active) return "hidden";
  if (p.startsOn && p.startsOn > today) return "scheduled";
  if (p.endsOn && p.endsOn < today) return "ended";
  return "live";
}

const FOCUS = { left: "object-left", center: "object-center", right: "object-right" } as const;

export function PostersClient({ posters, builtIn, today }: { posters: Poster[]; builtIn: boolean; today: string }) {
  const tr = useT();
  const [editing, setEditing] = useState<Poster | "new" | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [busy, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok || r.message) setToast({ id: Date.now(), text: r.ok ? r.message! : r.error, tone: r.ok ? "ok" : "warn" });
    });
  const showing = posters.filter((p) => statusOf(p, today) === "live").length;

  return (
    <>
      <PageHeader
        title={tr("Home Page Posters")}
        subtitle={tr("The carousel at the top of the home page. Posters show in this order, before the built-in ones.")}
        actions={
          <>
            <a href="/" target="_blank" rel="noreferrer" className={btn("secondary")}>
              <ExternalLink className="size-4" /> {tr("View home page")}
            </a>
            <button type="button" onClick={() => setEditing("new")} className={btn("primary")}>
              <Plus className="size-4" /> {tr("Add poster")}
            </button>
          </>
        }
      />

      <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{tr("Built-in posters")}</p>
          <p className="text-xs text-slate-500">
            {tr("The four posters that come with the website (ordering online, takeaway packaging, delivery, one supplier). They're always shown when no uploaded poster is.")}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={builtIn}
            disabled={busy}
            onChange={(e) => run(() => setBuiltInPosters(e.target.checked))}
          />
          <span className="relative h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-emerald-600 peer-focus-visible:outline-2 peer-focus-visible:outline-blue-500 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
          {builtIn ? tr("Showing after yours") : tr("Hidden")}
        </label>
      </Card>

      {posters.length === 0 ? (
        <Card>
          <EmptyState icon={GalleryHorizontal} title={tr("No posters uploaded yet")}>
            {tr("Upload a promotion, a new range or a seasonal message. It shows at the top of the home page straight away.")}
            <div className="mt-4">
              <button type="button" onClick={() => setEditing("new")} className={btn("primary")}>
                <Plus className="size-4" /> {tr("Add poster")}
              </button>
            </div>
          </EmptyState>
        </Card>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-500">{tr("{n} showing on the home page now", { n: showing })}</p>
          <div className="space-y-3">
            {posters.map((p, i) => {
              const st = STATUS[statusOf(p, today)];
              return (
                <Card key={p.id} className={cx("flex flex-col gap-4 p-3 sm:flex-row sm:items-center", !p.active && "opacity-70")}>
                  <button type="button" onClick={() => setEditing(p)} className="relative aspect-[3/1] w-full shrink-0 overflow-hidden rounded-lg bg-slate-100 sm:w-60">
                    {/* eslint-disable-next-line @next/next/no-img-element -- back-office thumbnail */}
                    <img src={posterImageUrl(p)} alt="" loading="lazy" className={cx("size-full object-cover", FOCUS[p.focus])} />
                    {p.headline && (
                      <span className="absolute inset-0 flex items-center bg-gradient-to-r from-black/60 to-transparent px-3 text-left text-[11px] leading-tight font-semibold text-white">
                        <span className="line-clamp-2 max-w-[60%]">{p.headline}</span>
                      </span>
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      <span className="tabular-nums text-slate-400">{String(i + 1).padStart(2, "0")}</span>
                      {p.name}
                      <Badge tone={st.tone}>{tr(st.label)}</Badge>
                      {p.hasMobileImage && (
                        <Badge>
                          <Smartphone className="size-3" /> {tr("Phone picture")}
                        </Badge>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {p.startsOn || p.endsOn
                        ? `${p.startsOn ? `${tr("From")} ${p.startsOn}` : ""}${p.startsOn && p.endsOn ? " · " : ""}${p.endsOn ? `${tr("Until")} ${p.endsOn}` : ""}`
                        : tr("No end date")}
                      {p.href && <> · {p.href}</>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" disabled={busy || i === 0} onClick={() => run(() => movePoster(p.id, -1))} className={btn("ghost", "icon")} aria-label={tr("Move up")} title={tr("Move up")}>
                      <ArrowUp className="size-4" />
                    </button>
                    <button type="button" disabled={busy || i === posters.length - 1} onClick={() => run(() => movePoster(p.id, 1))} className={btn("ghost", "icon")} aria-label={tr("Move down")} title={tr("Move down")}>
                      <ArrowDown className="size-4" />
                    </button>
                    <button type="button" disabled={busy} onClick={() => run(() => setPosterActive(p.id, !p.active))} className={btn("ghost", "icon")} aria-label={tr(p.active ? "Hide" : "Show")} title={tr(p.active ? "Hide" : "Show")}>
                      {p.active ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                    <button type="button" onClick={() => setEditing(p)} className={btn("ghost", "icon")} aria-label={tr("Edit")} title={tr("Edit")}>
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => confirm(tr("Delete the poster “{name}”?", { name: p.name })) && run(() => deletePoster(p.id))}
                      className={btn("ghost", "icon", "text-red-600 hover:bg-red-50")}
                      aria-label={tr("Delete")}
                      title={tr("Delete")}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? tr("Add poster") : tr("Edit poster")} wide>
        {editing !== null && <PosterForm key={editing === "new" ? "new" : editing.id} poster={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}

/** A file input that shrinks the chosen picture in the browser and shows it. */
function PosterForm({ poster: p, onDone }: { poster: Poster | null; onDone: () => void }) {
  const tr = useT();
  const [state, action, saving] = useActionState(savePoster, undefined);
  const [, startSave] = useTransition();
  const [desktop, setDesktop] = useState<string | null>(p ? posterImageUrl(p) : null);
  const [mobile, setMobile] = useState<string | null>(p?.hasMobileImage ? posterImageUrl(p, "mobile") : null);
  const [draft, setDraft] = useState({ eyebrow: p?.eyebrow ?? "", headline: p?.headline ?? "", text: p?.text ?? "", buttonLabel: p?.buttonLabel ?? "", focus: p?.focus ?? "center" });
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form
      // Submitted by hand rather than as a form action, so a failed save keeps what was typed and chosen.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startSave(() => action(fd));
      }}
      onChange={(e) => {
        const f = new FormData(e.currentTarget);
        const g = (k: string) => String(f.get(k) ?? "");
        setDraft({ eyebrow: g("eyebrow"), headline: g("headline"), text: g("text"), buttonLabel: g("buttonLabel"), focus: (g("focus") || "center") as Poster["focus"] });
      }}
      className="grid gap-4 sm:grid-cols-2"
    >
      {p && <input type="hidden" name="id" value={p.id} />}

      {/* Preview: roughly how it sits in the carousel on a computer. */}
      <div className="sm:col-span-2">
        <p className="mb-1 text-xs font-medium text-slate-600">{tr("Preview")}</p>
        <div className="relative aspect-[3/1] overflow-hidden rounded-xl bg-slate-800">
          {desktop ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
            <img src={desktop} alt="" className={cx("absolute inset-0 size-full object-cover", FOCUS[draft.focus])} />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-xs text-slate-400">{tr("Choose a picture to see the preview")}</span>
          )}
          {draft.headline && (
            <div className="absolute inset-0 flex flex-col justify-center bg-gradient-to-r from-black/70 via-black/35 to-transparent px-[5%] text-white">
              {draft.eyebrow && <p className="text-[9px] font-semibold tracking-[0.18em] text-orange-400 uppercase sm:text-[10px]">{draft.eyebrow}</p>}
              <p className="mt-1 max-w-[55%] text-base leading-tight font-semibold sm:text-2xl">{draft.headline}</p>
              {draft.text && <p className="mt-1 line-clamp-2 max-w-[50%] text-[10px] text-white/75 sm:text-xs">{draft.text}</p>}
              {draft.buttonLabel && <span className="mt-2 w-fit rounded-full bg-orange-600 px-3 py-1 text-[10px] font-semibold sm:text-xs">{draft.buttonLabel}</span>}
            </div>
          )}
        </div>
      </div>

      <Field label={tr("Poster picture")} hint={tr("Wide, about 2400 × 800 px (3:1). Keep words away from the edges and the bottom strip (the carousel tabs sit there).")}>
        <ImageInput name="image" maxSide={2400} required={!p} onPreview={(u) => setDesktop(u ?? (p ? posterImageUrl(p) : null))} />
      </Field>
      <Field label={tr("Phone picture (optional)")} hint={tr("Upright, about 1080 × 1350 px (4:5). Recommended when the words are in the picture: without one, phones show the wide picture small.")}>
        <div className="flex items-center gap-3">
          <ImageInput name="mobileImage" maxSide={1600} onPreview={(u) => setMobile(u ?? (p?.hasMobileImage ? posterImageUrl(p, "mobile") : null))} />
          {mobile && (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
            <img src={mobile} alt="" className="h-12 w-10 rounded object-cover ring-1 ring-line" />
          )}
        </div>
        {p?.hasMobileImage && (
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" name="removeMobileImage" /> {tr("Remove phone picture")}
          </label>
        )}
      </Field>

      <Field label={tr("Name")} hint={tr("Shown on the tab under the carousel and read out to screen readers.")}>
        <input name="name" required maxLength={80} defaultValue={p?.name} placeholder={tr("e.g. Winter cups sale")} className={inputCls} />
      </Field>
      <Field label={tr("Link (optional)")} hint={tr("A page on this site, e.g. /categories/cups-and-lids, or a full https:// address.")}>
        <input name="href" maxLength={500} defaultValue={p?.href} placeholder="/products" className={inputCls} />
      </Field>

      <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-line sm:col-span-2">
        <p className="text-xs font-semibold text-slate-700">{tr("Words on the poster (optional)")}</p>
        <p className="mb-3 text-[11px] text-slate-500">
          {tr("Leave the headline empty when the words are already in the picture: the whole poster then opens the link.")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("Small heading")}>
            <input name="eyebrow" maxLength={80} defaultValue={p?.eyebrow} placeholder={tr("e.g. This month only")} className={inputCls} />
          </Field>
          <Field label={tr("Button text")} hint={tr("Needs a link.")}>
            <input name="buttonLabel" maxLength={40} defaultValue={p?.buttonLabel} placeholder={tr("e.g. Shop now")} className={inputCls} />
          </Field>
          <Field label={tr("Headline")} className="sm:col-span-2">
            <input name="headline" maxLength={140} defaultValue={p?.headline} className={inputCls} />
          </Field>
          <Field label={tr("Text")} className="sm:col-span-2">
            <textarea name="text" rows={2} maxLength={400} defaultValue={p?.text} className={cx(inputCls, "h-auto py-2")} />
          </Field>
        </div>
      </div>

      <Field label={tr("Keep in view when cropped")}>
        <select name="focus" defaultValue={p?.focus ?? "center"} className={inputCls}>
          <option value="left">{tr("Left side")}</option>
          <option value="center">{tr("Middle")}</option>
          <option value="right">{tr("Right side")}</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={tr("Show from")}>
          <input name="startsOn" type="date" defaultValue={p?.startsOn ?? ""} className={inputCls} />
        </Field>
        <Field label={tr("Until")}>
          <input name="endsOn" type="date" defaultValue={p?.endsOn ?? ""} className={inputCls} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> {tr("Show on the home page")}
      </label>

      <div className="sm:col-span-2">
        <FormError message={state && !state.ok ? state.error : null} />
      </div>
      <button type="submit" disabled={saving} className={btn("primary", "md", "sm:col-span-2")}>
        {saving ? (
          <>
            <Spinner className="size-3.5" /> {tr("Uploading…")}
          </>
        ) : p ? (
          tr("Save poster")
        ) : (
          tr("Add poster")
        )}
      </button>
    </form>
  );
}
