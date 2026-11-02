"use client";

import { Download, FileUp, ImageIcon, PackagePlus, Pencil, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { adjustStock, deleteProduct, saveProduct } from "@/app/actions/products";
import { FormError, Modal, SubmitButton, Toast, type ToastMessage } from "@/components/client-ui";
import { Badge, btn, Card, cx, EmptyState, Field, inputCls, PageHeader } from "@/components/ui";
import { aud } from "@/lib/money";
import { TEMPLATE_HEADERS, toCsv } from "@/lib/product-import";

type Product = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  description: string;
  packSize: string;
  unit: string;
  priceCents: number;
  gst: boolean;
  minQty: number;
  stock: number;
  featured: boolean;
  active: boolean;
  hasImage: boolean;
};

const LOW_STOCK = 10;

export function ProductsClient({ products, categories, isAdmin }: { products: Product[]; categories: string[]; isAdmin: boolean }) {
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "inactive">("all");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const router = useRouter();
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter(
      (p) =>
        (filter === "all" || (filter === "low" ? p.active && p.stock < LOW_STOCK : !p.active)) &&
        (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.barcode?.includes(s)),
    );
  }, [products, q, filter]);
  const low = products.filter((p) => p.active && p.stock < LOW_STOCK).length;

  return (
    <>
      <PageHeader
        title="Products & Stock"
        subtitle="What customers can order in the online shop. Stock is reserved when an order is placed and returned if it's cancelled."
        actions={
          <>
            {products.length > 0 && (
              <button className={btn("secondary")} onClick={() => exportCsv(products)} title="Edit in Excel and import again to update in bulk">
                <Download className="size-4" /> Export CSV
              </button>
            )}
            <Link href="/admin/products/import" className={btn("secondary")}>
              <FileUp className="size-4" /> Import
            </Link>
            <button className={btn("primary")} onClick={() => setEditing("new")}>
              <Plus className="size-4" /> Add product
            </button>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, SKU, barcode" className={cx(inputCls, "pl-9")} />
        </div>
        {(["all", "low", "inactive"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cx(btn(filter === f ? "primary" : "ghost", "sm"))}>
            {f === "all" ? `All (${products.length})` : f === "low" ? `Low stock (${low})` : "Hidden"}
          </button>
        ))}
      </div>
      {products.length === 0 ? (
        <Card>
          <EmptyState icon={PackagePlus} title="No products yet">
            Add your range so customers can order online, one by one or{" "}
            <Link href="/admin/products/import" className="font-medium text-blue-700 hover:underline">
              all at once from a spreadsheet
            </Link>
            .
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Product</th>
                <th className="px-2 py-2.5 font-medium">Category</th>
                <th className="px-2 py-2.5 text-right font-medium">Price ex GST</th>
                <th className="px-2 py-2.5 text-right font-medium">Stock</th>
                <th className="px-2 py-2.5 font-medium">Receive / adjust</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className={cx("border-b border-line last:border-0", !p.active && "opacity-55")}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100 text-slate-400">
                        {/* eslint-disable-next-line @next/next/no-img-element -- our own API */}
                        {p.hasImage ? <img src={`/api/products/${p.id}/image`} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4" />}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">
                          {p.name} {p.featured && <Badge tone="violet">Featured</Badge>} {!p.active && <Badge>Hidden</Badge>}
                        </p>
                        <p className="text-xs text-slate-500">
                          {p.sku} · {p.packSize} · per {p.unit}
                          {p.minQty > 1 && ` · min ${p.minQty}`}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-slate-600">{p.category}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {aud(p.priceCents)}
                    {!p.gst && <span className="block text-[11px] text-slate-400">GST free</span>}
                  </td>
                  <td className={cx("px-2 py-2.5 text-right font-semibold tabular-nums", p.stock <= 0 ? "text-red-600" : p.stock < LOW_STOCK ? "text-amber-700" : "text-slate-900")}>{p.stock}</td>
                  <td className="px-2 py-2.5">
                    <StockAdjust id={p.id} onResult={(t) => (setToast(t), router.refresh())} />
                  </td>
                  <td className="pr-3">
                    <div className="flex">
                      <button className={btn("ghost", "icon")} onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                        <Pencil className="size-3.5" />
                      </button>
                      {isAdmin && (
                        <button
                          className={btn("ghost", "icon", "text-slate-400 hover:text-red-600")}
                          aria-label={`Delete ${p.name}`}
                          onClick={async () => {
                            if (!confirm(`Delete ${p.name} (${p.sku})?\n\nIt leaves the shop, carts and customer price lists. Past orders keep its name and SKU.`)) return;
                            const r = await deleteProduct(p.id);
                            setToast({ id: Date.now(), text: r.ok ? (r.message ?? "Deleted") : r.error, tone: r.ok ? "ok" : "warn" });
                            if (r.ok) router.refresh();
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Modal wide open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add product" : "Edit product"}>
        {editing !== null && (
          <ProductForm
            product={editing === "new" ? null : editing}
            categories={categories}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        )}
      </Modal>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}

/** Same columns as the import template, so the file can be edited in Excel and imported back. */
function exportCsv(products: Product[]) {
  const yn = (b: boolean) => (b ? "yes" : "no");
  const csv = toCsv([
    TEMPLATE_HEADERS,
    ...products.map((p) => [p.sku, p.name, (p.priceCents / 100).toFixed(2), p.category, p.packSize, p.unit, p.minQty, p.stock, p.barcode ?? "", p.description, yn(p.gst), yn(p.featured), yn(p.active)]),
  ]);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  Object.assign(document.createElement("a"), { href: url, download: `foodpac-products-${new Date().toISOString().slice(0, 10)}.csv` }).click();
  URL.revokeObjectURL(url);
}

function StockAdjust({ id, onResult }: { id: string; onResult: (t: ToastMessage) => void }) {
  const [v, setV] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(v);
        start(async () => {
          const r = await adjustStock(id, n);
          onResult({ id: Date.now(), text: r.ok ? (r.message ?? "Updated") : r.error, tone: r.ok ? "ok" : "warn" });
          if (r.ok) setV("");
        });
      }}
    >
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="+24 / −2" inputMode="numeric" className={cx(inputCls, "h-8 w-24")} />
      <button disabled={pending || !v} className={btn("secondary", "sm")}>
        Apply
      </button>
    </form>
  );
}

function ProductForm({ product: p, categories, onDone }: { product: Product | null; categories: string[]; onDone: () => void }) {
  const [state, action] = useActionState(saveProduct, undefined);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {p && <input type="hidden" name="id" value={p.id} />}
      <Field label="Product name" className="sm:col-span-2">
        <input name="name" required defaultValue={p?.name} className={inputCls} />
      </Field>
      <Field label="SKU">
        <input name="sku" required defaultValue={p?.sku} className={cx(inputCls, "uppercase")} />
      </Field>
      <Field label="Barcode (optional)">
        <input name="barcode" defaultValue={p?.barcode ?? ""} className={inputCls} />
      </Field>
      <Field label="Category">
        <input name="category" list="categories" defaultValue={p?.category ?? categories[0]} className={inputCls} />
        <datalist id="categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="Pack size" hint="e.g. 10 kg / carton, 500 pcs / carton">
        <input name="packSize" defaultValue={p?.packSize} className={inputCls} />
      </Field>
      <Field label="Sold by (unit)">
        <input name="unit" defaultValue={p?.unit ?? "carton"} className={inputCls} />
      </Field>
      <Field label="List price per unit, ex GST ($)" hint="Customers with their own price see that instead.">
        <input name="price" required inputMode="decimal" defaultValue={p ? (p.priceCents / 100).toFixed(2) : ""} className={inputCls} />
      </Field>
      <Field label="Minimum order (units)">
        <input name="minQty" type="number" min={1} defaultValue={p?.minQty ?? 1} className={inputCls} />
      </Field>
      <Field label="Stock on hand" hint="Available to sell. Orders reserve from this.">
        <input name="stock" type="number" min={0} defaultValue={p?.stock ?? 0} className={inputCls} />
      </Field>
      <Field label="Description" className="sm:col-span-2">
        <textarea name="description" rows={3} defaultValue={p?.description} className={cx(inputCls, "h-auto py-2")} />
      </Field>
      <Field label="Photo (JPEG, PNG or WebP, max 4 MB)" className="sm:col-span-2">
        <input name="image" type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" />
      </Field>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm sm:col-span-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="gst" defaultChecked={p?.gst ?? true} /> GST applies
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="featured" defaultChecked={p?.featured ?? false} /> Featured on homepage
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> Show in shop
        </label>
        {p?.hasImage && (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="removeImage" /> Remove photo
          </label>
        )}
      </div>
      <div className="sm:col-span-2">
        <FormError message={state && !state.ok ? state.error : null} />
      </div>
      <SubmitButton className="sm:col-span-2">{p ? "Save product" : "Add product"}</SubmitButton>
    </form>
  );
}
