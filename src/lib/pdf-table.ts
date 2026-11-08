import { guessMapping } from "./orders";

/**
 * Turns the text of an order PDF back into spreadsheet rows (header row first),
 * so a PDF goes through the same column matching as an Excel or CSV file.
 *
 * Two layouts are understood:
 *  - a table report (a header row such as "Order | Customer | Address | …", then one
 *    order per row, possibly over several pages and with wrapped cells), and
 *  - one order per document (delivery orders, dockets, invoices) laid out as labelled
 *    fields — "Order #: …", "DATE: …", a "SHIP TO:" block — in one or more columns.
 *    A PDF may hold several such documents back to back; each becomes one row.
 */

/** One run of text, in page units with y growing downwards; y is the baseline. */
export type PdfText = { str: string; x: number; y: number; w: number; h: number };
export type PdfPage = PdfText[];

type Cell = { text: string; x0: number; x1: number; y: number; h: number };
type Line = { page: number; y: number; h: number; cells: Cell[] };

export class PdfReadError extends Error {}

export function pdfToMatrix(pages: PdfPage[]): string[][] {
  if (!pages.some((p) => p.some((t) => t.str.trim()))) {
    throw new PdfReadError("This PDF has no readable text (it looks like a scan or photo). Export the orders as Excel or CSV instead, or copy them from the source system.");
  }
  const lines = pages.flatMap((p, i) => toLines(p, i));
  const table = readTable(lines);
  if (table) return table;
  const labelled = readLabelledDocs(lines, pages.length);
  if (labelled) return labelled;
  throw new PdfReadError("Couldn't find an order table in this PDF. It needs a header row (e.g. Order, Customer, Address) or \"Label: value\" lines such as \"Address: …\".");
}

// ---------------------------------------------------------------------------
// Text runs → lines → cells

function toLines(items: PdfPage, page: number): Line[] {
  const runs = items.filter((t) => t.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: PdfText[][] = [];
  for (const t of runs) {
    const row = rows[rows.length - 1];
    // Same line when baselines are within half a text height (sub/superscripts, mixed fonts).
    if (row && Math.abs(row[0].y - t.y) <= Math.max(row[0].h, t.h) * 0.5) row.push(t);
    else rows.push([t]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const h = Math.max(...row.map((t) => t.h));
    const cells: Cell[] = [];
    for (const t of row) {
      const prev = cells[cells.length - 1];
      const gap = prev ? t.x - prev.x1 : Infinity;
      // Word spacing is about a third of the text height; table columns sit further apart.
      if (prev && gap < h * 0.7) {
        prev.text += (gap > h * 0.12 && !prev.text.endsWith(" ") ? " " : "") + t.str;
        prev.x1 = Math.max(prev.x1, t.x + t.w);
      } else {
        cells.push({ text: t.str, x0: t.x, x1: t.x + t.w, y: t.y, h: t.h });
      }
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
    return { page, y: row[0].y, h, cells: cells.filter((c) => c.text) };
  });
}

// ---------------------------------------------------------------------------
// Table reports

type Header = { lines: Line[]; cols: Cell[]; fields: number; hasAddress: boolean; orderCol?: number };

/**
 * The column headings starting at `lines[i]`, including headings that wrap onto a
 * second or third line ("Order" over "No.", "Delivery" over "Address").
 */
function headerAt(lines: Line[], i: number): Header | null {
  const first = lines[i];
  // "Order: A1001   Address: 12 Example St" is a labelled docket, not a table heading.
  const headingLike = (l: Line) => !l.cells.some((c) => /:\s*\S|:$/.test(c.text) || /\d{3,}/.test(c.text));
  if (first.cells.length < 2 || !headingLike(first)) return null;
  const block = [first];
  for (let k = i + 1; k < lines.length && block.length < 3; k++) {
    const l = lines[k];
    if (l.page !== first.page || l.y - block[block.length - 1].y > Math.max(l.h, first.h) * 1.6 || !headingLike(l)) break;
    block.push(l);
  }
  // Try the heading as one, two and three lines; keep whichever names the most fields.
  let best: Header | null = null;
  for (let n = 1; n <= block.length; n++) {
    const cols: Cell[] = first.cells.map((c) => ({ ...c }));
    for (const l of block.slice(1, n)) {
      for (const c of l.cells) {
        const hit = cols.find((col) => Math.min(col.x1, c.x1) - Math.max(col.x0, c.x0) > 0);
        if (hit) {
          hit.text = joinWrapped(hit.text, c.text);
          hit.x0 = Math.min(hit.x0, c.x0);
          hit.x1 = Math.max(hit.x1, c.x1);
        } else {
          cols.push({ ...c });
        }
      }
    }
    cols.sort((a, b) => a.x0 - b.x0);
    const m = guessMapping(cols.map((c) => c.text));
    const h: Header = { lines: block.slice(0, n), cols, fields: Object.keys(m).length, hasAddress: m.address !== undefined, orderCol: m.orderNumber };
    if (h.hasAddress && h.fields >= 2 && (!best || h.fields > best.fields)) best = h;
  }
  return best;
}

/** Joins the two halves of a wrapped value: "9am-" + "12pm" → "9am-12pm". */
function joinWrapped(a: string, b: string) {
  if (!a) return b;
  if (!b) return a;
  return /[-/]$/.test(a) ? a + b : `${a} ${b}`;
}

const PAGE_FOOTER = /^(page\s*\d+(\s*(of|\/)\s*\d+)?|\d+\s*(of|\/)\s*\d+|printed\b.*|continued\b.*)$/i;

function readTable(lines: Line[]): string[][] | null {
  // The header is the line (or lines) naming the most order fields: at least two, one of them the address.
  // Reports often repeat it on every page, so the first best one wins.
  let header: Header | null = null;
  for (let i = 0; i < lines.length; i++) {
    const h = headerAt(lines, i);
    if (h && (!header || h.fields > header.fields)) header = h;
  }
  if (!header) return null;
  const signature = (l: Line) => l.cells.map((c) => c.text).join("\u0000");
  const headerLines = new Set(header.lines.map(signature));
  const isHeader = (l: Line) => headerLines.has(signature(l));
  const startIdx = lines.indexOf(header.lines[header.lines.length - 1]);

  const cols = header.cols;
  // Each column owns the space halfway to its neighbours, so left-, centre- and
  // right-aligned values all land under the right heading.
  const bounds = cols.map((c, i) => ({
    lo: i === 0 ? -Infinity : (cols[i - 1].x1 + c.x0) / 2,
    hi: i === cols.length - 1 ? Infinity : (c.x1 + cols[i + 1].x0) / 2,
  }));
  const column = (cell: Cell) => {
    let bestCol = 0;
    let bestOverlap = -Infinity;
    bounds.forEach((b, i) => {
      const overlap = Math.min(cell.x1, b.hi) - Math.max(cell.x0, b.lo);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestCol = i;
      }
    });
    return bestCol;
  };

  const anchor = header.orderCol ?? 0;

  const out: string[][] = [cols.map((c) => c.text)];
  let last: { row: string[]; line: Line } | null = null;
  let page = header.lines[0].page;
  let inTable = true;
  let pageTop = false;

  for (const line of lines.slice(startIdx + 1)) {
    if (line.page !== page) {
      // A new page: if it repeats the header, skip its title block down to that header.
      page = line.page;
      inTable = !lines.some((l) => l.page === page && isHeader(l));
      pageTop = true;
    }
    if (!inTable) {
      if (isHeader(line)) inTable = true;
      continue;
    }
    if (isHeader(line)) continue;
    const text = line.cells.map((c) => c.text).join(" ");
    if (PAGE_FOOTER.test(text)) continue;

    const row: string[] = cols.map(() => "");
    for (const c of line.cells) {
      const i = column(c);
      row[i] = row[i] ? `${row[i]} ${c.text}` : c.text;
    }
    const filled = row.filter(Boolean).length;
    // Wrapped cells: no order number, sitting right under the line above (rows are spaced
    // further apart than lines within a row). At the top of a page it is the rest of a
    // row the page break cut in two.
    const continues =
      last &&
      !row[anchor] &&
      filled < cols.length &&
      (pageTop || (line.page === last.line.page && line.y - last.line.y <= Math.max(line.h, last.line.h) * 1.8));
    pageTop = false;
    if (continues && last) {
      row.forEach((v, i) => {
        if (v) last!.row[i] = joinWrapped(last!.row[i], v);
      });
      last.line = line;
    } else {
      out.push(row);
      last = { row, line };
    }
  }
  return out.length > 1 ? out : null;
}

// ---------------------------------------------------------------------------
// One order per document, as labelled fields

const LABEL = /^([A-Za-z][A-Za-z0-9 #./&()'-]{0,30}?)\s*:\s*(.*)$/;
const isLabel = (c: Cell) => LABEL.test(c.text);
const fieldOf = (label: string) => Object.keys(guessMapping([label]))[0];
/** Document titles and letterheads, never a customer name. */
const TITLE = /^(tax\s+)?(invoice|delivery\s+(order|docket|note)|packing\s+(slip|list)|picking\s+(slip|list)|sales\s+order|consignment\s+note|order\s+confirmation|statement|quote|quotation)$|\b(pty\.?\s+ltd|limited|abn)\b/i;
const POSTCODE = /\b\d{4}\b/;
/** "South Brisbane, 4101" / "TOOWONG QLD 4066" */
const SUBURB_LINE = /^([A-Za-z][A-Za-z .'-]*?)[,\s]+(?:(?:QLD|NSW|VIC|ACT|TAS|SA|WA|NT)\s+)?(\d{4})$/i;

type Field = { label: string; lines: string[]; at: Cell & { page: number } };

/** The value of a labelled field: after the colon, further along the line, or in the lines beneath it. */
function fieldValue(label: Cell, inline: string, cells: Cell[]): string[] {
  if (inline) return [inline];
  const sameLine = (c: Cell) => Math.abs(c.y - label.y) <= Math.max(c.h, label.h) * 0.6;
  const right = cells.filter((c) => c !== label && sameLine(c) && c.x0 >= label.x1).sort((a, b) => a.x0 - b.x0)[0];
  if (right && !isLabel(right)) return [right.text];
  // Beneath, in the same column: "SHIP TO:" over an address block. The first line may sit
  // after a gap; the rest follow line by line until another label or a wider gap.
  const below: string[] = [];
  let prev = label;
  for (const c of cells.filter((c) => c.y > label.y + label.h * 0.6 && Math.abs(c.x0 - label.x0) <= label.h * 2).sort((a, b) => a.y - b.y)) {
    if (isLabel(c) || c.y - prev.y > label.h * (below.length ? 2.2 : 4.5) || below.length >= 5) break;
    below.push(c.text);
    prev = c;
  }
  return below;
}

/**
 * Splits a "SHIP TO" block — [business name], street, [suburb line], [person] — into
 * the street address (up to its postcode), suburb, postcode, business and person.
 */
export function splitAddress(lines: string[]) {
  const end = lines.findIndex((l) => POSTCODE.test(l));
  if (end < 0) return { address: lines.join(", ") };
  // Lines before the first one with a number are a business name ("Sushi Paradise", then "66 Ernest St").
  const street = Math.max(0, lines.slice(0, end + 1).findIndex((l) => /\d/.test(l)));
  const out: { address: string; suburb?: string; postcode?: string; company?: string; attention?: string } = {
    address: lines.slice(street, end + 1).join(", "),
  };
  if (street > 0) out.company = lines.slice(0, street).join(", ");
  const rest = lines.slice(end + 1);
  const m = SUBURB_LINE.exec(lines[end]) ?? (rest[0] ? SUBURB_LINE.exec(rest[0]) : null);
  if (m) {
    out.suburb = m[1].trim();
    out.postcode = m[2];
  }
  // "South brisbane, 4101" after a full street address only repeats it.
  if (rest[0] && SUBURB_LINE.test(rest[0])) rest.shift();
  const people = rest.map((l) => l.replace(/^(attn|attention)\b[:.]?\s*/i, "")).filter((l) => l && !/@|\d{5,}/.test(l));
  if (people.length) out.attention = people.join(", ");
  return out;
}

function readLabelledDocs(lines: Line[], pageCount: number): string[][] | null {
  const cells = lines.flatMap((l) => l.cells.map((c) => ({ ...c, page: l.page })));
  const keyLabel = (c: Cell) => {
    const m = LABEL.exec(c.text);
    const f = m && fieldOf(m[1]);
    return f === "orderNumber" || f === "address";
  };
  // A page with an order number or delivery address starts a new document; other pages continue the one before.
  const docs: (typeof cells)[] = [];
  for (let p = 0; p < pageCount; p++) {
    const pageCells = cells.filter((c) => c.page === p);
    if (!docs.length || pageCells.some(keyLabel)) docs.push([]);
    docs[docs.length - 1].push(...pageCells);
  }

  const headers: string[] = [];
  const rows: Record<string, string>[] = [];
  const put = (rec: Record<string, string>, h: string, v: string | undefined) => {
    if (!v || rec[h]) return;
    rec[h] = v;
    if (!headers.includes(h)) headers.push(h);
  };

  for (const doc of docs) {
    const fields: Field[] = [];
    for (const c of [...doc].sort((a, b) => a.page - b.page || a.y - b.y || a.x0 - b.x0)) {
      const m = LABEL.exec(c.text);
      if (!m) continue;
      const lines = fieldValue(c, m[2].trim(), doc.filter((d) => d.page === c.page));
      if (lines.length) fields.push({ label: m[1].trim(), lines, at: c });
    }
    const record: Record<string, string> = {};
    const ship = fields.find((f) => fieldOf(f.label) === "address");
    // Delivery orders print the customer as a heading straight above the ship-to block.
    if (ship && !fields.some((f) => fieldOf(f.label) === "customerName")) {
      const above = doc
        .filter((c) => c.page === ship.at.page && c.y < ship.at.y && ship.at.y - c.y <= Math.max(c.h, ship.at.h) * 4 && Math.abs(c.x0 - ship.at.x0) <= ship.at.h * 2)
        .sort((a, b) => b.y - a.y)[0];
      if (above && !isLabel(above) && !TITLE.test(above.text)) put(record, "Customer", above.text);
    }
    for (const f of fields) {
      if (f === ship) {
        const a = splitAddress(f.lines);
        put(record, f.label, a.address);
        if (a.company) put(record, "Customer", a.company);
        put(record, "Suburb", a.suburb);
        put(record, "Postcode", a.postcode);
        if (a.attention) put(record, "Notes", `Attn: ${a.attention}`);
      } else {
        put(record, f.label, f.lines.join(", "));
      }
    }
    if (ship) rows.push(record);
  }
  const m = guessMapping(headers);
  if (!rows.length || m.address === undefined) return null;
  return [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];
}
