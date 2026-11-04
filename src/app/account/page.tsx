import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/link";
import { redirect } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { accountLinks, initials } from "@/lib/account";
import { Logo } from "@/components/brand";
import { NameForm, PasswordForm, ProfileCard } from "@/components/profile-forms";
import { requireUser } from "@/lib/auth/dal";
import { homeFor } from "@/lib/auth/session";
import { T } from "@/components/i18n";

export const metadata: Metadata = { title: "My profile" };

/** Profile and password for staff and drivers (customers use /portal/profile). */
export default async function AccountPage() {
  const user = await requireUser();
  if (user.role === "customer") redirect("/portal/profile");
  const home = homeFor(user.role);
  return (
    <div className="min-h-dvh bg-cream text-leaf-950">
      <header className="border-b border-leaf-950/10">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href={home} className="flex items-center gap-2 text-sm text-leaf-900/70 hover:text-leaf-950">
            <ArrowLeft className="size-4" /> {user.role === "driver" ? <T>{"Driver app"}</T> : <T>{"Back office"}</T>}
          </Link>
          <Logo className="h-8" />
          <AccountMenu name={user.name} email={user.email} role={user.role} links={accountLinks(user.role)} />
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <div className="flex items-center gap-4">
          <span className="grid size-14 place-items-center rounded-2xl bg-leaf-700 font-display text-xl font-semibold text-white">{initials(user.name)}</span>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{user.name}</h1>
            <p className="text-sm text-leaf-900/60 capitalize"><T>{user.role}</T></p>
          </div>
        </div>
        <ProfileCard title={<T>{"Your details"}</T>}>
          <NameForm name={user.name} email={user.email} />
        </ProfileCard>
        <ProfileCard title={<T>{"Password"}</T>}>
          <PasswordForm />
        </ProfileCard>
      </main>
    </div>
  );
}
