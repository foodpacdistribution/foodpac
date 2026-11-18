/**
 * This version of the site: the git commit it was built from (Vercel sets it at build and run
 * time), baked into the browser code too (next.config `env`). "dev" locally.
 */
export const CURRENT_BUILD = process.env.NEXT_PUBLIC_BUILD || process.env.VERCEL_GIT_COMMIT_SHA || "dev";
