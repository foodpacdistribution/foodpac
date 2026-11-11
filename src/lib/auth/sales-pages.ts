// Which back-office pages sales staff may open. No server code here, so the menu can use it too.

/** Where sales staff land. */
export const SALES_HOME = "/admin/pipeline";

/** The back-office pages sales staff may open: the pipeline and the customer map. */
export const SALES_PAGES = [SALES_HOME, "/admin/customer-map"];

/** True for a path sales staff may open (one of their pages or below it, or their own profile). */
export function salesMayOpen(path: string) {
  return path === "/account" || SALES_PAGES.some((p) => path === p || path.startsWith(`${p}/`));
}
