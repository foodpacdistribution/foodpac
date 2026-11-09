"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import Link from "@/components/link";
import { useMemo, useState, useTransition } from "react";
import { importProducts, type ProductImportResult } from "@/app/actions/products";
import { FormError } from "@/components/client-ui";
import { Badge, btn, Card, CardHeader, cx, inputCls, PageHeader, Spinner } from "@/components/ui";
import { aud } from "@/lib/money";
import {
  checkProductRow,
  duplicateSkus,
  guessProductMapping,
  MAX_IMPORT_ROWS,
  PRODUCT_FIELDS,
  type ProductField,
  type ProductImportRow,
  type ProductMapping,
  TEMPLATE_HEADERS,
  toCsv,
} from "@/lib/product-import";
import { Tx, useT } from "@/components/i18n";
import { downloadCsv as download, readSpreadsheet, type Sheet } from "@/lib/spreadsheet";

const TEMPLATE = toCsv([
  TEMPLATE_HEADERS,
  ["FP-1001", "Kraft takeaway box No.8", "62.00", "Takeaway containers", "200 pcs / carton", "carton", 1, 80, "9300000000017", "Grease-resistant kraft box", "yes", "yes", "yes"],
  ["FP-6003", "Jasmine rice 10 kg", "27.50", "Pantry & dry goods", "10 kg bag", "bag", 2, 60, "", "", "no", "no", "yes"],
]);

export function ProductImportClient({ existingSkus }: { existingSkus: string[] }) {
  const tr = useT();
  const existing = useMemo(() => new Set(existingSkus), [existingSkus]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<ProductMapping>({});
  const [incGst, setIncGst] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProductImportResult | null>(null);
  const [pending, start] = useTransition();

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    try {
      const s = await readSpreadsheet(file);
      if (!s.rows.length) return setError("That file has no product rows under the header row.");
      if (s.rows.length > MAX_IMPORT_ROWS) return setError(`That file has ${s.rows.length} rows. Import at most ${MAX_IMPORT_ROWS} at a time.`);
      setSheet(s);
      setMapping(guessProductMapping(s.headers));
    } catch (e) {
      setError(/^Upload a/.test((e as Error).message) ? (e as Error).message : `Couldn't read that file: ${(e as Error).message}`);
    }
  }

  const rows: ProductImportRow[] = useMemo(() => {
    if (!sheet) return [];
    return sheet.rows.map((r) => {
      const row: ProductImportRow = {};
      for (const [k, idx] of Object.entries(mapping)) if (idx !== undefined && idx >= 0) row[k as ProductField] = r[idx] ?? "";
      return row;
    });
  }, [sheet, mapping]);

  const gstColumnHeader = sheet && mapping.gst !== undefined ? sheet.headers[mapping.gst] : undefined;
  const checks = useMemo(() => {
    const dupes = duplicateSkus(rows);
    return rows.map((r, i) => {
      if (dupes.has(i)) return { ok: false as const, error: `Same SKU as row ${dupes.get(i)! + 2}` };
      const c = checkProductRow(r, { pricesIncGst: incGst, gstColumnHeader });
      if (!c.ok || existing.has(c.value.sku)) return c;
      // New products need a name and a price; updates can change any subset.
      const missing = [!c.value.name && "name", c.value.priceCents === undefined && "price"].filter(Boolean);
      return missing.length ? { ok: false as const, error: `New product needs a ${missing.join(" and ")}` } : c;
    });
  }, [rows, incGst, gstColumnHeader, existing]);
  const newCount = checks.filter((c) => c.ok && !existing.has(c.value.sku)).length;
  const bad = checks.filter((c) => !c.ok).length;
  const missingRequired = mapping.sku === undefined || mapping.sku < 0;

  function submit() {
    start(async () => {
      const r = await importProducts(rows, { pricesIncGst: incGst, gstColumnHeader });
      if (!r.ok) return setError(r.error);
      setResult(r.data!);
    });
  }

  return (
    <>
      <Link href="/admin/products" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> {" "}{tr("Products & Stock")}</Link>
      <PageHeader
        title={tr("Import products")}
        subtitle={tr("Upload a spreadsheet of your range. Products are matched by SKU: new SKUs are added, existing ones updated. Empty cells leave the current value as it is.")}
        actions={
          <button className={btn("secondary")} onClick={() => download("foodpac-products-template.csv", TEMPLATE)}>
            <Download className="size-4" /> {" "}{tr("Download template")}</button>
        }
      />

      {result && result.errors.length === 0 ? (
        <Card className="p-8 text-center">
          <CheckCircle2 className="mx-auto size-12 animate-check text-emerald-600" />
          <p className="mt-3 text-lg font-semibold text-slate-900">
            {result.created} {" "}{tr("added ·")}{" "}{result.updated} {" "}{tr("updated")}</p>
          <p className="mt-1 text-sm text-slate-500">{tr("Your products are live in the online shop.")}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Link href="/admin/products" className={btn("primary")}>
              {tr("View products")}</Link>
            <button className={btn("secondary")} onClick={() => (setSheet(null), setResult(null))}>
              {tr("Import another file")}</button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-5">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-6 py-8 text-center hover:border-blue-400 hover:bg-blue-50/40">
              {sheet ? <FileSpreadsheet className="size-8 text-blue-600" /> : <Upload className="size-8 text-slate-400" />}
              <span className="text-sm font-medium text-slate-900">{sheet ? `${sheet.name} · ${sheet.rows.length} rows` : tr("Choose an Excel (.xlsx) or CSV file")}</span>
              <span className="text-xs text-slate-500">{tr("First row = column names. Up to")}{" "}{MAX_IMPORT_ROWS} {" "}{tr("products per file.")}</span>
              <input type="file" accept=".xlsx,.csv,.txt,.tsv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            <div className="mt-3">
              <FormError message={error} />
            </div>
          </Card>

          {sheet && (
            <>
              <Card>
                <CardHeader title={tr("Match columns")} subtitle={tr("Matched automatically from your column names. Change any that are wrong; leave unused ones on “—”.")} />
                <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  {PRODUCT_FIELDS.map((f) => (
                    <label key={f.key} className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-600">{<Tx>{f.label}</Tx>}</span>
                      <select
                        value={mapping[f.key] ?? -1}
                        onChange={(e) => setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) < 0 ? undefined : Number(e.target.value) }))}
                        className={cx(inputCls, mapping[f.key] === undefined && f.label.endsWith("*") && "border-amber-400")}
                      >
                        <option value={-1}>—</option>
                        {sheet.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-2 border-t border-line px-4 py-3 text-sm">
                  <input type="checkbox" checked={incGst} onChange={(e) => setIncGst(e.target.checked)} />
                  {tr("Prices in this file include GST (the shop stores prices ex GST, so 10% is taken off taxable lines)")}</label>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader
                  title={tr("Preview")}
                  subtitle={
                    bad
                      ? `${bad} row${bad === 1 ? "" : "s"} need fixing before you can import`
                      : `All ${rows.length} rows look good · ${newCount} new, ${rows.length - newCount} update existing products`
                  }
                  action={bad ? <Badge tone="red">{bad} {" "}{tr("to fix")}</Badge> : <Badge tone="green">{tr("Ready")}</Badge>}
                />
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="sticky top-0 border-b border-line bg-slate-50 text-left text-xs text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">{tr("Row")}</th>
                        <th className="px-2 py-2 font-medium">{tr("SKU")}</th>
                        <th className="px-2 py-2 font-medium">{tr("Name")}</th>
                        <th className="px-2 py-2 text-right font-medium">{tr("Price ex GST")}</th>
                        <th className="px-2 py-2 font-medium">{tr("Category")}</th>
                        <th className="px-2 py-2 text-right font-medium">{tr("Stock")}</th>
                        <th className="px-3 py-2 font-medium">{tr("Check")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checks.map((c, i) => (
                        <tr key={i} className={cx("border-b border-line last:border-0", !c.ok && "bg-red-50/60")}>
                          <td className="px-3 py-1.5 text-xs text-slate-400 tabular-nums">{i + 2}</td>
                          <td className="px-2 py-1.5 font-mono text-xs">{c.ok ? c.value.sku : (rows[i].sku ?? "")}</td>
                          <td className="max-w-64 truncate px-2 py-1.5">{rows[i].name}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{c.ok && c.value.priceCents !== undefined ? aud(c.value.priceCents) : "—"}</td>
                          <td className="px-2 py-1.5 text-slate-600">{rows[i].category}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{c.ok ? (c.value.stock ?? "—") : ""}</td>
                          <td className="px-3 py-1.5 text-xs">
                            {c.ok ? (
                              existing.has(c.value.sku) ? <Badge tone="blue">{tr("Update")}</Badge> : <Badge tone="green">{tr("New")}</Badge>
                            ) : <span className="flex items-center gap-1 text-red-700"><AlertTriangle className="size-3.5" />{c.error}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {result && result.errors.length > 0 && (
                <Card className="border-red-200 p-4">
                  <p className="text-sm font-semibold text-red-800">{tr("Nothing was imported. Fix these rows and upload again:")}</p>
                  <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto text-sm text-red-700">
                    {result.errors.map((e) => (
                      <li key={`${e.row}-${e.message}`}>
                        {tr("Row")}{" "}{e.row}: {e.message}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <div className="flex items-center justify-end gap-3">
                {missingRequired && <span className="text-sm text-amber-700">{tr("Choose which column holds the SKU.")}</span>}
                <button disabled={pending || bad > 0 || missingRequired} onClick={submit} className={btn("primary", "lg")}>
                  {pending ? <Spinner className="size-4" /> : <Upload className="size-4" />} {" "}{tr(rows.length === 1 ? "Import {n} product" : "Import {n} products", { n: rows.length })}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
