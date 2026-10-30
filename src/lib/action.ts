import { AuthError } from "./auth/dal";
import { UserError } from "./planning";

export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };

/** Runs a server action body and turns expected failures into a message for the form. */
export async function attempt<T>(fn: () => Promise<{ message?: string; data?: T } | void>): Promise<ActionResult<T>> {
  try {
    const r = await fn();
    return { ok: true, ...(r ?? {}) };
  } catch (err) {
    if (err instanceof UserError || err instanceof AuthError) return { ok: false, error: err.message };
    // redirect()/notFound() throw special errors that must propagate.
    if (err && typeof err === "object" && "digest" in err) throw err;
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
