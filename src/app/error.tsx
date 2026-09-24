"use client";

import Link from "next/link";
import { useEffect } from "react";
import { reportClientError } from "@/lib/client/api";

/** Route-level error boundary: reports the error (§42) and offers a retry (§36 proper errors). */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportClientError(error.message, { stack: error.stack ?? null, digest: error.digest ?? null, kind: "boundary" });
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong.</h1>
      <p className="mt-2 text-sm text-muted">It&apos;s been reported. Your W$ and positions are safe.</p>
      <div className="mt-6 flex justify-center gap-2">
        <button type="button" onClick={() => retry()} className="btn btn-primary">
          Try again
        </button>
        <Link href="/" className="btn btn-secondary">
          Go to markets
        </Link>
      </div>
      {error.digest && <p className="mt-4 text-xs text-muted">Reference: {error.digest}</p>}
    </div>
  );
}
