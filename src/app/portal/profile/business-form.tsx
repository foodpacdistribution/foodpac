"use client";

import { useActionState } from "react";
import { updateMyBusiness } from "@/app/actions/shop";
import { SubmitButton } from "@/components/client-ui";
import { ProfileLabel, profileInput, Saved } from "@/components/profile-forms";

export function BusinessForm(c: { name: string; phone: string | null; email: string | null; address: string | null; abn: string | null }) {
  const [state, action] = useActionState(updateMyBusiness, undefined);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <ProfileLabel text="Business name" hint="Contact us to change your registered business name.">
        <input value={c.name} disabled className={profileInput} />
      </ProfileLabel>
      <ProfileLabel text="ABN">
        <input name="abn" defaultValue={c.abn ?? ""} inputMode="numeric" className={profileInput} />
      </ProfileLabel>
      <ProfileLabel text="Phone">
        <input name="phone" type="tel" defaultValue={c.phone ?? ""} autoComplete="tel" className={profileInput} />
      </ProfileLabel>
      <ProfileLabel text="Accounts email" hint="Where invoices and order updates go.">
        <input name="email" type="email" defaultValue={c.email ?? ""} className={profileInput} />
      </ProfileLabel>
      <ProfileLabel text="Main delivery address" className="sm:col-span-2">
        <input name="address" defaultValue={c.address ?? ""} autoComplete="street-address" className={profileInput} />
      </ProfileLabel>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <SubmitButton pendingText="Saving…" className="rounded-full bg-leaf-700 px-5 hover:bg-leaf-800">
          Save business details
        </SubmitButton>
        <Saved state={state} />
      </div>
    </form>
  );
}
