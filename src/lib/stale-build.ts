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

/**
 * Whether a newer version of the site has gone live since this page was loaded: errors that the
 * server sends back without a readable message (its requests no longer fit the new version) can't
 * be told apart by their text, so ask. False when it can't tell (offline, local).
 */
export async function newerBuildLive() {
  const mine = process.env.NEXT_PUBLIC_BUILD;
  if (!mine || mine === "dev") return false;
  try {
    const r = await fetch("/api/version", { cache: "no-store" });
    if (!r.ok) return false;
    const { build } = (await r.json()) as { build?: string };
    return !!build && build !== "dev" && build !== mine;
  } catch {
    return false;
  }
}

/** On a page error: load afresh, once, if the page's code is out of date. */
export function reloadIfOutdated(error: unknown) {
  if (isStaleBuild(error)) {
    reloadOnce();
    return;
  }
  void newerBuildLive().then((newer) => {
    if (newer) reloadOnce();
  });
}
