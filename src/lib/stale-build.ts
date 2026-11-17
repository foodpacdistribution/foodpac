// A page left open while a new version went live still runs the old code. Opening another page then
// asks for code that only the old version had, and the browser can't load it. Loading the page
// afresh picks up the new version; once a minute at most, so a page that is really broken can't loop.

const KEY = "fp-reloaded-at";

/** The browser couldn't load a piece of the app's code: almost always a new version went live. */
export function isStaleBuild(error: unknown) {
  const e = error as { name?: string; message?: string } | null;
  const text = `${e?.name ?? ""} ${e?.message ?? ""}`;
  return /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to find Server Action/i.test(text);
}

/** Loads the page afresh, unless that was already tried in the last minute. Returns whether it did. */
export function reloadOnce() {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY)) || 0;
  } catch {}
  if (Date.now() - last < 60_000) return false;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {}
  window.location.reload();
  return true;
}
