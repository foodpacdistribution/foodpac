"use client";

import { ArrowLeft, CheckCircle2, ImageUp, XCircle } from "lucide-react";
import Link from "@/components/link";
import { useRef, useState } from "react";
import { uploadProductPhoto } from "@/app/actions/products";
import { Badge, btn, Card, CardHeader, cx, PageHeader, Spinner } from "@/components/ui";
import { useT } from "@/components/i18n";
import { resizeImage } from "@/lib/resize-image";

type Item = { file: string; state: "waiting" | "uploading" | "done" | "failed"; product?: string; error?: string };

/** Many photos at once, each matched to a product by its file name (product code or name). */
export function ProductPhotosClient({ total, withPhoto }: { total: number; withPhoto: number }) {
  const tr = useT();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const set = (i: number, patch: Partial<Item>) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  async function upload(files: File[]) {
    const images = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name));
    if (!images.length || busy) return;
    const start = items.length;
    setItems((list) => [...list, ...images.map((f) => ({ file: f.name, state: "waiting" as const }))]);
    setBusy(true);
    // One at a time: each is shrunk on this computer first, so even hundreds go up quickly.
    for (let k = 0; k < images.length; k++) {
      const i = start + k;
      set(i, { state: "uploading" });
      try {
        const small = await resizeImage(images[k], 1600, undefined, { trimDarkBars: true });
        const form = new FormData();
        form.set("fileName", images[k].name);
        form.set("photo", small);
        const r = await uploadProductPhoto(form);
        set(i, r.ok ? { state: "done", product: `${r.data!.sku} · ${r.data!.name}` } : { state: "failed", error: r.error });
      } catch {
        set(i, { state: "failed", error: tr("Couldn't read this image.") });
      }
    }
    setBusy(false);
  }

  const done = items.filter((i) => i.state === "done").length;
  const failed = items.filter((i) => i.state === "failed");

  return (
    <>
      <Link href="/admin/products" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> {tr("Products & Stock")}
      </Link>
      <PageHeader
        title={tr("Upload product photos")}
        subtitle={tr("Name each photo after its product: the product code (e.g. RB-BOWLPA16.jpg, the old EMERGE code works too) or the exact product name. A photo replaces the product's current one.")}
      />
      <p className="mb-4 text-sm text-slate-600">
        {tr("{n} of {total} products have a photo.", { n: withPhoto + done, total })}
      </p>

      <Card>
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void upload([...e.dataTransfer.files]);
          }}
          className={cx(
            "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
            over ? "border-blue-400 bg-blue-50/60" : "border-line hover:border-slate-300 hover:bg-slate-50/60",
          )}
        >
          <span className="grid size-12 place-items-center rounded-full bg-blue-50 text-blue-600">
            {busy ? <Spinner className="size-5" /> : <ImageUp className="size-6" />}
          </span>
          <span className="text-sm font-semibold text-slate-900">{tr("Drop photos here, or click to choose")}</span>
          <span className="text-xs text-slate-500">{tr("JPEG, PNG or WebP. You can choose hundreds at once.")}</span>
        </button>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </Card>

      {items.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            title={tr("{done} of {n} matched", { done, n: items.length })}
            subtitle={failed.length ? tr("Rename the ones that didn't match to the product code, then drop them again.") : undefined}
          />
          <ul className="max-h-[60dvh] divide-y divide-line overflow-y-auto">
            {items.map((it, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                {it.state === "done" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                ) : it.state === "failed" ? (
                  <XCircle className="size-4 shrink-0 text-red-500" />
                ) : (
                  <Spinner className={cx("size-4 text-slate-400", it.state === "waiting" && "opacity-40")} />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700">{it.file}</span>
                {it.product && <span className="hidden min-w-0 truncate text-xs text-slate-500 sm:block sm:max-w-[50%]">{it.product}</span>}
                {it.error && <Badge tone="red">{it.error}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {!busy && items.length > 0 && failed.length === 0 && (
        <div className="mt-4 flex justify-end">
          <Link href="/admin/products" className={btn("primary")}>
            {tr("View products")}
          </Link>
        </div>
      )}
    </>
  );
}
