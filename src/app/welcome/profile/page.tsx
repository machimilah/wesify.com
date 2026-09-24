"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { AuthLayout } from "@/components/AuthLayout";
import { Field } from "@/components/ui";
import { ApiError, api } from "@/lib/client/api";

/** Clerk sign-up, step 2: choose a username and accept the terms to create the Wesify profile. */
export default function CompleteProfilePage() {
  return (
    <AuthLayout title="One more step" subtitle="Pick the name other traders see, and confirm the basics.">
      <Suspense>
        <CompleteProfile />
      </Suspense>
    </AuthLayout>
  );
}

function CompleteProfile() {
  const router = useRouter();
  const params = useSearchParams();
  const { refreshMe, config } = useApp();
  const [username, setUsername] = useState("");
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [invite, setInvite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/complete-profile", { method: "POST", body: { username, ageConfirmed: age, acceptTerms: terms, inviteCode: invite || null, referralCode: params.get("ref") } });
      await refreshMe();
      router.replace("/?tutorial=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field id="cp-username" label="Username" hint="3–20 characters: letters, numbers, _ or .">
        <input id="cp-username" className="input" maxLength={20} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""))} />
      </Field>
      {config?.flags.inviteOnly && (
        <Field id="cp-invite" label="Invite code">
          <input id="cp-invite" className="input uppercase" value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())} />
        </Field>
      )}
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-5" checked={age} onChange={(e) => setAge(e.target.checked)} /> I&apos;m 18 or older.
      </label>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-5" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
        <span>
          I agree to the <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>, and understand W$ is play money.
        </span>
      </label>
      {error && <p role="alert" className="notice notice-danger">{error}</p>}
      <button type="submit" className="btn btn-primary min-h-12 w-full" disabled={busy || username.length < 3 || !age || !terms}>
        {busy ? "Saving…" : "Get W$10,000 and start"}
      </button>
    </form>
  );
}
