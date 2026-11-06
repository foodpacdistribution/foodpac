"use client";

import { Camera, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { requestReturn } from "@/app/actions/purchasing";
import { FormError, KeptForm, SubmitButton, useKeptForm } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import { btn, Card, CardHeader, cx, Field, inputCls, Spinner } from "@/components/ui";
import type { ActionResult } from "@/lib/action";
import { qtyText, unitMoney } from "@/lib/purchasing/labels";
import { resizeImage } from "@/lib/resize-image";

type Line = { id: string; sku: string; name: string; unit: string; received: number; already: number; returnable: number; unitCost: number };

export const RETURN_REASONS = ["Damaged in transit", "Faulty / defective", "Wrong product sent", "Short dated / expired", "Over-supplied", "No longer needed"];

export function ReturnRequestForm({ goodsReceiptId, today, lines }: { goodsReceiptId: string; today: string; lines: Line[] }) {
  const tr = useT();
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [working, setWorking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [state, form] = useKeptForm(async (prev: ActionResult<{ id: string }> | undefined, fd: FormData) => {
    fd.delete("photos");
    for (const p of photos) fd.append("photos", p.file);
    fd.set("lines", JSON.stringify(lines.map((l) => ({ goodsReceiptItemId: l.id, qty: qty[l.id] ?? "0", reason: why[l.id] ?? "" }))));
    const r = await requestReturn(prev, fd);
    if (r.ok && r.data) router.push(`/admin/purchase-returns/${r.data.id}`);
    return r;
  });

  return (
    <KeptForm form={form} className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <input type="hidden" name="goodsReceiptId" value={goodsReceiptId} />
      <Card className="overflow-x-auto">
        <CardHeader title={tr("What's going back")} subtitle={tr("Asking doesn't change stock. Stock only goes down when the supplier has accepted and the goods actually leave.")} />
        <table className="w-full min-w-[620px] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">{tr("Product")}</th>
              <th className="px-2 py-2 text-right font-medium">{tr("Received")}</th>
              <th className="px-2 py-2 text-right font-medium">{tr("Already returned")}</th>
              <th className="px-2 py-2 font-medium">{tr("Return now")}</th>
              <th className="px-4 py-2 font-medium">{tr("Problem with this product")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const n = Number(qty[l.id] ?? 0);
              const over = n > l.returnable;
              return (
                <tr key={l.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <p className="font-medium">{l.name}</p>
                    <p className="text-xs text-slate-500">{l.sku} · {unitMoney(l.unitCost)} / {l.unit}</p>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{qtyText(l.received)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-500">{qtyText(l.already)}</td>
                  <td className="px-2 py-2">
                    <input
                      value={qty[l.id] ?? ""}
                      placeholder="0"
                      inputMode="numeric"
                      disabled={l.returnable <= 0}
                      aria-label={tr("Return now")}
                      onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                      className={cx(inputCls, "w-20", over && "border-red-400 bg-red-50")}
                    />
                    {over && <p className="mt-0.5 text-[11px] text-red-600">{tr("Max {n}", { n: l.returnable })}</p>}
                  </td>
                  <td className="px-4 py-2">
                    <input value={why[l.id] ?? ""} disabled={!n} placeholder={tr("e.g. lids don't fit")} onChange={(e) => setWhy({ ...why, [l.id]: e.target.value })} className={inputCls} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card className="h-fit">
        <CardHeader title={tr("Return request")} />
        <div className="space-y-3 p-4">
          <Field label="Reason">
            <select name="returnReason" required defaultValue="" className={inputCls}>
              <option value="" disabled>{tr("Choose…")}</option>
              {RETURN_REASONS.map((r) => (
                <option key={r} value={r}>{tr(r)}</option>
              ))}
              <option value="Other">{tr("Other")}</option>
            </select>
          </Field>
          <Field label="Date">
            <input type="date" name="returnDate" defaultValue={today} required className={inputCls} />
          </Field>
          <Field label="Details for the supplier">
            <textarea name="notes" rows={3} className={`${inputCls} h-auto py-2`} placeholder={tr("What's wrong, batch numbers, how it was found")} />
          </Field>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">{tr("Photos")}</p>
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <span key={p.url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="size-16 rounded-lg border border-line object-cover" />
                  <button type="button" aria-label={tr("Remove")} className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-slate-800 text-white" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {photos.length < 8 && (
                <label className={btn("secondary", "md", "size-16 cursor-pointer flex-col gap-0.5 p-0 text-[11px]")}>
                  {working ? <Spinner className="size-4" /> : <Camera className="size-4" />}
                  {tr("Add")}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="sr-only"
                    onChange={async (e) => {
                      const files = [...(e.target.files ?? [])].slice(0, 8 - photos.length);
                      setWorking(true);
                      // Shrunk on the phone so a handful of photos fits in one upload.
                      const small = await Promise.all(files.map((f) => resizeImage(f, 1600)));
                      setPhotos((ps) => [...ps, ...small.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
                      setWorking(false);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          </div>
          <FormError message={state && !state.ok ? state.error : null} />
          <SubmitButton disabled={working} className="w-full">{tr("Create return request")}</SubmitButton>
          <p className="text-xs text-slate-500">{tr("Next: send it to the supplier and record whether they accept.")}</p>
        </div>
      </Card>
    </KeptForm>
  );
}
