// Search-as-you-type over the catalogue in the browser. Client-safe.

export type SearchEntry = {
  id: string;
  sku: string;
  name: string;
  category: string;
  packSize: string;
  barcode: string | null;
  hasImage: boolean;
  updatedAt: string;
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/**
 * Best `limit` products for `query`: every word must appear in the SKU, barcode, name, pack size
 * or category. Exact SKU/barcode first, then SKU starting with it, then names starting with it,
 * then the rest in catalogue order.
 */
export function matchProducts(entries: SearchEntry[], query: string, limit = 6): SearchEntry[] {
  const q = norm(query.trim());
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: { e: SearchEntry; score: number; i: number }[] = [];
  entries.forEach((e, i) => {
    const sku = norm(e.sku);
    const barcode = norm(e.barcode ?? "");
    const name = norm(e.name);
    const hay = `${sku} ${barcode} ${name} ${norm(e.packSize)} ${norm(e.category)}`;
    if (!words.every((w) => hay.includes(w))) return;
    const score =
      sku === q || (barcode && barcode === q) ? 0 : sku.startsWith(q) ? 1 : name.startsWith(q) ? 2 : name.split(/\s+/).some((w) => w.startsWith(words[0])) ? 3 : 4;
    scored.push({ e, score, i });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.e);
}
