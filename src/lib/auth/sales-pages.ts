// Which back-office pages sales staff may open. No server code here, so the menu can use it too.

/** Where sales staff land. */
export const SALES_HOME = "/admin/pipeline";

/** The back-office pages sales staff may open: the pipeline, the customer list and the customer map. */
export const SALES_PAGES = [SALES_HOME, "/admin/customers", "/admin/customer-map"];

/** Of those, the ones whose pages below are office-only (import, price lists). */
const EXACT_ONLY = new Set(["/admin/customers"]);

/** A customer's own page (not its price list below it). */
const CUSTOMER_PAGE = /^\/admin\/customers\/[0-9a-f-]{36}$/i;

/** True for a path sales staff may open (one of their pages or below it, a customer's page, or their own profile). */
export function salesMayOpen(path: string) {
  return path === "/account" || CUSTOMER_PAGE.test(path) || SALES_PAGES.some((p) => path === p || (!EXACT_ONLY.has(p) && path.startsWith(`${p}/`)));
}
