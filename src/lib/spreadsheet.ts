// Reading an uploaded spreadsheet in the browser (product and customer imports): the first row is
// the column names, empty rows are dropped. .xlsx through read-excel-file, CSV through papaparse.

import Papa from "papaparse";

export type Sheet = { name: string; headers: string[]; rows: string[][] };

const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

export function toSheet(name: string, matrix: unknown[][]): Sheet {
  const rows = matrix.map((r) => r.map(cell)).filter((r) => r.some((c) => c !== ""));
  const [headers = [], ...data] = rows;
  return { name, headers: headers.map((h, i) => h || `Column ${i + 1}`), rows: data };
}

/** Throws a message to show when the file isn't a spreadsheet we can read. */
export async function readSpreadsheet(file: File): Promise<Sheet> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import("read-excel-file/browser");
    return toSheet(file.name, (await readSheet(file)) as unknown[][]);
  }
  if (/\.(csv|txt|tsv)$/i.test(file.name)) {
    return toSheet(file.name, Papa.parse<string[]>((await file.text()).replace(/^﻿/, "").trim(), { skipEmptyLines: true }).data);
  }
  throw new Error("Upload a .xlsx or .csv file. For old .xls files, save as .xlsx first.");
}

export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}
