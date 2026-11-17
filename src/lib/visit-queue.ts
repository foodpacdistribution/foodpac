// Visits logged with no signal wait on the phone (IndexedDB, photos and all) and send themselves
// once it's back. Browser only. Each visit carries the id it was given on the phone, so sending
// it twice (the signal dropped after the server saved it) keeps it once.

import { logVisit } from "@/app/actions/visits";

export type QueuedVisit = {
  id: string;
  /** For the "waiting to send" list. */
  name: string;
  /** The form's fields, as sent (customerId, outcome, note, at, clientId…). */
  fields: Record<string, string>;
  photos: Blob[];
  /** When it was put in the queue. */
  queuedAt: number;
  /** The server turned it down (not a lost signal): kept to show, not resent by itself. */
  error?: string;
};

/** Fired on window whenever the queue changes. */
export const QUEUE_EVENT = "visit-queue";

const DB_NAME = "foodpac-offline";
const STORE = "visits";

function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

const changed = () => window.dispatchEvent(new Event(QUEUE_EVENT));

export async function queuedVisits() {
  const all = await run<QueuedVisit[]>("readonly", (s) => s.getAll());
  return all.sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function queueVisit(v: Omit<QueuedVisit, "queuedAt">) {
  await run("readwrite", (s) => s.put({ ...v, queuedAt: Date.now() }));
  changed();
}

export async function dropQueuedVisit(id: string) {
  await run("readwrite", (s) => s.delete(id));
  changed();
}

/** The form as the server action takes it. */
export function visitForm(fields: Record<string, string>, photos: Blob[]) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  photos.forEach((p, i) => fd.append("photo", p instanceof File ? p : new File([p], `photo-${i + 1}.jpg`, { type: p.type || "image/jpeg" })));
  return fd;
}

/** A failure to reach the server at all (no signal), as opposed to the server saying no. */
export const isOffline = (err: unknown) => !navigator.onLine || err instanceof TypeError;

let flushing: Promise<{ sent: number; failed: number }> | null = null;

/**
 * Sends what's waiting, oldest first. Stops at the first lost connection (still no signal);
 * a visit the server turns down is kept with its reason, and the rest go on.
 */
export function sendQueuedVisits() {
  flushing ??= (async () => {
    let sent = 0;
    let failed = 0;
    try {
      for (const v of await queuedVisits()) {
        if (v.error) continue;
        try {
          const r = await logVisit(visitForm(v.fields, v.photos));
          if (r.ok) {
            await run("readwrite", (s) => s.delete(v.id));
            sent++;
          } else {
            await run("readwrite", (s) => s.put({ ...v, error: r.error }));
            failed++;
          }
        } catch (err) {
          if (isOffline(err)) break;
          throw err;
        }
      }
    } finally {
      flushing = null;
      changed();
    }
    return { sent, failed };
  })();
  return flushing;
}
