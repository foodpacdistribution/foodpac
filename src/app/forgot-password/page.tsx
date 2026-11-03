import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-card";
import { T } from "@/components/i18n";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title={<T>{"Forgot your password?"}</T>}>
      <ForgotForm />
    </AuthCard>
  );
}
