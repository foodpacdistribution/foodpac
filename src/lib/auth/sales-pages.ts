// Which back-office pages sales staff may open. No server code here, so the menu can use it too.

/** Where sales staff land. */
export const SALES_HOME = "/admin/pipeline";

/**
 * The back-office pages sales staff may open, in the menu: the pipeline, customers, quotes and
 * the customer map. Each page also checks the customer is theirs (or nobody's yet).
 */
export const SALES_PAGES = [SALES_HOME, "/admin/customers", "/admin/quotes", "/admin/customer-map"];

/** Of those, the ones whose pages below are office-only (import, price lists). */
const EXACT_ONLY = new Set(["/admin/customers"]);

const UUID = "[0-9a-f-]{36}";
/** A customer's own page (not its price list below it). */
const CUSTOMER_PAGE = new RegExp(`^/admin/customers/${UUID}$`, "i");
/** At a store: price match (and the savings sheet), and setting up the customer's list. */
const VISIT_PAGES = new RegExp(`^/admin/customers/${UUID}/(price-match(/sheet)?|list)$`, "i");
/** Taking an order on the spot, and looking at one afterwards (not editing, invoices or pick lists). */
const ORDER_PAGES = new RegExp(`^/admin/sales/(new|${UUID})$`, "i");

/** True for a path sales staff may open (one of their pages or below it, a customer's page and its visit pages, an order, or their own profile). */
export function salesMayOpen(path: string) {
  return (
    path === "/account" ||
    CUSTOMER_PAGE.test(path) ||
    VISIT_PAGES.test(path) ||
    ORDER_PAGES.test(path) ||
    SALES_PAGES.some((p) => path === p || (!EXACT_ONLY.has(p) && path.startsWith(`${p}/`)))
  );
}
