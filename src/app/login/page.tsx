import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/AuthForms";
import { AuthLayout } from "@/components/AuthLayout";

export const metadata: Metadata = { title: "Log in", robots: { index: false } };

export default function LoginPage() {
  return (
    <AuthLayout title="Welcome back" subtitle="Log in to trade and see your positions.">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
