// Reads the invoice number, sales order number, customer and amount out of the text that the
// phone recognised in a photo of a printed invoice (free, on the phone, no outside service).
// Recognition makes typical mistakes — O for 0, a smudged line — so each field is looked for
// where the invoice prints it, and numbers are put right. Pure, so it's tested on real output.

export type InvoiceText = {
  invoiceNumber: string | null;
  salesOrderNumber: string | null;
  customerName: string | null;
  /** "Toowong 4066": the town and postcode printed with the address, to tell customers apart. */
  area: string | null;
  postcode: string | null;
  totalCents: number | null;
};

/** O→0, I/l/|→1, S→5 inside what should be digits. */
const digits = (s: string) => s.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/S/g, "5");

const SUPPLIER = /foodpac|distribution|pty|ltd|invoice|tax|abn|bsb|account|page/i;

export function parseInvoiceText(text: string): InvoiceText {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const all = lines.join("\n");

  // "INV002276" (the footer repeats it, often clearer than the header).
  const inv = [...all.matchAll(/\bI[NM]V[\s-]?([0-9OoIl|]{4,10})\b/g)].map((m) => `INV${digits(m[1])}`);
  const invoiceNumber = mostCommon(inv);

  // "SALES ORDER SO002343", which comes out as S0002343: the second letter is always O.
  const so = [...all.matchAll(/\bS[O0o]([0-9OoIl|]{4,10})\b/g)].map((m) => `SO${digits(m[1])}`);
  const salesOrderNumber = mostCommon(so);

  // The customer: the line printed above BILL TO / SHIP TO (below the INVOICE heading).
  let customerName: string | null = null;
  const billAt = lines.findIndex((l) => /\b(bill|ship)\s*to\b/i.test(l));
  if (billAt > 0) {
    for (let i = billAt - 1; i >= Math.max(0, billAt - 3); i--) {
      const l = lines[i].replace(/^[^A-Za-z0-9一-鿿(]+|[^A-Za-z0-9一-鿿)]+$/g, "");
      if (l.length >= 3 && /[A-Za-z一-鿿]{2}/.test(l) && !SUPPLIER.test(l)) {
        customerName = l;
        break;
      }
    }
  }

  // "Toowong, 4066" under the address.
  let area: string | null = null;
  let postcode: string | null = null;
  const place = /\b([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)*),?\s+(?:(?:QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\s+)?(\d{4})\b/.exec(lines.slice(Math.max(0, billAt), billAt + 6).join("\n"));
  if (place && !/date|due|term/i.test(place[1])) {
    area = `${place[1]} ${place[2]}`;
    postcode = place[2];
  }

  // "Invoice Amount $300.83", else "Amount Due $300.83".
  const money = (re: RegExp) => {
    const m = re.exec(all);
    return m ? Math.round(Number(m[1].replace(/,/g, "")) * 100) : null;
  };
  const totalCents = money(/Invoice Amount[^\n$]*\$\s?([\d,]+\.\d{2})/i) ?? money(/Amount Due[^\n$]*\$\s?([\d,]+\.\d{2})/i);

  return { invoiceNumber, salesOrderNumber, customerName, area, postcode, totalCents };
}

function mostCommon(list: string[]) {
  if (!list.length) return null;
  const count = new Map<string, number>();
  for (const x of list) count.set(x, (count.get(x) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0][0];
}

/** How alike two names are, 0–1 (letter pairs in common), ignoring case, spaces and punctuation. */
export function nameLikeness(a: string, b: string) {
  const pairs = (s: string) => {
    const t = s.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "");
    const out = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) ?? 0) + 1);
    return { out, n: Math.max(0, t.length - 1) };
  };
  const x = pairs(a);
  const y = pairs(b);
  if (!x.n || !y.n) return 0;
  let same = 0;
  for (const [k, v] of x.out) same += Math.min(v, y.out.get(k) ?? 0);
  return (2 * same) / (x.n + y.n);
}
