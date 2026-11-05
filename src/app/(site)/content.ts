import { Coffee, Package, ShoppingBag, SprayCan, Utensils, Wheat } from "lucide-react";

// Everything a customer reads on the public website lives here, so the wording,
// product ranges and contact details can be changed without touching the layout.
// Leave phone/email/address empty to hide them; the contact form always works.

// Company details (name, phone, email, hours…) live in site-info.ts, which emails and
// invoices use too.
export { SITE } from "./site-info";

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

type PosterLink = { label: string; href: string };

/**
 * Home page posters, shown in turn at the top of the page. Change the wording, order or links here.
 * `art` picks the illustration on the right: "categories" (range tiles with product counts),
 * "products" (photos from `categories`), "delivery" (a tracking card) or "ranges" (every range).
 * `image` (optional) is a photo or designed poster in /public, e.g. "/brand/posters/cups.jpg",
 * shown full width behind the text instead of the art (about 2400 × 900, subject on the right).
 */
export type Poster = {
  id: string;
  /** Short name on the poster's tab under the carousel. */
  tab: string;
  tone: "leaf" | "tomato" | "navy" | "night";
  eyebrow: string;
  title: string;
  text: string;
  cta: PosterLink;
  /** Second button for visitors who aren't signed in, and for signed-in customers. */
  secondary?: { guest?: PosterLink; customer?: PosterLink };
  art: "categories" | "products" | "delivery" | "ranges";
  categories?: string[];
  image?: string;
};

export const POSTERS: Poster[] = [
  {
    id: "welcome",
    tab: "Order online",
    tone: "leaf",
    eyebrow: "Wholesale · South East Queensland",
    title: "Packaging and kitchen supplies for food businesses.",
    text: "Order by the carton at your account prices. Our drivers deliver on weekday mornings, and you can follow the van on the day.",
    cta: { label: "Shop all products", href: "/products" },
    secondary: { guest: { label: "Open a trade account", href: "/register" }, customer: { label: "Quick order", href: "/portal/quick-order" } },
    art: "categories",
  },
  {
    id: "packaging",
    tab: "Takeaway packaging",
    tone: "tomato",
    eyebrow: "Takeaway packaging",
    title: "Containers, cups and lids for every order you send out.",
    text: "Kraft, plastic and compostable ranges in carton quantities, at your own trade price.",
    cta: { label: "Shop takeaway containers", href: "/categories/takeaway-containers" },
    secondary: { guest: { label: "Cups & lids", href: "/categories/cups-and-lids" }, customer: { label: "Cups & lids", href: "/categories/cups-and-lids" } },
    art: "products",
    categories: ["Takeaway containers", "Cups & lids", "Bags & wraps"],
  },
  {
    id: "delivery",
    tab: "Delivery",
    tone: "navy",
    eyebrow: "Delivery",
    title: "Planned weekday runs, right to your back door.",
    text: "Pick a delivery window, follow the van on the day and get a photo and signature with every drop.",
    cta: { label: "How delivery works", href: "/#delivery" },
    secondary: { customer: { label: "Track my deliveries", href: "/portal/deliveries" } },
    art: "delivery",
  },
  {
    id: "one-supplier",
    tab: "One supplier",
    tone: "night",
    eyebrow: "One account, one invoice",
    title: "Packaging, cleaning and pantry staples on one delivery.",
    text: "Fewer suppliers to chase. Order everything your kitchen goes through from one place.",
    cta: { label: "Browse all ranges", href: "/products" },
    secondary: { guest: { label: "Ask for a price list", href: "/#contact" }, customer: { label: "Buy again", href: "/portal/quick-order" } },
    art: "ranges",
  },
];

/** A category's own address, e.g. "Cups & lids" → /categories/cups-and-lids. */
export const categorySlug = (name: string) =>
  name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const categoryHref = (name: string) => `/categories/${categorySlug(name)}`;

export function categoryInfo(name: string) {
  return CATEGORIES.find((c) => c.title === name) ?? { icon: Package, title: name, text: "" };
}
