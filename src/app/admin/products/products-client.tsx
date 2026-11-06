"use client";

import { Clock, Download, Eye, EyeOff, FileUp, ImageIcon, PackagePlus, Pencil, Percent, Phone, Plus, Search, Star, Tag, Trash2 } from "lucide-react";
import Link from "@/components/link";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { adjustStock, bulkProducts, deleteProduct, type ProductBulkOp, saveProduct } from "@/app/actions/products";
import { FormError, Modal, SubmitButton, Toast, type ToastMessage, KeptForm, useKeptForm } from "@/components/client-ui";
import { Badge, btn, Card, cx, EmptyState, Field, inputCls, PageHeader } from "@/components/ui";
import { aud } from "@/lib/money";
import { prettyDate } from "@/lib/dates";
import { LOW_STOCK } from "@/lib/stock";
import { TEMPLATE_HEADERS, toCsv } from "@/lib/product-import";
import { useT } from "@/components/i18n";
import { ImageInput } from "@/components/image-input";

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
  /** Versioned, so a new photo shows straight away. */
  imageUrl: string | null;
  /** Orders waiting for this product, oldest first. */
  waiting: Waiting[];
};

type Waiting = { orderId: string; number: string; customer: string; phone: string | null; qty: number; deliveryDate: string };
const waitingQty = (p: Product) => p.waiting.reduce((n, w) => n + w.qty, 0);


type ActionResult = { ok: boolean; message?: string; error?: string };
const toastFor = (r: ActionResult): ToastMessage => ({ id: Date.now(), text: r.ok ? (r.message ?? "Updated") : (r.error ?? "Something went wrong"), tone: r.ok ? "ok" : "warn" });

export function ProductsClient({ products, categories, isAdmin }: { products: Product[]; categories: string[]; isAdmin: boolean }) {
  const tr = useT();
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "waiting" | "inactive">("all");
  const [showWaiting, setShowWaiting] = useState<Product | null>(null);
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [pending, start] = useTransition();
  const deferredQ = useDeferredValue(q);
  const shown = useMemo(() => {
    const s = deferredQ.trim().toLowerCase();
    return products.filter(
      (p) =>
        (filter === "all" || (filter === "low" ? p.active && p.stock <= LOW_STOCK : filter === "waiting" ? p.waiting.length > 0 : !p.active)) &&
        (!category || p.category === category) &&
        (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.barcode?.includes(s)),
    );
  }, [products, deferredQ, filter, category]);
  const low = products.filter((p) => p.active && p.stock <= LOW_STOCK).length;
  const hidden = products.filter((p) => !p.active).length;
  const waitingCount = products.filter((p) => p.waiting.length > 0).length;
  const usedCategories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products]);
  // Only rows still on screen count as selected, so a filter change can't act on hidden rows.
  const ids = shown.filter((p) => selected.has(p.id)).map((p) => p.id);
  const allShown = shown.length > 0 && shown.every((p) => selected.has(p.id));
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const report = (r: ActionResult) => setToast(toastFor(r));

  const bulk = (op: ProductBulkOp) =>
    start(async () => {
      const r = await bulkProducts(ids, op);
      report(r);
      if (r.ok && op.kind === "delete") setSelected(new Set());
    });

  const remove = async (p: Product) => {
    if (!confirm(tr("Delete {name} ({sku})?\n\nIt leaves the shop, carts and customer price lists. Past orders keep its name and SKU.", { name: p.name, sku: p.sku }))) return;
    const r = await deleteProduct(p.id);
    report(r);
  };

  return (
    <>
      <PageHeader
        title={tr("Products & Stock")}
        subtitle={tr("What customers can order in the online shop. Stock is reserved when an order is placed and returned if it's cancelled.")}
        actions={
          <>
            {products.length > 0 && (
              <button className={btn("secondary")} onClick={() => exportCsv(products)} title={tr("Edit in Excel and import again to update in bulk")}>
                <Download className="size-4" /> {" "}{tr("Export CSV")}</button>
            )}
            <Link href="/admin/products/import" className={btn("secondary")}>
              <FileUp className="size-4" /> {" "}{tr("Import")}</Link>
            <button className={btn("primary")} onClick={() => setEditing("new")}>
              <Plus className="size-4" /> {" "}{tr("Add product")}</button>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search name, SKU, barcode")} className={cx(inputCls, "pl-9")} />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={cx(inputCls, "sm:w-56")} aria-label={tr("Category")}>
          <option value="">{tr("All categories")}</option>
          {usedCategories.map((c) => (
            <option key={c} value={c}>
              {tr(c)}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {(["all", "low", "waiting", "inactive"] as const).map((f) =>
            f === "waiting" && !waitingCount ? null : (
              <button key={f} onClick={() => setFilter(f)} className={cx(btn(filter === f ? "primary" : "ghost", "sm"), f === "waiting" && filter !== f && "text-red-600")}>
                {f === "all" ? tr(`All (${products.length})`) : f === "low" ? tr(`Low stock (${low})`) : f === "waiting" ? tr("Waiting for stock ({n})", { n: waitingCount }) : tr(`Hidden (${hidden})`)}
              </button>
            ),
          )}
        </div>
      </div>

      {ids.length > 0 && (
        <div className="sticky top-28 z-20 mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50/95 px-3 py-2 shadow-sm backdrop-blur lg:top-2">
          <span className="mr-1 text-xs font-semibold text-blue-900">{tr("{n} selected", { n: ids.length })}</span>
          <button disabled={pending} onClick={() => bulk({ kind: "active", value: true })} className={btn("secondary", "sm")}>
            <Eye className="size-3.5" /> {tr("Show in shop")}
          </button>
          <button disabled={pending} onClick={() => bulk({ kind: "active", value: false })} className={btn("secondary", "sm")}>
            <EyeOff className="size-3.5" /> {tr("Hide")}
          </button>
          <button disabled={pending} onClick={() => bulk({ kind: "featured", value: true })} className={btn("secondary", "sm")}>
            <Star className="size-3.5" /> {tr("Feature")}
          </button>
          <button disabled={pending} onClick={() => bulk({ kind: "featured", value: false })} className={btn("secondary", "sm")}>
            {tr("Unfeature")}
          </button>
          <button
            disabled={pending}
            className={btn("secondary", "sm")}
            onClick={() => {
              const c = prompt(tr("Move to which category?"), category || usedCategories[0] || "");
              if (c?.trim()) bulk({ kind: "category", value: c });
            }}
          >
            <Tag className="size-3.5" /> {tr("Category")}
          </button>
          <button
            disabled={pending}
            className={btn("secondary", "sm")}
            onClick={() => {
              const v = prompt(tr("Change prices by what percent? e.g. 5 for +5%, -10 for -10%"));
              if (v?.trim()) bulk({ kind: "price", percent: Number(v.replace("%", "")) });
            }}
          >
            <Percent className="size-3.5" /> {tr("Price")}
          </button>
          {isAdmin && (
            <button
              disabled={pending}
              className={btn("danger", "sm")}
              onClick={() => confirm(tr("Permanently delete {n} products? Past orders keep their names and SKUs.", { n: ids.length })) && bulk({ kind: "delete" })}
            >
              <Trash2 className="size-3.5" /> {tr("Delete")}
            </button>
          )}
          <button className={cx(btn("ghost", "sm"), "ml-auto")} onClick={() => setSelected(new Set())}>
            {tr("Clear")}
          </button>
        </div>
      )}

      {products.length === 0 ? (
        <Card>
          <EmptyState icon={PackagePlus} title={tr("No products yet")}>
            {tr("Add your range so customers can order online, one by one or")}{" "}
            <Link href="/admin/products/import" className="font-medium text-blue-700 hover:underline">
              {tr("all at once from a spreadsheet")}</Link>
            .
          </EmptyState>
        </Card>
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState icon={Search} title={tr("No products match")}>{tr("Try another search or filter.")}</EmptyState>
        </Card>
      ) : (
        <>
          {/* Phones: one card per product. */}
          <div className="space-y-2 md:hidden">
            <label className="flex items-center gap-2 px-1 text-xs text-slate-500">
              <input type="checkbox" checked={allShown} onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((p) => p.id)) : new Set())} />
              {tr("Select all")} ({shown.length})
            </label>
            {shown.map((p) => (
              <Card key={p.id} className={cx("p-3", !p.active && "opacity-60", selected.has(p.id) && "ring-2 ring-blue-400")}>
                <div className="flex gap-3">
                  <input type="checkbox" aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="mt-1" />
                  <Thumb p={p} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-snug text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-500">
                      {p.sku} · {tr(p.category)}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold tabular-nums">{aud(p.priceCents)}</span>
                      <span className={cx("text-xs font-semibold tabular-nums", stockTone(p.stock))}>
                        {tr("Stock")} {p.stock}
                      </span>
                      {p.waiting.length > 0 && <WaitingChip p={p} onClick={() => setShowWaiting(p)} />}
                      {p.featured && <Badge tone="violet">{tr("Featured")}</Badge>}
                      {!p.active && <Badge>{tr("Hidden")}</Badge>}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5 border-t border-line pt-2">
                  <StockAdjust id={p.id} onResult={setToast} />
                  <button className={cx(btn("ghost", "icon"), "ml-auto")} onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                    <Pencil className="size-4" />
                  </button>
                  {isAdmin && (
                    <button className={btn("ghost", "icon", "text-slate-400 hover:text-red-600")} aria-label={`Delete ${p.name}`} onClick={() => remove(p)}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              </Card>
            ))}
          </div>

          {/* Tablets and up: table. */}
          <Card className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-line bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <input type="checkbox" aria-label={tr("Select all")} checked={allShown} onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((p) => p.id)) : new Set())} />
                  </th>
                  <th className="px-2 py-2.5 font-medium">{tr("Product")}</th>
                  <th className="px-2 py-2.5 font-medium">{tr("Category")}</th>
                  <th className="px-2 py-2.5 text-right font-medium">{tr("Price ex GST")}</th>
                  <th className="px-2 py-2.5 text-right font-medium">{tr("Stock")}</th>
                  <th className="px-2 py-2.5 font-medium">{tr("Receive / adjust")}</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className={cx("border-b border-line last:border-0", !p.active && "opacity-55", selected.has(p.id) && "bg-blue-50/50")}>
                    <td className="px-3 py-2.5">
                      <input type="checkbox" aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-3">
                        <Thumb p={p} />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">
                            {p.name} {p.featured && <Badge tone="violet">{tr("Featured")}</Badge>} {!p.active && <Badge>{tr("Hidden")}</Badge>}
                          </p>
                          <p className="text-xs text-slate-500">
                            {p.sku} · {p.packSize} {" "}{tr("· per")}{" "}{tr(p.unit)}
                            {p.minQty > 1 && <> {tr(`· min ${p.minQty}`)}</>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-slate-600">{tr(p.category)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {aud(p.priceCents)}
                      {!p.gst && <span className="block text-[11px] text-slate-400">{tr("GST free")}</span>}
                    </td>
                    <td className={cx("px-2 py-2.5 text-right font-semibold tabular-nums", stockTone(p.stock))}>
                      {p.stock}
                      {p.waiting.length > 0 && (
                        <span className="mt-0.5 block">
                          <WaitingChip p={p} onClick={() => setShowWaiting(p)} />
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <StockAdjust id={p.id} onResult={setToast} />
                    </td>
                    <td className="pr-3">
                      <div className="flex">
                        <button className={btn("ghost", "icon")} onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                          <Pencil className="size-3.5" />
                        </button>
                        {isAdmin && (
                          <button className={btn("ghost", "icon", "text-slate-400 hover:text-red-600")} aria-label={`Delete ${p.name}`} onClick={() => remove(p)}>
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
        </>
      )}
      <Modal wide open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? tr("Add product") : tr("Edit product")}>
        {editing !== null && (
          <ProductForm
            product={editing === "new" ? null : editing}
            categories={categories}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
      <Modal open={showWaiting !== null} onClose={() => setShowWaiting(null)} title={showWaiting ? tr("Waiting for {name}", { name: showWaiting.name }) : ""}>
        {showWaiting && <WaitingList p={showWaiting} />}
      </Modal>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}

const stockTone = (stock: number) => (stock <= 0 ? "text-red-600" : stock <= LOW_STOCK ? "text-amber-700" : "text-slate-900");

function Thumb({ p }: { p: Product }) {
  return (
    <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100 text-slate-400">
      {/* eslint-disable-next-line @next/next/no-img-element -- our own API */}
      {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" /> : <ImageIcon className="size-4" />}
    </span>
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
  const tr = useT();
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
        {tr("Apply")}</button>
    </form>
  );
}

function ProductForm({ product: p, categories, onDone }: { product: Product | null; categories: string[]; onDone: () => void }) {
  const tr = useT();
  const [state, form] = useKeptForm(saveProduct);
  const [photo, setPhoto] = useState<string | null>(p?.imageUrl ?? null);
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  return (
    <KeptForm form={form} className="grid gap-4 sm:grid-cols-2">
      {p && <input type="hidden" name="id" value={p.id} />}
      <Field label={tr("Product name")} className="sm:col-span-2">
        <input name="name" required defaultValue={p?.name} className={inputCls} />
      </Field>
      <Field label={tr("SKU")}>
        <input name="sku" required defaultValue={p?.sku} className={cx(inputCls, "uppercase")} />
      </Field>
      <Field label={tr("Barcode (optional)")}>
        <input name="barcode" defaultValue={p?.barcode ?? ""} className={inputCls} />
      </Field>
      <Field label={tr("Category")}>
        <input name="category" list="categories" defaultValue={p?.category ?? categories[0]} className={inputCls} />
        <datalist id="categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label={tr("Pack size")} hint={tr("e.g. 10 kg / carton, 500 pcs / carton")}>
        <input name="packSize" defaultValue={p?.packSize} className={inputCls} />
      </Field>
      <Field label={tr("Sold by (unit)")}>
        <input name="unit" defaultValue={p?.unit ?? "carton"} className={inputCls} />
      </Field>
      <Field label={tr("List price per unit, ex GST ($)")} hint={tr("Customers with their own price see that instead.")}>
        <input name="price" required inputMode="decimal" defaultValue={p ? (p.priceCents / 100).toFixed(2) : ""} className={inputCls} />
      </Field>
      <Field label={tr("Minimum order (units)")}>
        <input name="minQty" type="number" min={1} defaultValue={p?.minQty ?? 1} className={inputCls} />
      </Field>
      <Field label={tr("Stock on hand")} hint={tr("Available to sell. Orders reserve from this.")}>
        <input name="stock" type="number" min={0} defaultValue={p?.stock ?? 0} className={inputCls} />
      </Field>
      <Field label={tr("Description")} className="sm:col-span-2">
        <textarea name="description" rows={3} defaultValue={p?.description} className={cx(inputCls, "h-auto py-2")} />
      </Field>
      <div className="flex items-center gap-4 sm:col-span-2">
        <span className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-slate-50 text-slate-300">
          {photo && !removing ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview or our own API
            <img src={photo} alt="" className="size-full object-contain" />
          ) : (
            <ImageIcon className="size-6" />
          )}
        </span>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-600">{tr("Photo")}</p>
          <ImageInput name="image" maxSide={1600} trimDarkBars label={p?.hasImage ? "Replace photo" : "Choose photo"} onPreview={(u) => setPhoto(u ?? p?.imageUrl ?? null)} />
          <p className="text-[11px] text-slate-400">{tr("Square photos on a white background look best in the shop. Large photos are shrunk automatically.")}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm sm:col-span-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="gst" defaultChecked={p?.gst ?? true} /> {" "}{tr("GST applies")}</label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="featured" defaultChecked={p?.featured ?? false} /> {" "}{tr("Featured on homepage")}</label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> {" "}{tr("Show in shop")}</label>
        {p?.hasImage && (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="removeImage" onChange={(e) => setRemoving(e.target.checked)} /> {" "}{tr("Remove photo")}</label>
        )}
      </div>
      <div className="sm:col-span-2">
        <FormError message={state && !state.ok ? state.error : null} />
      </div>
      <SubmitButton className="sm:col-span-2">{p ? tr("Save product") : tr("Add product")}</SubmitButton>
    </KeptForm>
  );
}

/** "12 waiting · 3 customers": tap to see who. */
function WaitingChip({ p, onClick }: { p: Product; onClick: () => void }) {
  const tr = useT();
  const customers = new Set(p.waiting.map((w) => w.customer)).size;
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-red-700 ring-1 ring-red-200 hover:bg-red-100">
      <Clock className="size-3" />
      {tr(customers === 1 ? "{n} waiting · 1 customer" : "{n} waiting · {c} customers", { n: waitingQty(p), c: customers })}
    </button>
  );
}

/** Who ordered a product that's out of stock, oldest first: the order stock goes to when it arrives. */
function WaitingList({ p }: { p: Product }) {
  const tr = useT();
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{tr("Stock you receive with + goes to these orders first, oldest first. What's left goes back on sale in the shop.")}</p>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {p.waiting.map((w) => (
          <li key={w.orderId} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{w.customer}</p>
              <p className="text-xs text-slate-500">
                <Link href={`/admin/sales/${w.orderId}`} className="font-medium text-blue-700 hover:underline">
                  {w.number}
                </Link>{" "}
                · {tr("delivery {date}", { date: tr(prettyDate(w.deliveryDate, { weekday: "short", day: "numeric", month: "short" })) })}
              </p>
            </div>
            {w.phone && (
              <a href={`tel:${w.phone.replace(/\s/g, "")}`} className={btn("ghost", "sm")} title={w.phone}>
                <Phone className="size-3.5" /> <span className="max-sm:sr-only">{w.phone}</span>
              </a>
            )}
            <span className="shrink-0 text-sm font-semibold text-red-700 tabular-nums">
              {w.qty} {tr(p.unit)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
