import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Stripe Checkout over the REST API (no SDK needed). Card payments are offered only
// when STRIPE_SECRET_KEY is set; webhooks need STRIPE_WEBHOOK_SECRET.

export const stripeEnabled = () => !!process.env.STRIPE_SECRET_KEY;

async function stripe<T>(path: string, params?: Record<string, string>, method: "GET" | "POST" = "POST"): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${json?.error?.message ?? res.status}`);
  return json as T;
}

export type StripeSession = { id: string; url: string; payment_status: "paid" | "unpaid" | "no_payment_required"; payment_intent: string | null; metadata: Record<string, string> };

/** One Checkout line for the whole order (the itemised breakdown lives on our invoice), so Stripe charges exactly our total. */
export async function createCheckoutSession(o: { id: string; number: string; totalCents: number; email: string | null }, origin: string) {
  const params: Record<string, string> = {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "aud",
    "line_items[0][price_data][unit_amount]": String(o.totalCents),
    "line_items[0][price_data][product_data][name]": `Foodpac order ${o.number} (incl. GST)`,
    client_reference_id: o.id,
    "metadata[sales_order_id]": o.id,
    "payment_intent_data[metadata][sales_order_id]": o.id,
    success_url: `${origin}/checkout/done?order=${o.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout/done?order=${o.id}&cancelled=1`,
    // Unpaid sessions expire after 30 minutes and the reserved stock is released (webhook).
    expires_at: String(Math.floor(Date.now() / 1000) + 31 * 60),
  };
  if (o.email) params.customer_email = o.email;
  return stripe<StripeSession>("checkout/sessions", params);
}

export const getCheckoutSession = (id: string) => stripe<StripeSession>(`checkout/sessions/${encodeURIComponent(id)}`, undefined, "GET");

export const expireCheckoutSession = (id: string) => stripe<StripeSession>(`checkout/sessions/${encodeURIComponent(id)}/expire`);

export const refundPayment = (paymentIntent: string) => stripe<{ id: string; status: string }>("refunds", { payment_intent: paymentIntent });

/** Verifies the Stripe-Signature header (HMAC-SHA256 of "timestamp.body", 5-minute tolerance). */
export function verifyWebhook(body: string, header: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return null;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return null;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const ok = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .some((p) => {
      const got = Buffer.from(p.slice(3), "hex");
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
  return ok ? (JSON.parse(body) as { type: string; data: { object: StripeSession } }) : null;
}
