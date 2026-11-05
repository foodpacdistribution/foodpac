import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { ContactForm } from "./contact-form";
import { STEPS } from "./content";
import type { SiteInfo } from "./site-info";
import { T } from "@/components/i18n";

/** How ordering works (left) and the delivery facts (right), side by side on one band. */
export function HowItWorks({ site }: { site: SiteInfo }) {
  return (
    <section className="border-t border-leaf-950/10 bg-sand/60">
      <div className="mx-auto grid max-w-6xl gap-14 px-4 py-16 sm:px-6 lg:grid-cols-[1.3fr_1fr] lg:gap-20 lg:py-20">
        <div id="how-it-works" className="scroll-mt-28">
          <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            <T>{"How ordering works"}</T>
          </h2>
          <ol className="mt-8 border-t border-leaf-950/15">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[2rem_1fr] gap-x-3 border-b border-leaf-950/15 py-5 sm:grid-cols-[2.5rem_12rem_1fr] sm:gap-x-6">
                <span className="font-display text-sm font-semibold text-leaf-900/40 tabular-nums">{i + 1}.</span>
                <h3 className="font-semibold">
                  <T>{s.title}</T>
                </h3>
                <p className="col-start-2 mt-1 text-sm leading-relaxed text-leaf-900/70 sm:col-start-3 sm:mt-0">
                  <T>{s.text}</T>
                </p>
              </li>
            ))}
          </ol>
        </div>

        <div id="delivery" className="scroll-mt-28">
          <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            <T>{"Delivery"}</T>
          </h2>
          <p className="mt-4 leading-relaxed text-leaf-900/75">
            <T>{"Our own drivers do the runs every weekday morning. Tell us when your kitchen can take a delivery and we'll fit you into the run."}</T>
          </p>
          <dl className="mt-6 divide-y divide-leaf-950/15 border-y border-leaf-950/15 text-sm">
            <Fact label="Area">
              <T>{site.serviceArea}</T>
              <T>{". Further out? Ask about scheduled runs."}</T>
            </Fact>
            <Fact label="Days">
              <T>{site.hours}</T>
              <T>{". Early drops before service on request."}</T>
            </Fact>
            <Fact label="On the day">
              <T>{"The driver takes a photo and a signature at the door, and you can see both in your account."}</T>
            </Fact>
          </dl>
        </div>
      </div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-3.5">
      <dt className="font-semibold">
        <T>{label}</T>
      </dt>
      <dd className="leading-relaxed text-leaf-900/75">{children}</dd>
    </div>
  );
}

export function Contact({ site }: { site: SiteInfo }) {
  const details = [
    site.phone && { icon: Phone, label: site.phone, href: `tel:${site.phone.replace(/\s/g, "")}` },
    site.email && { icon: Mail, label: site.email, href: `mailto:${site.email}` },
    site.address && { icon: MapPin, label: site.address },
    { icon: Clock, label: site.hours },
  ].filter(Boolean) as { icon: typeof Phone; label: string; href?: string }[];

  return (
    <section id="contact" className="scroll-mt-28 border-t border-leaf-950/10">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.3fr] lg:py-20">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            <T>{"Open an account or ask for a price list"}</T>
          </h2>
          <p className="mt-4 max-w-md leading-relaxed text-leaf-900/75">
            <T>{"Tell us a bit about your business and what you go through in a week. We reply within one business day."}</T>
          </p>
          <ul className="mt-8 space-y-3 text-sm">
            {details.map(({ icon: Icon, label, href }) => (
              <li key={label} className="flex items-center gap-3">
                <Icon className="size-4 shrink-0 text-leaf-900/45" />
                {href ? (
                  <a href={href} className="font-medium underline decoration-leaf-900/25 underline-offset-2 hover:decoration-leaf-900">
                    <T>{label}</T>
                  </a>
                ) : (
                  <T>{label}</T>
                )}
              </li>
            ))}
          </ul>
        </div>
        <ContactForm />
      </div>
    </section>
  );
}
