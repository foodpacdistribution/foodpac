// The company's details, shown on the website, in emails and on invoices, and given to
// search engines. Leave phone/email/address empty to hide them; the contact form always works.

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
