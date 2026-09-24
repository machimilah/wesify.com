import type { Metadata } from "next";
import { Suspense } from "react";
import { SignupForm } from "@/components/AuthForms";
import { AuthLayout } from "@/components/AuthLayout";

export const metadata: Metadata = { title: "Create your account", robots: { index: false } };

export default function SignupPage() {
  return (
    <AuthLayout title="Create your account" subtitle="Start with W$10,000 in play money. W$ has no monetary value.">
      <Suspense>
        <SignupForm />
      </Suspense>
    </AuthLayout>
  );
}
