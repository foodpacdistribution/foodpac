import { CheckCircle2, Clock, Mail, MapPin, Phone } from "lucide-react";
import { ContactForm } from "./contact-form";
import { PROMISES, SITE, STEPS } from "./content";
import { T } from "@/components/i18n";

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-xs font-semibold uppercase tracking-[0.18em] text-tomato ${className ?? ""}`}>{typeof children === "string" ? <T>{children}</T> : children}</p>;
}

export function Promises() {
  return (
    <section className="bg-leaf-900 text-cream">
      <div className="mx-auto grid max-w-6xl gap-px overflow-hidden px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {PROMISES.map((p, i) => (
          <div key={p.title} className="reveal py-4 sm:pr-8">
            <p className="font-display text-sm font-semibold text-tomato">0{i + 1}</p>
            <h3 className="mt-2 font-display text-lg font-semibold"><T>{p.title}</T></h3>
            <p className="mt-2 text-sm leading-relaxed text-cream/70"><T>{p.text}</T></p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-16 bg-sand">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
        <div className="max-w-2xl">
          <Eyebrow><T>{"How it works"}</T></Eyebrow>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl"><T>{"From order to your back door."}</T></h2>
        </div>
        <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="reveal relative rounded-2xl bg-cream p-6">
              <span className="grid size-10 place-items-center rounded-full bg-leaf-700 font-display font-semibold text-white">{i + 1}</span>
              <h3 className="mt-5 font-display text-lg font-semibold"><T>{s.title}</T></h3>
              <p className="mt-2 text-sm leading-relaxed text-leaf-900/70"><T>{s.text}</T></p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Delivery() {
  return (
    <section id="delivery" className="scroll-mt-16">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:py-24">
        <div>
          <Eyebrow><T>{"Delivery"}</T></Eyebrow>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl"><T>{"Regular runs across"}</T>{" "}<T>{SITE.serviceArea}</T>.</h2>
          <p className="mt-4 text-leaf-900/70">
            <T>{"Our drivers run planned routes every weekday morning. Tell us when your kitchen can take a delivery and we'll build it into the run. If anything changes on the day, we re-plan and let you know."}</T></p>
          <dl className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-leaf-950/10 bg-white p-5">
              <dt className="flex items-center gap-2 text-sm font-semibold">
                <MapPin className="size-4 text-leaf-700" /> {" "}<T>{"Service area"}</T></dt>
              <dd className="mt-1 text-sm text-leaf-900/70"><T>{SITE.serviceArea}</T><T>{". Further out? Ask about scheduled runs."}</T></dd>
            </div>
            <div className="rounded-2xl border border-leaf-950/10 bg-white p-5">
              <dt className="flex items-center gap-2 text-sm font-semibold">
                <Clock className="size-4 text-leaf-700" /> {" "}<T>{"Delivery days"}</T></dt>
              <dd className="mt-1 text-sm text-leaf-900/70"><T>{SITE.hours}</T><T>{". Early drops before service on request."}</T></dd>
            </div>
          </dl>
        </div>
        <div className="rounded-[2rem] bg-leaf-50 p-6 sm:p-8">
          <ul className="space-y-4">
            {[
              ["Order ahead", "and it goes out on your next scheduled run."],
              ["Pick your window", "so stock arrives when someone is there to receive it."],
              ["Track the day", "our dispatch team sees every van live and knows when you're next."],
              ["Proof at the door", "a photo and signature are saved with every delivery."],
            ].map(([title, text]) => (
              <li key={title} className="flex gap-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-leaf-600" />
                <p className="text-leaf-900/80">
                  <span className="font-semibold text-leaf-950"><T>{title}</T></span> — <T>{text}</T>
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function Contact() {
  const details = [
    SITE.phone && { icon: Phone, label: SITE.phone, href: `tel:${SITE.phone.replace(/\s/g, "")}` },
    SITE.email && { icon: Mail, label: SITE.email, href: `mailto:${SITE.email}` },
    SITE.address && { icon: MapPin, label: SITE.address },
    { icon: Clock, label: SITE.hours },
  ].filter(Boolean) as { icon: typeof Phone; label: string; href?: string }[];

  return (
    <section id="contact" className="scroll-mt-16 bg-leaf-900">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:py-24">
        <div className="text-cream">
          <Eyebrow><T>{"Get in touch"}</T></Eyebrow>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl"><T>{"Open an account or ask for a price list."}</T></h2>
          <p className="mt-4 text-cream/70">
            <T>{"Tell us a little about your business and what you order each week. We'll get back to you within one business day."}</T></p>
          <ul className="mt-8 space-y-3 text-sm">
            {details.map(({ icon: Icon, label, href }) => (
              <li key={label} className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-full bg-white/10">
                  <Icon className="size-4" />
                </span>
                {href ? (
                  <a href={href} className="hover:underline">
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
