"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { ApiError, api } from "@/lib/client/api";

/**
 * Share → Wesify (§15). Installed as a PWA, the OS share sheet opens this page with the shared
 * URL (manifest share_target); it also works as a deep link: /share-target?url=…. Opens the existing
 * market, or files a submission and says so right away. Markets created here are tagged
 * `source: "share"` so share-originated supply can be counted.
 */
export default function ShareTargetPage() {
  const router = useRouter();
  const { me, meLoaded } = useApp();
  const [state, setState] = useState<{ kind: "working" } | { kind: "error"; message: string } | { kind: "review"; marketId: string }>({ kind: "working" });

  useEffect(() => {
    if (!meLoaded) return;
    const params = new URLSearchParams(window.location.search);
    const candidates = [params.get("url"), params.get("text"), params.get("title")].filter(Boolean).join(" ");
    const url = candidates.match(/https?:\/\/\S+/)?.[0];
    if (!url) {
      setState({ kind: "error", message: "We couldn't find a video link in what you shared. Copy the link from the app's Share button and paste it in the search bar." });
      return;
    }
    if (!me) {
      try {
        sessionStorage.setItem("wesify_pending_share", url);
      } catch {}
      router.replace("/welcome");
      return;
    }
    api<{ marketId: string; status: string }>("/api/markets", { method: "POST", body: { url, source: "share" } })
      .then((r) => (r.status === "DRAFT" ? setState({ kind: "review", marketId: r.marketId }) : router.replace(`/markets/${r.marketId}`)))
      .catch((err) => setState({ kind: "error", message: err instanceof ApiError ? err.message : "We cannot track this video yet. Try another link." }));
  }, [me, meLoaded, router]);

  return (
    <div className="mx-auto max-w-md py-20 text-center">
      {state.kind === "working" && (
        <p className="text-sm text-muted" role="status">
          Checking the video…
        </p>
      )}
      {state.kind === "review" && (
        <div role="status">
          <p className="text-lg font-semibold">Sent for review.</p>
          <p className="mt-1 text-sm text-muted">New videos are checked before their market opens, usually within a few hours. We&apos;ll notify you when it&apos;s live.</p>
          <Link href={`/markets/${state.marketId}`} className="btn btn-primary mt-6">
            See its status
          </Link>
        </div>
      )}
      {state.kind === "error" && (
        <div role="alert">
          <p className="text-lg font-semibold">We can&apos;t open a market for this.</p>
          <p className="mt-1 text-sm text-muted">{state.message}</p>
          <Link href="/" className="btn btn-secondary mt-6">
            Back to markets
          </Link>
        </div>
      )}
    </div>
  );
}
