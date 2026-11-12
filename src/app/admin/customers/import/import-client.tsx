"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { type CustomerImportResult, importCustomers } from "@/app/actions/customers";
import { FormError } from "@/components/client-ui";
import { Tx, useT } from "@/components/i18n";
import Link from "@/components/link";
import { Badge, btn, Card, CardHeader, cx, inputCls, PageHeader, Spinner } from "@/components/ui";
import {
  checkCustomerRow,
  codeKey,
  CUSTOMER_FIELDS,
  CUSTOMER_TEMPLATE_HEADERS,
  type CustomerField,
  type CustomerImportRow,
  type CustomerMapping,
  duplicateCustomers,
  MAX_CUSTOMER_ROWS,
  nameKey,
} from "@/lib/customer-import";
import { aud, PAYMENT_TERMS_LABEL } from "@/lib/money";
import { SALES_STAGES, STAGE_INFO } from "@/lib/sales-stage";
import type { SalesStage } from "@/lib/db/schema";
import { guessMapping, toCsv } from "@/lib/product-import";
import { downloadCsv, readSpreadsheet, type Sheet } from "@/lib/spreadsheet";

const TEMPLATE = toCsv([
  CUSTOMER_TEMPLATE_HEADERS,
  ["LUCKY01", "Lucky Noodle Bar", "0412 345 678", "accounts@luckynoodle.com.au", "12 Wickham St, Fortitude Valley QLD 4006", "12 345 678 901", "14 days", "3000", "yes"],
  ["", "Sunny Side Café", "07 3123 4567", "", "5 Grey St, South Brisbane QLD 4101", "", "COD", "", "yes"],
]);

export function CustomerImportClient({ existing }: { existing: { code: string; name: string }[] }) {
  const tr = useT();
  const codes = useMemo(() => new Set(existing.map((c) => codeKey(c.code))), [existing]);
  const names = useMemo(() => new Set(existing.map((c) => nameKey(c.name))), [existing]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<CustomerMapping>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CustomerImportResult | null>(null);
  // "" = new customers are Won (they buy from us), existing ones keep their stage.
  const [stage, setStage] = useState<SalesStage | "">("");
  const [pending, start] = useTransition();

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    try {
      const s = await readSpreadsheet(file);
      if (!s.rows.length) return setError(tr("That file has no customer rows under the header row."));
      if (s.rows.length > MAX_CUSTOMER_ROWS) return setError(tr("That file has {n} rows. Import at most {max} at a time.", { n: s.rows.length, max: MAX_CUSTOMER_ROWS }));
      setSheet(s);
      setMapping(guessMapping(CUSTOMER_FIELDS, s.headers));
    } catch (e) {
      setError(/^Upload a/.test((e as Error).message) ? (e as Error).message : `${tr("Couldn't read that file:")} ${(e as Error).message}`);
    }
  }

  const rows: CustomerImportRow[] = useMemo(() => {
    if (!sheet) return [];
    return sheet.rows.map((r) => {
      const row: CustomerImportRow = {};
      for (const [k, idx] of Object.entries(mapping)) if (idx !== undefined && idx >= 0) row[k as CustomerField] = r[idx] ?? "";
      return row;
    });
  }, [sheet, mapping]);

  // Same matching as the server: the code, or else (a code the system doesn't have yet too) the name.
  const isUpdate = (v: { code?: string; name?: string }) => (!!v.code && codes.has(codeKey(v.code))) || (!!v.name && names.has(nameKey(v.name)));
  const checks = useMemo(() => {
    const dupes = duplicateCustomers(rows);
    return rows.map((r, i) => {
      if (dupes.has(i)) return { ok: false as const, error: `Same customer as row ${dupes.get(i)! + 2}` };
      const c = checkCustomerRow(r);
      if (c.ok && !c.value.name && !(c.value.code && codes.has(codeKey(c.value.code)))) return { ok: false as const, error: `New customer ${c.value.code} needs a business name` };
      return c;
    });
  }, [rows, codes]);
  const newCount = checks.filter((c) => c.ok && !isUpdate(c.value)).length;
  const bad = checks.filter((c) => !c.ok).length;
  // Updating existing customers only needs their code; adding new ones needs a name.
  const noKey = (mapping.name === undefined || mapping.name < 0) && (mapping.code === undefined || mapping.code < 0);

  function submit() {
    setError(null);
    start(async () => {
      const r = await importCustomers(rows, stage || undefined);
      if (!r.ok) return setError(r.error);
      setResult(r.data!);
    });
  }

  return (
    <>
      <Link href="/admin/customers" className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> {tr("Customers")}
      </Link>
      <PageHeader
        title={tr("Import customers")}
        subtitle={tr("Upload your customer list from the old system. Customers are matched by customer code: new codes are added, existing ones updated. Rows without a code get the next code automatically. Empty cells leave the current value as it is.")}
        actions={
          <button className={btn("secondary")} onClick={() => downloadCsv("foodpac-customers-template.csv", TEMPLATE)}>
            <Download className="size-4" /> {tr("Download template")}
          </button>
        }
      />

      {result && result.errors.length === 0 ? (
        <Card className="p-8 text-center">
          <CheckCircle2 className="mx-auto size-12 animate-check text-emerald-600" />
          <p className="mt-3 text-lg font-semibold text-slate-900">{tr("{a} added · {u} updated", { a: result.created, u: result.updated })}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Link href="/admin/customers" className={btn("primary")}>
              {tr("View customers")}
            </Link>
            <button className={btn("secondary")} onClick={() => (setSheet(null), setResult(null))}>
              {tr("Import another file")}
            </button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-5">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-6 py-8 text-center hover:border-blue-400 hover:bg-blue-50/40">
              {sheet ? <FileSpreadsheet className="size-8 text-blue-600" /> : <Upload className="size-8 text-slate-400" />}
              <span className="text-sm font-medium text-slate-900">{sheet ? `${sheet.name} · ${sheet.rows.length} rows` : tr("Choose an Excel (.xlsx) or CSV file")}</span>
              <span className="text-xs text-slate-500">{tr("First row = column names. Up to {max} customers per file.", { max: MAX_CUSTOMER_ROWS })}</span>
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
                  {CUSTOMER_FIELDS.map((f) => (
                    <label key={f.key} className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-600">
                        <Tx>{f.label}</Tx>
                      </span>
                      <select
                        value={mapping[f.key] ?? -1}
                        onChange={(e) => setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) < 0 ? undefined : Number(e.target.value) }))}
                        className={cx(inputCls, mapping[f.key] === undefined && (f.key === "name" || f.key === "code") && "border-amber-400")}
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
              </Card>

              <Card className="overflow-hidden">
                <CardHeader
                  title={tr("Preview")}
                  subtitle={
                    bad
                      ? tr("{n} row(s) need fixing before you can import", { n: bad })
                      : tr("All {n} rows look good · {a} new, {u} update existing customers", { n: rows.length, a: newCount, u: rows.length - newCount })
                  }
                  action={bad ? <Badge tone="red">{tr("{n} to fix", { n: bad })}</Badge> : <Badge tone="green">{tr("Ready")}</Badge>}
                />
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="sticky top-0 border-b border-line bg-slate-50 text-left text-xs text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">{tr("Row")}</th>
                        <th className="px-2 py-2 font-medium">{tr("Customer code")}</th>
                        <th className="px-2 py-2 font-medium">{tr("Name")}</th>
                        <th className="px-2 py-2 font-medium">{tr("Phone")}</th>
                        <th className="px-2 py-2 font-medium">{tr("Payment terms")}</th>
                        <th className="px-2 py-2 text-right font-medium">{tr("Credit limit")}</th>
                        <th className="px-3 py-2 font-medium">{tr("Check")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checks.map((c, i) => (
                        <tr key={i} className={cx("border-b border-line last:border-0", !c.ok && "bg-red-50/60")}>
                          <td className="px-3 py-1.5 text-xs text-slate-400 tabular-nums">{i + 2}</td>
                          <td className="px-2 py-1.5 font-mono text-xs">{c.ok ? (c.value.code ?? <span className="text-slate-400">{tr("auto")}</span>) : (rows[i].code ?? "")}</td>
                          <td className="max-w-64 truncate px-2 py-1.5">{rows[i].name}</td>
                          <td className="px-2 py-1.5 text-slate-600">{rows[i].phone}</td>
                          <td className="px-2 py-1.5 text-slate-600">{c.ok && c.value.paymentTerms ? tr(PAYMENT_TERMS_LABEL[c.value.paymentTerms]) : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{c.ok && c.value.creditLimitCents !== undefined ? aud(c.value.creditLimitCents) : "—"}</td>
                          <td className="px-3 py-1.5 text-xs">
                            {c.ok ? (
                              isUpdate(c.value) ? <Badge tone="blue">{tr("Update")}</Badge> : <Badge tone="green">{tr("New")}</Badge>
                            ) : (
                              <span className="flex items-center gap-1 text-red-700">
                                <AlertTriangle className="size-3.5" />
                                {c.error}
                              </span>
                            )}
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
                        {tr("Row")} {e.row}: {e.message}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <Card className="flex flex-wrap items-center gap-3 p-4">
                <label htmlFor="import-stage" className="text-sm font-medium text-slate-700">
                  {tr("Sales stage")}
                </label>
                <select id="import-stage" value={stage} onChange={(e) => setStage(e.target.value as SalesStage | "")} className={cx(inputCls, "w-auto")}>
                  <option value="">{tr("Keep as is (new customers: Won)")}</option>
                  {SALES_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {tr("Set all to: {stage}", { stage: tr(STAGE_INFO[s].label) })}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-500">{tr("Applies to every customer in the file, new and existing.")}</span>
              </Card>

              <div className="flex items-center justify-end gap-3">
                {noKey && <span className="text-sm text-amber-700">{tr("Choose which column holds the customer code or business name.")}</span>}
                <button disabled={pending || bad > 0 || noKey} onClick={submit} className={btn("primary", "lg")}>
                  {pending ? <Spinner className="size-4" /> : <Upload className="size-4" />} {tr(rows.length === 1 ? "Import {n} customer" : "Import {n} customers", { n: rows.length })}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
