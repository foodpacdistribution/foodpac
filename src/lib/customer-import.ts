// Bulk customer import: column matching and row checks. Client-safe, so the browser can preview
// and the server re-checks every row with the same rules. Customers are matched by their customer
// code (kept from the old system); a row without a code matches an existing customer of the same
// name, or is added with the next C-number.

import type { PaymentTerms } from "./db/schema";
import { parseMoney, parseYesNo } from "./product-import";

export const CUSTOMER_FIELDS = [
  { key: "code", label: "Customer code", synonyms: ["code", "customer code", "customer id", "customer no", "customer number", "account", "account code", "account no", "account number", "acc no", "cust code", "cust no", "debtor code", "客户编号", "客户代码", "客户编码", "编号", "代码", "账号"] },
  { key: "name", label: "Business name *", synonyms: ["name", "business", "business name", "customer", "customer name", "company", "company name", "trading name", "shop", "restaurant", "客户", "客户名称", "公司", "公司名称", "店名", "名称", "商家"] },
  { key: "phone", label: "Phone", synonyms: ["phone", "phone number", "mobile", "mobile number", "tel", "telephone", "contact number", "电话", "手机", "联系电话"] },
  { key: "email", label: "Email", synonyms: ["email", "e mail", "email address", "accounts email", "邮箱", "电子邮件"] },
  { key: "address", label: "Delivery address", synonyms: ["address", "delivery address", "street address", "shipping address", "location", "地址", "送货地址", "配送地址"] },
  { key: "abn", label: "ABN", synonyms: ["abn", "acn", "abn acn", "tax id"] },
  { key: "paymentTerms", label: "Payment terms", synonyms: ["terms", "payment terms", "payment", "credit terms", "付款方式", "付款条件", "账期"] },
  { key: "creditLimit", label: "Credit limit ($)", synonyms: ["credit limit", "limit", "credit", "信用额度", "额度"] },
  { key: "active", label: "Active (yes/no)", synonyms: ["active", "status", "enabled", "启用", "状态"] },
] as const;

export type CustomerField = (typeof CUSTOMER_FIELDS)[number]["key"];
export type CustomerImportRow = Partial<Record<CustomerField, string>>;
export type CustomerMapping = Partial<Record<CustomerField, number>>;

/** The values a row sets. Fields left out (empty cells) keep their current value on update. */
export type CustomerValues = {
  code?: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  abn?: string;
  paymentTerms?: PaymentTerms;
  creditLimitCents?: number;
  active?: boolean;
};

export type CustomerRowCheck = { ok: true; value: CustomerValues } | { ok: false; error: string };

export const MAX_CUSTOMER_ROWS = 5000;

/** Codes are compared ignoring case and surrounding spaces. */
export const codeKey = (code: string) => code.trim().toLowerCase();
export const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * A customer code as the old system wrote it, kept as it is ("Sushi Paradise (Fortitude
 * Valley)", "MUVZJQNDMV"), only with runs of spaces made one. Up to 100 characters. Throws the reason.
 */
export function cleanCode(raw: string): string {
  const code = raw.trim().replace(/\s+/g, " ");
  if (code.length > MAX_CODE_LENGTH) throw new Error(`Customer code "${code.slice(0, 40)}…" is longer than ${MAX_CODE_LENGTH} characters`);
  if (/[\u0000-\u001f\u007f]/.test(code)) throw new Error(`Customer code "${code}" has a hidden character in it`);
  return code;
}

export const MAX_CODE_LENGTH = 100;

/** Codes the system makes up for customers added without one (C10050). */
export const isAutoCode = (code: string) => /^C\d+$/i.test(code.trim());

/**
 * Payment terms as old systems write them: "COD", "Prepaid", "7 days", "Net 14", "30 days EOM"…
 * null = not something we recognise.
 */
export function parseTerms(raw: string): PaymentTerms | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/^(prepay|prepaid|pre-paid|cod|c\.o\.d\.?|cash|card|cash on delivery|upfront|up front|现金|货到付款|预付|预付款)$/.test(s)) return "prepay";
  const days = s.match(/(\d+)/)?.[1];
  if (days === "0") return "prepay";
  if (days === "7") return "net7";
  if (days === "14") return "net14";
  if (days === "30" || /eom|month|月结/.test(s)) return "net30";
  return null;
}

export function checkCustomerRow(row: CustomerImportRow): CustomerRowCheck {
  const v = (k: CustomerField) => (row[k] ?? "").trim();
  const out: CustomerValues = {};
  try {
    if (v("code")) out.code = cleanCode(v("code"));
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (v("name")) out.name = v("name").slice(0, 200);
  if (!out.code && !out.name) return { ok: false, error: "No customer code or name" };
  if (v("phone")) out.phone = v("phone").slice(0, 40);
  if (v("email")) {
    const email = v("email").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: `Email "${v("email")}" doesn't look like an email address` };
    out.email = email.slice(0, 200);
  }
  if (v("address")) out.address = v("address").slice(0, 300);
  if (v("abn")) out.abn = v("abn").slice(0, 20);
  if (v("paymentTerms")) {
    const t = parseTerms(v("paymentTerms"));
    if (!t) return { ok: false, error: `Payment terms "${v("paymentTerms")}": use prepay/COD, 7 days, 14 days or 30 days` };
    out.paymentTerms = t;
  }
  if (v("creditLimit")) {
    const c = parseMoney(v("creditLimit"));
    if (c === null) return { ok: false, error: `Credit limit "${v("creditLimit")}" isn't an amount` };
    out.creditLimitCents = c;
  }
  if (v("active")) {
    const s = v("active").toLowerCase();
    const b = s === "active" ? true : s === "inactive" ? false : parseYesNo(s);
    if (b === null) return { ok: false, error: `Active "${v("active")}" should be yes or no` };
    out.active = b;
  }
  return { ok: true, value: out };
}

/** Rows whose code (or, without a code, name) already appeared earlier in the file. Row index → first row index. */
export function duplicateCustomers(rows: CustomerImportRow[]) {
  const first = new Map<string, number>();
  const dupes = new Map<number, number>();
  rows.forEach((r, i) => {
    const code = (r.code ?? "").trim();
    const key = code ? `c:${codeKey(code)}` : r.name?.trim() ? `n:${nameKey(r.name)}` : "";
    if (!key) return;
    if (first.has(key)) dupes.set(i, first.get(key)!);
    else first.set(key, i);
  });
  return dupes;
}

export const CUSTOMER_TEMPLATE_HEADERS = ["Customer code", "Business name", "Phone", "Email", "Delivery address", "ABN", "Payment terms", "Credit limit", "Active"];
