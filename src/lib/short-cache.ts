/**
 * One answer for everyone asking within `ttlMs`: several people with the same screen open then
 * cost one database read between them, and requests at the same moment share the same read.
 * A read that fails isn't kept, so the next request tries again.
 */
export function shortCache<T>(ttlMs: number, now: () => number = Date.now) {
  const kept = new Map<string, { at: number; value: Promise<T> }>();
  return (key: string, read: () => Promise<T>) => {
    const hit = kept.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const value = read();
    const entry = { at: now(), value };
    kept.set(key, entry);
    value.catch(() => {
      if (kept.get(key) === entry) kept.delete(key);
    });
    return value;
  };
}
