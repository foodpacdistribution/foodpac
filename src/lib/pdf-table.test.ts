import { describe, expect, it } from "vitest";
import { guessMapping, parseDate } from "./orders";
import { pdfToMatrix, PdfReadError, splitAddress, type PdfPage, type PdfText } from "./pdf-table";

// Text runs as pdf.js reports them: x/y in points, y down, ~6pt per character at 10pt.
const t = (str: string, x: number, y: number, h = 10): PdfText => ({ str, x, y, w: str.length * h * 0.5, h });
const COLS = [40, 100, 200, 360, 440, 500];

function tableRow(y: number, cells: string[]) {
  return cells.flatMap((c, i) => (c ? [t(c, COLS[i], y)] : []));
}

describe("pdfToMatrix — table reports", () => {
  it("rebuilds rows under the header, ignoring the title block and page footers", () => {
    const page: PdfPage = [
      t("Foodpac — Daily run sheet", 40, 30, 16),
      ...tableRow(80, ["Order", "Customer", "Address", "Suburb", "Postcode", "Qty"]),
      ...tableRow(100, ["A1001", "Acme Pty Ltd", "12 Example St", "Toowong", "4066", "3"]),
      ...tableRow(120, ["A1002", "Cafe Two", "8 Queen St", "Brisbane", "4000", "1"]),
      t("Page 1 of 1", 280, 800),
    ];
    expect(pdfToMatrix([page])).toEqual([
      ["Order", "Customer", "Address", "Suburb", "Postcode", "Qty"],
      ["A1001", "Acme Pty Ltd", "12 Example St", "Toowong", "4066", "3"],
      ["A1002", "Cafe Two", "8 Queen St", "Brisbane", "4000", "1"],
    ]);
  });

  it("joins wrapped cells, two-line headings and rows over several pages", () => {
    const heading = [...tableRow(40, ["Order", "Customer", "Delivery", "Suburb", "Postcode", "Delivery"]), ...tableRow(52, ["No.", "", "Address", "", "", "Window"])];
    const p1: PdfPage = [
      ...heading,
      ...tableRow(80, ["A1", "Golden", "Unit 4, 25 Very", "Sunnybank", "4109", "9am-"]),
      ...tableRow(92, ["", "Dragon", "Long Road", "Hills", "", "12pm"]),
    ];
    const p2: PdfPage = [...heading, ...tableRow(80, ["A2", "Acme", "3 Short St", "Toowong", "4066", "9am-12pm"])];
    expect(pdfToMatrix([p1, p2])).toEqual([
      ["Order No.", "Customer", "Delivery Address", "Suburb", "Postcode", "Delivery Window"],
      ["A1", "Golden Dragon", "Unit 4, 25 Very Long Road", "Sunnybank Hills", "4109", "9am-12pm"],
      ["A2", "Acme", "3 Short St", "Toowong", "4066", "9am-12pm"],
    ]);
  });

  it("puts right-aligned numbers under their heading", () => {
    const page: PdfPage = [
      ...tableRow(80, ["Order", "Customer", "Address"]),
      t("Qty", 470, 80),
      ...tableRow(100, ["A1", "Acme", "12 Example St"]),
      t("12", 478, 100),
    ];
    expect(pdfToMatrix([page])[1]).toEqual(["A1", "Acme", "12 Example St", "12"]);
  });
});

// The layout of the delivery orders Foodpac's system prints (positions taken from a real
// one, details made up): customer heading, SHIP TO block on the left, a label/value block
// on the right sharing those lines, an item table, and a second page with the last items.
function deliveryOrder(n: number): PdfPage[] {
  const label = (s: string, y: number) => t(s, 359, y, 9);
  const value = (s: string, y: number) => ({ ...t(s, 0, y, 9), x: 565 - s.length * 4.5 });
  return [
    [
      t("DELIVERY ORDER", 388, 145, 20),
      t(`Noodle House ${n} (West End)`, 32, 180.5, 15),
      t("SHIP TO:", 30, 203.7, 9),
      t(`${n} Boundary St, West End QLD 4101`, 30, 233.7, 9),
      t("West end, 4101", 30, 248.7, 9),
      t("Jane Citizen", 30, 263.7, 9),
      t("Email: jane@example.com", 30, 323.7, 9),
      label("DELIVERY ORDER #:", 206), value(`DO00${n}`, 206),
      label("DATE:", 217.9), value("Nov 09, 2026", 217.9),
      label("DELIVERY TERMS:", 229.8),
      label("DELIVERY METHOD:", 241.8),
      label("SALES ORDER #:", 253.7), value(`SO00${n}`, 253.7),
      label("CUSTOMER PO#:", 265.7),
      label("TRACKING NUMBER:", 277.6),
      t("#", 31, 362.9, 9), t("NAME", 48, 362.9, 9), t("UNIT", 319, 362.9, 9), t("QTY", 546, 362.9, 9),
      t("1", 30, 387.8, 9), t("PAPER BOWL 750ml Bamboo print", 85, 387.8, 9), t("竹纹纸碗 50PC*12PK/CTN", 85, 398.6, 9), t("PKT [1.00]", 318, 387.8, 9), t("5.00", 547, 387.8, 9),
      t(`DO00${n}`, 30, 800, 9), t("Page 1 of 2", 480, 800, 9),
    ],
    [
      t("2", 30, 170, 9), t("XYW-05 sushi container", 85, 170, 9), t("Unit(s) [1.00]", 318, 170, 9), t("2.00", 547, 170, 9),
      t("Total", 470, 278, 9), t("31.00", 547, 278, 9),
      t(`DO00${n}`, 30, 800, 9), t("Page 2 of 2", 480, 800, 9),
    ],
  ];
}

describe("pdfToMatrix — delivery orders", () => {
  const headers = ["Customer", "SHIP TO", "Suburb", "Postcode", "Notes", "DELIVERY ORDER #", "DATE", "SALES ORDER #", "Email"];

  it("reads one delivery order spread over two pages as one order", () => {
    expect(pdfToMatrix(deliveryOrder(7))).toEqual([
      headers,
      ["Noodle House 7 (West End)", "7 Boundary St, West End QLD 4101", "West end", "4101", "Attn: Jane Citizen", "DO007", "Nov 09, 2026", "SO007", "jane@example.com"],
    ]);
  });

  it("reads several delivery orders saved into one PDF", () => {
    const m = pdfToMatrix([...deliveryOrder(1), ...deliveryOrder(2), ...deliveryOrder(3)]);
    expect(m.slice(1).map((r) => r[5])).toEqual(["DO001", "DO002", "DO003"]);
  });

  it("maps to the right import columns, with a date the importer reads", () => {
    const [h, row] = pdfToMatrix(deliveryOrder(7));
    const m = guessMapping(h);
    expect(m).toMatchObject({ customerName: 0, address: 1, suburb: 2, postcode: 3, notes: 4, orderNumber: 5, deliveryDate: 6 });
    expect(parseDate(row[m.deliveryDate!])).toBe("2026-11-09");
  });
});

describe("splitAddress", () => {
  it("separates the street address, suburb line and the person it is for", () => {
    expect(splitAddress(["66 Ernest St, South Brisbane QLD 4101", "South brisbane, 4101", "Hao Lin"])).toEqual({
      address: "66 Ernest St, South Brisbane QLD 4101",
      suburb: "South brisbane",
      postcode: "4101",
      attention: "Hao Lin",
    });
  });

  it("keeps a suburb line that completes the address, and lifts out a business name", () => {
    expect(splitAddress(["Acme Pty Ltd", "Unit 3, 12 Smith St", "TOOWONG QLD 4066", "Attn: Bob"])).toEqual({
      address: "Unit 3, 12 Smith St, TOOWONG QLD 4066",
      company: "Acme Pty Ltd",
      suburb: "TOOWONG",
      postcode: "4066",
      attention: "Bob",
    });
  });
});

describe("pdfToMatrix — one order per page", () => {
  it("reads Label: value lines, including an address block under its label", () => {
    const docket = (n: number): PdfPage => [
      t("TAX INVOICE", 40, 30, 18),
      t(`Order No: INV-${n}`, 40, 80),
      t(`Customer: Cafe ${n}`, 40, 100),
      t("Delivery Address:", 40, 120),
      t(`${n} Queen Street`, 40, 132),
      t("Brisbane QLD 4000", 40, 144),
      t("Phone:", 40, 170),
      t("0400 000 000", 120, 170),
    ];
    expect(pdfToMatrix([docket(1), docket(2)])).toEqual([
      ["Order No", "Customer", "Delivery Address", "Suburb", "Postcode", "Phone"],
      ["INV-1", "Cafe 1", "1 Queen Street, Brisbane QLD 4000", "Brisbane", "4000", "0400 000 000"],
      ["INV-2", "Cafe 2", "2 Queen Street, Brisbane QLD 4000", "Brisbane", "4000", "0400 000 000"],
    ]);
  });
});

describe("pdfToMatrix — unreadable PDFs", () => {
  it("explains a scanned PDF", () => {
    expect(() => pdfToMatrix([[], []])).toThrow(PdfReadError);
    expect(() => pdfToMatrix([[]])).toThrow(/scan/);
  });

  it("explains a PDF without an order table", () => {
    expect(() => pdfToMatrix([[t("Just a letter about nothing in particular", 40, 40)]])).toThrow(/order table/);
  });
});
