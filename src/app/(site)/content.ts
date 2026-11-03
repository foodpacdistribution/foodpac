import { Coffee, Package, ShoppingBag, SprayCan, Utensils, Wheat } from "lucide-react";

// Everything a customer reads on the public website lives here, so the wording,
// product ranges and contact details can be changed without touching the layout.
// Leave phone/email/address empty to hide them; the contact form always works.

export const SITE = {
  name: "Foodpac Distribution",
  tagline: "Food & packaging supplies, delivered.",
  serviceArea: "South East Queensland",
  phone: "",
  email: "",
  address: "",
  hours: "Mon–Fri · 6am – 4pm",
  /** The same hours for Google, in schema.org form. */
  openingHours: ["Mo-Fr 06:00-16:00"],
  /** The business's other official pages (Google Business Profile, Facebook, Instagram, LinkedIn…), for Google's knowledge panel. */
  sameAs: [] as string[],
  /** Printed on tax invoices. Required in Australia once you're registered for GST. */
  abn: "",
};

/** Shop categories with an icon and blurb; products use these names in their category field. */
export const CATEGORIES = [
  { icon: Package, title: "Takeaway containers", text: "Plastic, kraft and compostable boxes, bowls and lids in every size you pack." },
  { icon: Coffee, title: "Cups & lids", text: "Hot and cold cups, sleeves, carriers and straws for coffee and drinks." },
  { icon: ShoppingBag, title: "Bags & wraps", text: "Carry bags, paper bags, film, foil and baking paper for the counter and the kitchen." },
  { icon: Utensils, title: "Cutlery & napkins", text: "Wooden and plastic cutlery, napkins, portion cups and serving essentials." },
  { icon: SprayCan, title: "Cleaning & hygiene", text: "Gloves, sanitiser, chemicals and paper towel to keep the kitchen compliant." },
  { icon: Wheat, title: "Pantry & dry goods", text: "Sauces, oils, condiments and dry staples so one delivery covers more of your list." },
];

export const STEPS = [
  { title: "Open an account", text: "Tell us about your business and what you go through each week. We'll set up your account and price list." },
  { title: "Order your way", text: "Send an order by phone or email, or set up a standing order that repeats automatically." },
  { title: "We plan the run", text: "Every morning our routing system plans the day's deliveries around your delivery window." },
  { title: "Delivered with proof", text: "Our driver delivers to your door, and every drop is recorded with a photo and signature." },
];

export const PROMISES = [
  { title: "Delivery windows that fit", text: "Tell us when you can receive stock, before service or after the lunch rush, and we plan around it." },
  { title: "Optimised daily runs", text: "Routes are planned on real road times each morning, so our drivers arrive when we say they will." },
  { title: "Proof on every drop", text: "Photo and signature at the door, so there's never a question about where an order went." },
  { title: "One account, one invoice", text: "Packaging, consumables and dry goods from one supplier, on one delivery." },
];

/** A category's own address, e.g. "Cups & lids" → /categories/cups-and-lids. */
export const categorySlug = (name: string) =>
  name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const categoryHref = (name: string) => `/categories/${categorySlug(name)}`;

export function categoryInfo(name: string) {
  return CATEGORIES.find((c) => c.title === name) ?? { icon: Package, title: name, text: "" };
}
