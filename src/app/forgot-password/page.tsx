"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import { AuthLayout } from "@/components/AuthLayout";
import { Field } from "@/components/ui";
import { ApiError, api } from "@/lib/client/api";

export default function ForgotPasswordPage() {
  const { config } = useApp();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (config?.provider === "clerk") {
    return (
      <AuthLayout title="Reset your password">
        <p className="text-sm text-muted">Use &ldquo;Forgot password?&rdquo; on the sign-in screen.</p>
        <Link href="/login" className="btn btn-primary mt-4 w-full">Go to sign in</Link>
      </AuthLayout>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/email", { method: "POST", body: { action: "forgot-password", email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link that works for 1 hour.">
      {sent ? (
        <div className="space-y-4">
          <p className="notice notice-success" role="status">
            If an account uses {email}, a reset link is on its way. Check your spam folder if it doesn&apos;t arrive in a few minutes.
          </p>
          <Link href="/login" className="btn btn-secondary w-full">Back to log in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field id="fp-email" label="Email">
            <input id="fp-email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && <p role="alert" className="notice notice-danger">{error}</p>}
          <button type="submit" className="btn btn-primary min-h-12 w-full" disabled={busy || !email}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <p className="text-center text-sm text-muted">
            Still stuck? <Link href="/support?category=password_reset" className="underline">Contact support</Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
