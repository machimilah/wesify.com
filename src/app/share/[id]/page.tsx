"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useApp } from "@/components/AppProvider";
import { Empty, PrimaryButton, SecondaryButton, Skeleton } from "@/components/ui";
import { trackEvent } from "@/lib/client/api";
import { usePoll } from "@/lib/client/hooks";
import type { ShareCardDTO } from "@/lib/shared/dto";
import { percent } from "@/lib/shared/format";

/** §60 share card. Probabilities only — no money language. */
export default function SharePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = usePoll<ShareCardDTO>(`/api/share/${id}`, { intervalMs: 60_000 });
  const { toast } = useApp();

  if (error) return <Empty title="This card is unavailable." />;
  if (!data) return <Skeleton className="m-6 h-96" />;

  const from = percent(data.entryPrice);
  const to = data.won === true ? "100%" : percent(data.latestPrice);
  const text =
    data.won === true
      ? `I bought ${data.outcomeLabel} on @${data.creatorHandle} at ${from}. It hit.`
      : `I bought ${data.outcomeLabel} at ${from}. Now it is at ${to}.`;
  const url = typeof window !== "undefined" ? `${window.location.origin}/markets/${data.marketId}` : "";

  const share = async () => {
    trackEvent("share_clicked", { market_id: data.marketId, surface: "share_card" });
    try {
      if (navigator.share) {
        await navigator.share({ title: "wesify", text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast("Copied to clipboard");
    } catch {
      /* user cancelled */
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-6 py-8">
      <div className="bg-accents" aria-hidden="true" />
      <Link href={`/markets/${data.marketId}`} className="-ml-2 inline-flex min-h-11 items-center self-start px-2 text-sm font-medium text-muted">
        ← Back
      </Link>
      <div className="flex flex-1 items-center">
        <div className="relative w-full overflow-hidden rounded-[32px] bg-surface p-8 shadow-[0_20px_60px_rgba(108,99,255,0.25)]">
          <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(circle,rgba(165,110,255,0.25),transparent_65%)]" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-28 -left-20 size-72 rounded-full bg-[radial-gradient(circle,rgba(47,128,255,0.22),transparent_65%)]" aria-hidden="true" />
          <p className="relative text-xl font-semibold tracking-tight">wesify</p>
          <p className="relative mt-10 text-sm font-medium text-muted">@{data.creatorHandle}</p>
          <p className="relative mt-1 text-5xl font-semibold tracking-tight">{data.outcomeLabel}</p>
          <p className="tabular relative mt-6 text-4xl font-semibold">
            {from} <span className="text-muted" aria-label="to">→</span> <span className="text-gradient">{to}</span>
          </p>
          <p className="relative mt-10 text-lg font-medium">I saw it early.</p>
          <p className="relative mt-1 text-xs text-muted">by {data.username}</p>
        </div>
      </div>
      <div className="mt-8 flex gap-3">
        <PrimaryButton onClick={share} className="flex-1">
          Share
        </PrimaryButton>
        <SecondaryButton onClick={() => void navigator.clipboard?.writeText(`${text} ${url}`).then(() => toast("Copied"))} className="min-h-12">
          Copy
        </SecondaryButton>
      </div>
    </div>
  );
}
