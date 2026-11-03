import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { T } from "@/components/i18n";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthCard title={<T>{"Choose a new password"}</T>}>
      {token ? (
        <ResetForm token={token} />
      ) : (
        <p className="mt-6 text-sm text-leaf-900/70">
          <T>{"This link is incomplete. Open the link from the email again, or"}</T>{" "}
          <Link href="/forgot-password" className="font-medium text-leaf-700 underline">
            <T>{"ask for a new one"}</T>
          </Link>
          .
        </p>
      )}
    </AuthCard>
  );
}
