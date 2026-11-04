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

export type SiteInfo = typeof SITE;

/** SITE with the business details set in the back office (Settings) filled in over it. */
export function siteInfo(s: { contactPhone: string; contactEmail: string; contactAddress: string; abn: string; openingHours: string }): SiteInfo {
  const hours = s.openingHours.trim() || SITE.hours;
  return {
    ...SITE,
    phone: s.contactPhone.trim() || SITE.phone,
    email: s.contactEmail.trim() || SITE.email,
    address: s.contactAddress.trim() || SITE.address,
    abn: s.abn.trim() || SITE.abn,
    hours,
    // The machine-readable hours only match the written-in ones; custom hours are left out for Google.
    openingHours: hours === SITE.hours ? SITE.openingHours : [],
  };
}
