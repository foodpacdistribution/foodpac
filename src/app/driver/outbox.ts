// Finished stops waiting to reach the office. A delivery (signature, photo, location, the time
// it was done) is kept on the phone first and then uploaded, again and again until the server
// has it, so a customer signs once even where there's no signal. Kept in IndexedDB, so it
// survives the page being closed or reloaded; it uploads the next time the driver app is open.

import { useEffect, useSyncExternalStore } from "react";

export type OutboxItem = {
  id: string;
  stopId: string;
  /** A finished stop, or photos added to one afterwards. */
  kind: "delivered" | "failed" | "photos";
  /** Customer or order, for the driver's list. */
  name: string;
  /** When the driver confirmed (phone clock, ms). */
  doneAt: number;
  fields: [string, string][];
  files: { field: string; name: string; type: string; data: ArrayBuffer }[];
  /** Why the last try didn't go through. */
  error: string | null;
  /** The server turned it down for good: retrying won't help, the driver has to look at it. */
  rejected: boolean;
};

const DB_NAME = "dp-driver";
const STORE = "outbox";

let items: OutboxItem[] = [];
let loaded = false;
let saved = true; // false when this phone won't keep it across a reload (IndexedDB blocked).
let sending = false;
let again = false; // Asked to send while already sending: go round once more after.
const listeners = new Set<() => void>();
const sentListeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const stored = await tx<OutboxItem[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxItem[]>);
    const known = new Set(items.map((i) => i.id));
    items = [...items, ...stored.filter((i) => !known.has(i.id))].sort((a, b) => a.doneAt - b.doneAt);
    emit();
  } catch {
    saved = false;
    emit();
  }
}

async function put(item: OutboxItem) {
  items = [...items.filter((i) => i.id !== item.id), item].sort((a, b) => a.doneAt - b.doneAt);
  emit();
  try {
    await tx("readwrite", (s) => s.put(item));
  } catch {
    saved = false;
    emit();
  }
}

async function remove(id: string) {
  items = items.filter((i) => i.id !== id);
  emit();
  try {
    await tx("readwrite", (s) => s.delete(id));
  } catch {
    // Already gone from the list; a leftover copy would only be re-sent and taken as done.
  }
}

const newId = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Keeps a finished stop on the phone, then starts uploading it. */
export async function addToOutbox(form: FormData, meta: { stopId: string; kind: "delivered" | "failed"; name: string }) {
  const at = Date.now();
  const fields: OutboxItem["fields"] = [];
  const files: OutboxItem["files"] = [];
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") fields.push([k, v]);
    else if (v.size) files.push({ field: k, name: v.name, type: v.type, data: await v.arrayBuffer() });
  }
  fields.push(["kind", meta.kind], ["doneAt", String(at)]);
  await load();
  await put({ id: newId(), ...meta, doneAt: at, fields, files, error: null, rejected: false });
  void sendOutbox();
}

/** Keeps photos for a stop that's already finished on the phone, then starts uploading them (after the stop itself, if that's still waiting). */
export async function addPhotosToOutbox(files: File[], meta: { stopId: string; name: string }) {
  const at = Date.now();
  const stored: OutboxItem["files"] = [];
  for (const f of files) if (f.size) stored.push({ field: "photo", name: f.name, type: f.type, data: await f.arrayBuffer() });
  if (!stored.length) return;
  await load();
  await put({ id: newId(), ...meta, kind: "photos", doneAt: at, fields: [["stopId", meta.stopId]], files: stored, error: null, rejected: false });
  void sendOutbox();
}

/** Uploads what's waiting, oldest first. Stops at the first one that can't get through (no signal). */
export async function sendOutbox() {
  await load();
  if (sending) {
    again = true;
    return;
  }
  sending = true;
  again = false;
  let sent = 0;
  let noSignal = false;
  try {
    for (const item of items.filter((i) => !i.rejected)) {
      const form = new FormData();
      for (const [k, v] of item.fields) form.append(k, v);
      for (const f of item.files) form.append(f.field, new File([f.data], f.name, { type: f.type }));
      let res: Response;
      try {
        res = await fetch(item.kind === "photos" ? "/api/driver/photos" : "/api/driver/outcome", { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
      } catch {
        await put({ ...item, error: "No signal yet" });
        noSignal = true;
        break;
      }
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; retry?: boolean } | null;
      if (res.ok && body?.ok) {
        await remove(item.id);
        sent++;
        continue;
      }
      const retry = body ? body.retry !== false : true;
      await put({ ...item, error: body?.error ?? `Upload failed (${res.status})`, rejected: !retry });
      // Signed out or server trouble: the rest would fail the same way.
      if (retry) {
        noSignal = true;
        break;
      }
    }
  } finally {
    sending = false;
    emit();
  }
  if (sent) sentListeners.forEach((l) => l());
  if (again && !noSignal) void sendOutbox();
}

/** Takes a turned-down delivery off the phone (after the driver has dealt with it another way). */
export const discardFromOutbox = (id: string) => remove(id);

/** Sends a turned-down delivery again (e.g. after the office fixed the stop). */
export async function retryFromOutbox(id: string) {
  const item = items.find((i) => i.id === id);
  if (item) await put({ ...item, rejected: false, error: null });
  void sendOutbox();
}

const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
const empty: OutboxItem[] = [];

/**
 * What's waiting on this phone. Keeps uploading while the driver app is open: now, whenever
 * the phone gets signal back or the app comes back on screen, and every 20 seconds.
 * `onSent` runs after anything went through, to refresh the route from the server.
 */
export function useOutbox(onSent?: () => void) {
  const list = useSyncExternalStore(subscribe, () => items, () => empty);
  const persistent = useSyncExternalStore(subscribe, () => saved, () => true);
  const busy = useSyncExternalStore(subscribe, () => sending, () => false);
  useEffect(() => {
    void sendOutbox();
    const kick = () => void sendOutbox();
    const onVisible = () => document.visibilityState === "visible" && kick();
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => items.some((i) => !i.rejected) && kick(), 20_000);
    return () => {
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!onSent) return;
    sentListeners.add(onSent);
    return () => void sentListeners.delete(onSent);
  }, [onSent]);
  // Only kept in memory on this phone: warn before the page is closed with something unsent.
  useEffect(() => {
    if (persistent || !list.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [persistent, list.length]);
  return { items: list, persistent, busy };
}
