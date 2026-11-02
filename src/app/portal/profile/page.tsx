import type { Metadata } from "next";
import { initials } from "@/lib/account";
import { NameForm, PasswordForm, ProfileCard } from "@/components/profile-forms";
import { getCurrentCustomer } from "@/lib/auth/dal";
import { aud, PAYMENT_TERMS_LABEL } from "@/lib/money";
import { BusinessForm } from "./business-form";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const viewer = await getCurrentCustomer();
  if (!viewer) return null;
  const { user, customer: c } = viewer;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="grid size-14 place-items-center rounded-2xl bg-leaf-700 font-display text-xl font-semibold text-white">{initials(c.name)}</span>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{c.name}</h1>
          <p className="text-sm text-leaf-900/60">
            {c.approved ? "Approved trade account" : "Waiting for approval"} · {PAYMENT_TERMS_LABEL[c.paymentTerms]}
            {c.creditLimitCents !== null && ` · credit limit ${aud(c.creditLimitCents)}`}
          </p>
        </div>
      </div>
      <ProfileCard title="Business details" description="Shown on your invoices and used for deliveries.">
        <BusinessForm name={c.name} phone={c.phone} email={c.email} address={c.address} abn={c.abn} />
      </ProfileCard>
      <ProfileCard title="Your login" description="The person signed in on this account.">
        <NameForm name={user.name} email={user.email} />
      </ProfileCard>
      <ProfileCard title="Password">
        <PasswordForm />
      </ProfileCard>
    </div>
  );
}
