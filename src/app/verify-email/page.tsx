"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { AuthLayout } from "@/components/AuthLayout";
import { ApiError, api } from "@/lib/client/api";

export default function VerifyEmailPage() {
  return (
    <AuthLayout title="Confirm your email">
      <Suspense>
        <Verify />
      </Suspense>
    </AuthLayout>
  );
}

function Verify() {
  const params = useSearchParams();
  const { refreshMe } = useApp();
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get("token");
    if (!token) {
      setState("error");
      setMessage("This link is missing its code.");
      return;
    }
    api("/api/auth/email", { method: "POST", body: { action: "verify", token } })
      .then(() => {
        setState("done");
        void refreshMe();
      })
      .catch((err) => {
        setState("error");
        setMessage(err instanceof ApiError ? err.message : "Something went wrong.");
      });
  }, [params, refreshMe]);

  if (state === "working") return <p className="text-sm text-muted" role="status">Checking your link…</p>;
  if (state === "done")
    return (
      <div className="space-y-4">
        <p className="notice notice-success" role="status">Your email is confirmed. You&apos;ll get settlement results and can recover your account.</p>
        <Link href="/" className="btn btn-primary w-full">Go to markets</Link>
      </div>
    );
  return (
    <div className="space-y-4">
      <p className="notice notice-danger" role="alert">{message}</p>
      <Link href="/settings#security" className="btn btn-secondary w-full">Send a new link</Link>
    </div>
  );
}
