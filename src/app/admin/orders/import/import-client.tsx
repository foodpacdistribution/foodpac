"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardPaste, FileSpreadsheet, Map as MapIcon, Upload } from "lucide-react";
import Link from "@/components/link";
import Papa from "papaparse";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { geocodeOrders, importOrders } from "@/app/actions/orders";
import { FormError } from "@/components/client-ui";
import { Badge, btn, Card, CardHeader, cx, Field, inputCls, PageHeader, Spinner } from "@/components/ui";
import { guessMapping, IMPORT_FIELDS, type ImportField, type ImportRow, validateImportRow } from "@/lib/orders";
import { Tx, useT } from "@/components/i18n";

type Sheet = { headers: string[]; rows: string[][]; name: string };
type Mapping = Partial<Record<ImportField, number>>;
type Result = { inserted: number; ids: string[]; duplicates: string[]; errors: { row: number; message: string }[] };
/** Placing the imported addresses on the map, which starts by itself after an import. */
type Locate = { done: number; total: number; failed: number; error?: string };

const TEMPLATE_KEY = "dp.importTemplates";

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    // Excel time-only cells come through as dates on 30 Dec 1899.
    if (v.getUTCFullYear() < 1901) return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  return String(v).trim();
}

function toSheet(name: string, matrix: unknown[][]): Sheet {
  const rows = matrix.map((r) => r.map(cellToString)).filter((r) => r.some((c) => c !== ""));
  const [headers = [], ...data] = rows;
  return { name, headers: headers.map((h, i) => h || `Column ${i + 1}`), rows: data };
}

function loadTemplates(): Record<string, Mapping> {
  try {
    return JSON.parse(localStorage.getItem(TEMPLATE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveTemplate(headers: string[], mapping: Mapping) {
  try {
    const all = loadTemplates();
    all[headers.join("|").toLowerCase()] = mapping;
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable — templates are a convenience only.
  }
}

export function ImportClient({ defaultDate }: { defaultDate: string }) {
  const tr = useT();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [usedTemplate, setUsedTemplate] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [locate, setLocate] = useState<Locate | null>(null);
  const [pending, startTransition] = useTransition();
  // Stop locating if the user leaves the page; what's left can be checked from Orders.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  async function locateAll(ids: string[]) {
    let failed = 0;
    setLocate({ done: 0, total: ids.length, failed });
    // Small batches so progress shows (Nominatim allows ~1 request/second).
    for (let i = 0; i < ids.length && alive.current; i += 5) {
      const r = await geocodeOrders(ids.slice(i, i + 5));
      if (!r.ok) return setLocate({ done: i, total: ids.length, failed, error: r.error });
      failed += (r.data ?? []).filter((x) => x && x.status === "failed").length;
      setLocate({ done: Math.min(ids.length, i + 5), total: ids.length, failed });
    }
  }

  function accept(s: Sheet) {
    if (!s.rows.length) return setError("That file has no data rows under the header row.");
    setError(null);
    setResult(null);
    setSheet(s);
    const saved = loadTemplates()[s.headers.join("|").toLowerCase()];
    setUsedTemplate(!!saved);
    setMapping(saved ?? guessMapping(s.headers));
  }

  async function onFile(file: File) {
    setError(null);
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        accept(toSheet(file.name, (await readSheet(file)) as unknown[][]));
      } else if (/\.(csv|txt|tsv)$/i.test(file.name)) {
        const text = await file.text();
        accept(toSheet(file.name, Papa.parse<string[]>(text.trim(), { skipEmptyLines: true }).data));
      } else {
        setError("Upload a .xlsx or .csv file. For old .xls files, save as .xlsx first.");
      }
    } catch (e) {
      setError(`Couldn't read that file: ${(e as Error).message}`);
    }
  }

  const mapped: ImportRow[] = useMemo(() => {
    if (!sheet) return [];
    return sheet.rows.map((r) => {
      const row: ImportRow = {};
      for (const [k, idx] of Object.entries(mapping)) if (idx !== undefined && idx >= 0) row[k as ImportField] = r[idx] ?? "";
      return row;
    });
  }, [sheet, mapping]);

  const checks = useMemo(() => mapped.map((r, i) => validateImportRow(r, date, i)), [mapped, date]);
  const invalid = checks.filter((c) => !c.ok).length;

  function submit() {
    if (!sheet) return;
    saveTemplate(sheet.headers, mapping);
    startTransition(async () => {
      const r = await importOrders(mapped, date);
      if (!r.ok) return setError(r.error);
      setResult(r.data!);
      if (r.data!.ids.length) void locateAll(r.data!.ids);
    });
  }

  return (
    <>
      <PageHeader
        title={tr("Import orders")}
        subtitle={tr("Upload the day's order export from any system. Columns are matched automatically and you can adjust them.")}
        actions={
          <Link href={`/admin/orders?date=${date}`} className={btn("ghost")}>
            <ArrowLeft className="size-4" /> {" "}{tr("Back to orders")}</Link>
        }
      />

      {result ? (
        <Card className="mx-auto max-w-xl p-6 text-center">
          <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
          <h2 className="mt-3 text-lg font-semibold">{result.inserted} {" "}{tr("orders imported")}</h2>
          <div className="mt-2 space-y-1 text-sm text-slate-600">
            {result.duplicates.length > 0 && (
              <p>
                {result.duplicates.length} {" "}{tr("skipped as duplicates (same order number and date already in the system).")}</p>
            )}
            {result.errors.length > 0 && <p>{result.errors.length} {" "}{tr("rows had problems and were not imported.")}</p>}
          </div>
          {result.errors.length > 0 && (
            <ul className="mx-auto mt-3 max-h-40 max-w-md overflow-y-auto rounded-lg bg-red-50 p-3 text-left text-xs text-red-700">
              {result.errors.map((e) => (
                <li key={e.row}>
                  {tr("Row")}{" "}{e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
          <LocateStatus locate={locate} date={date} />
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {locate && locate.done === locate.total && !locate.error && !locate.failed ? (
              <Link href={`/admin/planner?date=${date}`} className={btn("primary")}>
                <MapIcon className="size-4" /> {" "}{tr("Plan the routes")}</Link>
            ) : locate && locate.done === locate.total && locate.failed > 0 ? (
              <Link href={`/admin/orders?date=${date}&status=attention`} className={btn("primary")}>
                {tr("Fix")}{" "}{locate.failed} {locate.failed === 1 ? tr("address") : tr("addresses")}
              </Link>
            ) : (
              <Link href={`/admin/orders?date=${date}`} className={btn(locate && !locate.error ? "secondary" : "primary")}>
                {tr("Review orders")}</Link>
            )}
            <button className={btn("secondary")} onClick={() => (setSheet(null), setResult(null), setLocate(null))}>
              {tr("Import another file")}</button>
          </div>
        </Card>
      ) : !sheet ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={tr("Upload a file")} subtitle={tr("Excel (.xlsx) or CSV with a header row")} />
            <label
              className="m-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line px-6 py-12 text-center hover:border-blue-400 hover:bg-blue-50/30"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) onFile(f);
              }}
            >
              <FileSpreadsheet className="size-10 text-slate-400" />
              <span className="mt-3 text-sm font-medium text-slate-800">{tr("Drop a file here or click to choose")}</span>
              <span className="mt-1 text-xs text-slate-500">{tr("Order number, customer, address, suburb, postcode, time window…")}</span>
              <input type="file" accept=".xlsx,.csv,.txt,.tsv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
          </Card>
          <Card>
            <CardHeader title={tr("Or paste rows")} subtitle={tr("Copy cells straight from Excel or Google Sheets, including the header row")} />
            <div className="space-y-3 p-4">
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                rows={9}
                placeholder={"Order\tCustomer\tAddress\tSuburb\tPostcode\tWindow\nA1001\tAcme Pty Ltd\t12 Example St\tToowong\t4066\t9am-12pm"}
                className={cx(inputCls, "h-auto py-2 font-mono text-xs")}
              />
              <button
                className={btn("primary", "md", "w-full")}
                disabled={!paste.trim()}
                onClick={() => accept(toSheet("Pasted rows", Papa.parse<string[]>(paste.trim(), { skipEmptyLines: true }).data))}
              >
                <ClipboardPaste className="size-4" /> {" "}{tr("Use pasted rows")}</button>
            </div>
          </Card>
          <div className="lg:col-span-2">
            <FormError message={error} />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
          <Card className="h-fit">
            <CardHeader
              title={tr("Match columns")}
              subtitle={
                <>
                  {sheet.name} · {sheet.rows.length} {" "}{tr("rows")}{" "}{usedTemplate && <Badge tone="blue">{tr("Saved template applied")}</Badge>}
                </>
              }
            />
            <div className="space-y-3 p-4">
              <Field label={tr("Delivery date for rows without one")}>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
              </Field>
              <div className="h-px bg-line" />
              {IMPORT_FIELDS.map((f) => (
                <div key={f.key} className="grid grid-cols-[8.5rem_1fr] items-center gap-2">
                  <span className={cx("text-xs", f.key === "address" ? "font-semibold text-slate-800" : "text-slate-600")}>{<Tx>{f.label}</Tx>}</span>
                  <select
                    value={mapping[f.key] ?? -1}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) < 0 ? undefined : Number(e.target.value) })}
                    className={cx(inputCls, "h-8 text-xs", mapping[f.key] === undefined && "text-slate-400")}
                  >
                    <option value={-1}>{tr("— not in file —")}</option>
                    {sheet.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <p className="text-[11px] text-slate-500">{tr("This matching is remembered for files with the same columns.")}</p>
            </div>
          </Card>

          <Card className="min-w-0">
            <CardHeader
              title={tr("Preview")}
              subtitle={
                invalid ? (
                  <span className="text-red-600">{invalid} {" "}{tr("row(s) have problems and will be skipped")}</span>
                ) : (
                  "All rows look good"
                )
              }
              action={
                <div className="flex gap-2">
                  <button className={btn("ghost", "sm")} onClick={() => setSheet(null)}>
                    {tr("Change file")}</button>
                  <button className={btn("primary", "sm")} disabled={pending || mapping.address === undefined || invalid === checks.length} onClick={submit}>
                    {pending ? <Spinner className="size-3.5" /> : <Upload className="size-3.5" />}
                    {pending ? "Importing…" : `Import ${checks.length - invalid} orders`}
                  </button>
                </div>
              }
            />
            {mapping.address === undefined && <p className="px-4 pt-3 text-sm text-red-600">{tr("Choose which column holds the delivery address.")}</p>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-xs">
                <thead>
                  <tr className="border-b border-line text-left font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">{tr("Order")}</th>
                    <th className="px-3 py-2">{tr("Customer")}</th>
                    <th className="px-3 py-2">{tr("Address")}</th>
                    <th className="px-3 py-2">{tr("Date")}</th>
                    <th className="px-3 py-2">{tr("Window")}</th>
                    <th className="px-3 py-2">{tr("Qty")}</th>
                    <th className="px-3 py-2">{tr("Check")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {checks.slice(0, 200).map((c, i) => (
                    <tr key={i} className={c.ok ? "" : "bg-red-50/50"}>
                      <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">{c.ok ? c.value.orderNumber : mapped[i].orderNumber}</td>
                      <td className="max-w-40 truncate px-3 py-2">{mapped[i].customerName}</td>
                      <td className="max-w-64 truncate px-3 py-2">
                        {[mapped[i].address, mapped[i].suburb, mapped[i].postcode].filter(Boolean).join(", ")}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{c.ok ? c.value.deliveryDate : mapped[i].deliveryDate}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {mapped[i].timeWindow || [mapped[i].windowStart, mapped[i].windowEnd].filter(Boolean).join(" – ") || "—"}
                      </td>
                      <td className="px-3 py-2">{c.ok ? c.value.demand : mapped[i].demand}</td>
                      <td className="px-3 py-2">{c.ok ? <Badge tone="green">{tr("OK")}</Badge> : <span className="text-red-600">{c.error}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {checks.length > 200 && <p className="px-3 py-2 text-xs text-slate-500">{tr("Showing first 200 of")}{" "}{checks.length} {" "}{tr("rows.")}</p>}
            </div>
            <div className="p-4">
              <FormError message={error} />
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function LocateStatus({ locate, date }: { locate: Locate | null; date: string }) {
  const tr = useT();
  if (!locate) return null;
  if (locate.error)
    return (
      <p className="mt-4 text-sm text-red-600">
        {locate.error} {" "}{tr("The rest can be checked from")}{" "}<Link href={`/admin/orders?date=${date}&status=attention`} className="underline">{tr("Orders")}</Link>.
      </p>
    );
  if (locate.done < locate.total)
    return (
      <div className="mx-auto mt-5 max-w-sm text-left">
        <p className="flex justify-between text-sm text-slate-600">
          <span>{tr("Placing addresses on the map…")}</span>
          <span className="tabular-nums">
            {locate.done} / {locate.total}
          </span>
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-blue-600 transition-[width] duration-500 ease-out" style={{ width: `${(locate.done / locate.total) * 100}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-slate-400">{tr("You can leave this page. Anything left can be checked from Orders.")}</p>
      </div>
    );
  return locate.failed ? (
    <p className="mt-4 flex animate-rise items-center justify-center gap-1.5 text-sm text-amber-700">
      <AlertTriangle className="size-4" /> {locate.failed} {" "}{tr("of")}{" "}{locate.total} {locate.total === 1 ? tr("address") : tr("addresses")} {" "}{tr("couldn't be found. Fix them before planning.")}</p>
  ) : (
    <p className="mt-4 animate-rise text-sm text-emerald-700">{tr("All")}{" "}{locate.total} {" "}{tr("addresses are on the map. Ready to plan.")}</p>
  );
}
