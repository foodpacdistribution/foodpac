import { ArrowLeft } from "lucide-react";
import Link from "@/components/link";
import { Logo } from "./brand";
import { T } from "./i18n";
import { LanguageSwitch } from "./language-switch";

/** The centred card used by the password pages, in the same look as the sign-in page. */
export function AuthCard({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col bg-cream px-4 py-6 text-leaf-950 sm:px-10">
      <div className="flex items-center justify-between">
        <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-leaf-900/60 hover:text-leaf-900">
          <ArrowLeft className="size-4" /> <T>{"Back to sign in"}</T>
        </Link>
        <LanguageSwitch />
      </div>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
        <Link href="/" aria-label="Foodpac Distribution home">
          <Logo className="h-11" />
        </Link>
        <h1 className="mt-8 font-display text-3xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </main>
  );
}
