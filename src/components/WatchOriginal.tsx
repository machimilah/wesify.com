"use client";

import { trackEvent } from "@/lib/client/api";
import type { MarketCardDTO } from "@/lib/shared/dto";

/**
 * Link back to the original video (§6, §17 attribution). Tracked, because traffic sent back to the
 * platform is part of what creators see (§31). Simulated test markets have no real video.
 */
export function WatchOriginal({ market, surface, className = "min-h-8 text-xs" }: { market: MarketCardDTO; surface: string; className?: string }) {
  if (market.video.simulated) {
    return (
      <span className={`flex w-full items-center justify-center rounded-lg border border-line font-semibold text-muted ${className}`} title="This market uses a simulated video during testing">
        Simulated video
      </span>
    );
  }
  return (
    <a
      href={market.video.canonicalUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackEvent("original_video_opened", { market_id: market.id, surface })}
      className={`flex w-full items-center justify-center rounded-lg border border-line font-semibold hover:bg-wash ${className}`}
    >
      Watch on {market.video.platformName} ↗
    </a>
  );
}
