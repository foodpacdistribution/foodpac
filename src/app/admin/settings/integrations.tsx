"use client";

import { Check, Copy, KeyRound, Link2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { createKey, deleteFeed, revokeKey, saveFeed, syncFeedNow } from "@/app/actions/settings";
import { FormError, Modal, SubmitButton } from "@/components/client-ui";
import { Badge, btn, Card, CardHeader, cx, Field, inputCls } from "@/components/ui";
import type { FeedResult } from "@/lib/db/schema";
import { Tx, useT } from "@/components/i18n";

type Key = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revoked: boolean };
type Feed = {
  id: string;
  name: string;
  url: string;
  format: "csv" | "json";
  dateMode: "today" | "tomorrow";
  enabled: boolean;
  hasAuth: boolean;
  mapping: Record<string, string>;
  lastResult: FeedResult | null;
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "never");

export function IntegrationsCard({ keys, feeds }: { keys: Key[]; feeds: Feed[] }) {
  const tr = useT();
  const [pending, startTransition] = useTransition();
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<Feed | "new" | null>(null);
  // Server render has no window; the snapshot pair keeps hydration consistent.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "https://your-domain",
  );

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string; data?: unknown }>, after?: (d: unknown) => void) =>
    startTransition(async () => {
      const r = await fn();
      setNotice(r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r.error ?? "Failed" });
      if (r.ok && after) after(r.data);
    });

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Link2 className="size-4 text-slate-400" /> {" "}{tr("Order sync")}</span>
        }
        subtitle={tr("Let other systems push orders in, or pull them automatically from a CSV/JSON link.")}
      />
      {notice && (
        <p className={cx("border-b border-line px-4 py-2 text-xs", notice.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700")}>{<Tx>{notice.text}</Tx>}</p>
      )}

      {/* API keys */}
      <div className="space-y-3 border-b border-line p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <KeyRound className="size-3.5" /> {" "}{tr("API keys")}</p>
        {newKey && (
          <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
            <p className="text-xs font-medium text-amber-900">{tr("Copy this key now — it won't be shown again.")}</p>
            <div className="mt-2 flex gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1.5 font-mono text-xs ring-1 ring-amber-200">{newKey}</code>
              <button
                className={btn("secondary", "sm")}
                onClick={async () => {
                  await navigator.clipboard.writeText(newKey);
                  setCopied(true);
                }}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? tr("Copied") : tr("Copy")}
              </button>
            </div>
          </div>
        )}
        <ul className="divide-y divide-line rounded-lg border border-line">
          {keys.length === 0 && <li className="px-3 py-2.5 text-xs text-slate-400">{tr("No API keys yet.")}</li>}
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">
                  {k.name} <code className="ml-1 text-xs text-slate-400">{k.prefix}…</code>
                </p>
                <p className="text-[11px] text-slate-500">
                  {tr("Created")}{" "}{tr(when(k.createdAt))} {" "}{tr("· last used")}{" "}{tr(when(k.lastUsedAt))}
                </p>
              </div>
              {k.revoked ? (
                <Badge>{tr("Revoked")}</Badge>
              ) : (
                <button
                  className={btn("ghost", "sm", "text-red-600")}
                  disabled={pending}
                  onClick={() => confirm(`Revoke "${k.name}"? Systems using it will stop syncing.`) && run(() => revokeKey(k.id))}
                >
                  {tr("Revoke")}</button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder={tr("Key name, e.g. Shopify / ERP")} className={inputCls} />
          <button
            className={btn("secondary")}
            disabled={pending}
            onClick={() =>
              run(
                () => createKey(keyName),
                (key) => {
                  setNewKey(key as string);
                  setCopied(false);
                  setKeyName("");
                },
              )
            }
          >
            <Plus className="size-4" /> {" "}{tr("Create")}</button>
        </div>
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-blue-700">{tr("How to use the API")}</summary>
          <div className="mt-2 space-y-2">
            <p>{tr("Send orders (created or updated by order number + date):")}</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{<Tx>{`curl -X POST ${origin}/api/v1/orders \\
  -H "Authorization: Bearer dp_..." \\
  -H "Content-Type: application/json" \\
  -d '{"orders":[{"orderNumber":"A1001","customerName":"Acme",
       "address":"12 Example St","suburb":"Toowong","postcode":"4066",
       "deliveryDate":"2026-10-28","timeWindow":"9am-12pm","demand":2}]}'`}</Tx>}</pre>
            <p>
              {tr("Read delivery status:")}{" "}<code>GET /api/v1/orders?date=YYYY-MM-DD</code> {" "}{tr("· cancel:")}{" "}<code>DELETE /api/v1/orders/A1001?date=YYYY-MM-DD</code>
            </p>
            <p>{tr("Orders already planned or out for delivery are not changed by updates (reported as \"locked\").")}</p>
          </div>
        </details>
      </div>

      {/* Feeds */}
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <RefreshCw className="size-3.5" /> {" "}{tr("Scheduled feeds")}</p>
          <button className={btn("secondary", "sm")} onClick={() => setEditing("new")}>
            <Plus className="size-3.5" /> {" "}{tr("Add feed")}</button>
        </div>
        {feeds.length === 0 ? (
          <p className="text-xs text-slate-500">
            {tr("A feed is a URL your order system exports to (CSV or JSON). It is pulled every 15 minutes in production, or on demand.")}</p>
        ) : (
          <ul className="space-y-2">
            {feeds.map((f) => (
              <li key={f.id} className="rounded-lg border border-line px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                    {f.name} <span className="font-normal text-slate-400">· {f.format.toUpperCase()}</span>
                  </p>
                  {!f.enabled && <Badge>{tr("Paused")}</Badge>}
                  <button className={btn("secondary", "sm")} disabled={pending} onClick={() => run(() => syncFeedNow(f.id))}>
                    <RefreshCw className={cx("size-3.5", pending && "animate-spin")} /> {" "}{tr("Sync now")}</button>
                  <button className={btn("ghost", "icon")} onClick={() => setEditing(f)} aria-label={`Edit ${f.name}`}>
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    className={btn("ghost", "icon", "text-slate-400 hover:text-red-600")}
                    onClick={() => confirm(`Remove feed "${f.name}"?`) && run(() => deleteFeed(f.id))}
                    aria-label={`Remove ${f.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">{f.url}</p>
                {f.lastResult && (
                  <p className={cx("mt-1 text-[11px]", f.lastResult.ok ? "text-slate-600" : "text-red-600")}>
                    {tr("Last run")}{" "}{tr(when(f.lastResult.at))}:{" "}
                    {f.lastResult.ok
                      ? tr(`${f.lastResult.inserted} new, ${f.lastResult.updated} updated, ${f.lastResult.skipped} locked, ${f.lastResult.errors} errors`)
                      : f.lastResult.message}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add order feed" : "Edit order feed"} wide>
        {editing !== null && (
          <FeedForm key={editing === "new" ? "new" : editing.id} feed={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
        )}
      </Modal>
    </Card>
  );
}

function FeedForm({ feed, onDone }: { feed: Feed | null; onDone: () => void }) {
  const tr = useT();
  const [state, action] = useActionState(saveFeed, undefined);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="space-y-4">
      {feed && <input type="hidden" name="id" value={feed.id} />}
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <Field label={tr("Name")}>
          <input name="name" required defaultValue={feed?.name} placeholder={tr("ERP daily export")} className={inputCls} />
        </Field>
        <Field label={tr("Format")}>
          <select name="format" defaultValue={feed?.format ?? "csv"} className={inputCls}>
            <option value="csv">{tr("CSV")}</option>
            <option value="json">{tr("JSON")}</option>
          </select>
        </Field>
      </div>
      <Field label={tr("URL")}>
        <input name="url" type="url" required defaultValue={feed?.url} placeholder={tr("https://erp.example.com/exports/deliveries.csv")} className={inputCls} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("Authorization header (optional)")} hint={feed?.hasAuth ? "Saved. Leave blank to keep, type - to remove" : "e.g. Bearer abc123"}>
          <input name="authHeader" type="password" autoComplete="off" className={inputCls} />
        </Field>
        <Field label={tr("Rows without a date are for")}>
          <select name="dateMode" defaultValue={feed?.dateMode ?? "today"} className={inputCls}>
            <option value="today">{tr("Today")}</option>
            <option value="tomorrow">{tr("Tomorrow")}</option>
          </select>
        </Field>
      </div>
      <Field
        label={tr("Column mapping (optional JSON)")}
        hint={tr("Leave blank to auto-detect columns. Fields: orderNumber, customerName, address, suburb, postcode, phone, deliveryDate, timeWindow, windowStart, windowEnd, serviceMin, demand, priority, notes, depot")}
      >
        <textarea
          name="mapping"
          rows={3}
          defaultValue={feed && Object.keys(feed.mapping).length ? JSON.stringify(feed.mapping, null, 2) : ""}
          placeholder={tr("{\"orderNumber\": \"SO Number\", \"address\": \"Ship To Street\"}")}
          className={cx(inputCls, "h-auto py-2 font-mono text-xs")}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="enabled" defaultChecked={feed?.enabled ?? true} /> {" "}{tr("Pull automatically on schedule")}</label>
      <FormError message={state && !state.ok ? state.error : null} />
      <div className="flex justify-end border-t border-line pt-4">
        <SubmitButton>{feed ? tr("Save feed") : tr("Add feed")}</SubmitButton>
      </div>
    </form>
  );
}
