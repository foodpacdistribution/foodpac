"use client";

import { ArrowLeft, FileUp } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { runStocktake } from "@/app/actions/products";
import { FormError, Toast, type ToastMessage } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn, Card, cx, inputCls, PageHeader } from "@/components/ui";
import { readSpreadsheet } from "@/lib/spreadsheet";
import { formatCartons } from "@/lib/stock-units";
import type { StocktakeLine, StocktakeRow } from "@/lib/stocktake";

const SKU_HEADER = /^(sku|code|product code|item code|编码|产品编码|货号)$/i;
const COUNT_HEADER = /^(count|counted|stock|qty|quantity|on hand|数量|盘点|库存|实盘)$/i;

/** "SKU, count" per line (comma or tab between), as typed or pasted from a spreadsheet. */
function linesFromText(text: string): StocktakeLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [sku, ...rest] = l.split(/\t|,/);
      return { sku: sku.trim(), count: rest.join(" ").trim() };
    })
    .filter((l) => !SKU_HEADER.test(l.sku));
}

/**
 * Stocktake: what was counted on the shelf per product, in cartons and loose packs ("20ctn+7pk").
 * Shows what will change first; goods already sold but not yet delivered are taken off the count.
 */
export function StocktakeClient() {
  const tr = useT();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<StocktakeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);

  const lines = linesFromText(text);
  const run = (apply: boolean) =>
    start(async () => {
      setError(null);
      const r = await runStocktake(lines, apply);
      if (!r.ok) return setError(r.error);
      setRows(r.data!.rows);
      if (apply) {
        setToast({ id: Date.now(), text: r.message ?? tr("Stock updated"), tone: "ok" });
        setText("");
        setRows(null);
      }
    });

  const load = async (f: File) => {
    try {
      const sheet = await readSpreadsheet(f);
      const s = sheet.headers.findIndex((h) => SKU_HEADER.test(h.trim()));
      const c = sheet.headers.findIndex((h) => COUNT_HEADER.test(h.trim()));
      if (s < 0 || c < 0) return setError(tr("The file needs a SKU column and a Count column."));
      setText(sheet.rows.map((r) => `${r[s] ?? ""}\t${r[c] ?? ""}`).join("\n"));
      setRows(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const ok = rows?.filter((r) => !r.error) ?? [];
  const bad = rows?.filter((r) => r.error) ?? [];
  const changes = ok.filter((r) => r.newStock !== r.oldStock);

  return (
    <>
      <Link href="/admin/inventory" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> {tr("Inventory")}
      </Link>
      <PageHeader
        title={tr("Stocktake")}
        subtitle={tr("Enter what you counted on the shelf: one product per line, SKU then count, e.g. RB-GA82ER, 20ctn+7pk. Cartons are worked out from the product's pack size. Goods already sold but not yet delivered are still on the shelf, so they're taken off the count.")}
      />
      <Card className="p-4">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setRows(null);
          }}
          rows={10}
          placeholder={"RB-GA82ER, 20ctn+7pk\nRB-CLEBL05P, 17pk\nPACBCB-T-TM, 6ctn"}
          className={cx(inputCls, "h-auto py-2 font-mono text-sm")}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className={btn("primary")} disabled={pending || !lines.length} onClick={() => run(false)}>
            {tr("Check {n} lines", { n: lines.length })}
          </button>
          <button className={btn("secondary")} onClick={() => file.current?.click()}>
            <FileUp className="size-4" /> {tr("Open a file")}
          </button>
          <input ref={file} type="file" accept=".csv,.xlsx,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
          <span className="text-xs text-slate-500">{tr("CSV or Excel with a SKU column and a Count column")}</span>
        </div>
        <FormError message={error} />
      </Card>

      {rows && (
        <Card className="mt-4 overflow-x-auto">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">
              {tr("{n} products change", { n: changes.length })}
              {bad.length > 0 && <span className="ml-2 font-normal text-red-600">{tr("{n} lines can't be used", { n: bad.length })}</span>}
            </p>
            <button className={btn("primary", "sm", "ml-auto")} disabled={pending || !changes.length} onClick={() => run(true)}>
              {tr("Update stock for {n} products", { n: changes.length })}
            </button>
          </div>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">{tr("Product")}</th>
                <th className="px-2 py-2 font-medium">{tr("Counted")}</th>
                <th className="px-2 py-2 text-right font-medium">{tr("On the shelf")}</th>
                <th className="px-2 py-2 text-right font-medium">{tr("Reserved for orders")}</th>
                <th className="px-2 py-2 text-right font-medium">{tr("Stock now")}</th>
                <th className="px-4 py-2 text-right font-medium">{tr("New stock")}</th>
              </tr>
            </thead>
            <tbody>
              {[...bad, ...ok].map((r, i) => (
                <tr key={i} className={cx("border-b border-line last:border-0", r.error && "bg-red-50/60")}>
                  <td className="px-4 py-2">
                    <p className="font-medium text-slate-900">{r.product?.name ?? r.sku}</p>
                    <p className="text-xs text-slate-500">
                      {r.sku}
                      {r.product && ` · ${tr(r.product.unit)}${r.product.perCarton ? ` · ${r.product.perCarton}/ctn` : ""}`}
                    </p>
                    {r.error && <p className="text-xs font-medium text-red-600">{tr(r.error)}</p>}
                    {!!r.dropped && <p className="text-xs text-amber-700">{tr("Sold by the carton: {n} loose packs not counted", { n: r.dropped })}</p>}
                    {r.short && <p className="text-xs text-amber-700">{tr("Less than customers have already ordered")}</p>}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">{r.count}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {r.counted ?? "—"}
                    {r.counted !== undefined && r.product?.perCarton && <span className="block text-[11px] text-slate-500">{formatCartons(r.counted, r.product.perCarton)}</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">{r.reserved || "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-600">{r.oldStock ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">
                    {r.newStock ?? "—"}
                    {r.newStock !== undefined && r.oldStock !== undefined && r.newStock !== r.oldStock && (
                      <Badge tone={r.newStock > r.oldStock ? "green" : "amber"} className="ml-1.5">
                        {r.newStock > r.oldStock ? "+" : ""}
                        {r.newStock - r.oldStock}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}
