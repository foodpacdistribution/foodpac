"use client";

import { useActionState } from "react";
import { updateMyBusiness } from "@/app/actions/shop";
import { SubmitButton } from "@/components/client-ui";
import { ProfileLabel, profileInput, Saved } from "@/components/profile-forms";
import { useT } from "@/components/i18n";
import { AddressInput } from "@/components/address-input";

export function BusinessForm(c: { name: string; phone: string | null; email: string | null; address: string | null; abn: string | null }) {
  const tr = useT();
  const [state, action] = useActionState(updateMyBusiness, undefined);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <ProfileLabel text={tr("Business name")} hint={tr("Contact us to change your registered business name.")}>
        <input value={c.name} disabled className={profileInput} />
      </ProfileLabel>
      <ProfileLabel text={tr("ABN")}>
        <input name="abn" defaultValue={c.abn ?? ""} inputMode="numeric" className={profileInput} />
      </ProfileLabel>
      <ProfileLabel text={tr("Phone")}>
        <input name="phone" type="tel" defaultValue={c.phone ?? ""} autoComplete="tel" className={profileInput} />
      </ProfileLabel>
      <ProfileLabel text={tr("Accounts email")} hint={tr("Where invoices and order updates go.")}>
        <input name="email" type="email" defaultValue={c.email ?? ""} className={profileInput} />
      </ProfileLabel>
      <ProfileLabel text={tr("Main delivery address")} className="sm:col-span-2">
        <AddressInput name="address" defaultValue={c.address ?? ""} inputClassName={profileInput} />
      </ProfileLabel>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <SubmitButton pendingText={tr("Saving…")} className="rounded-full bg-leaf-700 px-5 hover:bg-leaf-800">
          {tr("Save business details")}</SubmitButton>
        <Saved state={state} />
      </div>
    </form>
  );
}
