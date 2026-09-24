"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { AuthLayout } from "@/components/AuthLayout";
import { Field } from "@/components/ui";
import { ApiError, api } from "@/lib/client/api";

export default function ResetPasswordPage() {
  return (
    <AuthLayout title="Choose a new password" subtitle="This signs you out of every other device.">
      <Suspense>
        <Reset />
      </Suspense>
    </AuthLayout>
  );
}

function Reset() {
  const router = useRouter();
  const params = useSearchParams();
  const { refreshMe } = useApp();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/email", { method: "POST", body: { action: "reset-password", token: params.get("token") ?? "", password } });
      await refreshMe();
      router.replace("/login?reset=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field id="rp-password" label="New password" hint="At least 10 characters.">
        <input id="rp-password" type="password" autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field id="rp-confirm" label="Type it again">
        <input id="rp-confirm" type="password" autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {error && <p role="alert" className="notice notice-danger">{error}</p>}
      <button type="submit" className="btn btn-primary min-h-12 w-full" disabled={busy || password.length < 10}>
        {busy ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
