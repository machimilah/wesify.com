import Link from "next/link";
import type { ReactNode } from "react";

/** Centered single-column layout for sign-in and account-recovery screens. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-10 pt-8">
      <div className="bg-accents" aria-hidden="true" />
      <Link href="/" className="text-2xl font-semibold tracking-tight">
        wesify
      </Link>
      <main className="flex flex-1 flex-col justify-center py-8">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </main>
      <p className="text-center text-xs text-muted">
        Play money only. W$ has no monetary value. <Link href="/terms" className="underline">Terms</Link> · <Link href="/privacy" className="underline">Privacy</Link> ·{" "}
        <Link href="/support" className="underline">Help</Link>
      </p>
    </div>
  );
}
