"use client";

import Link from "next/link";
import type { MarketCardDTO } from "@/lib/shared/dto";
import { compactNumber, duration, percent } from "@/lib/shared/format";
import { trackEvent } from "@/lib/client/api";
import { useWorldNow } from "@/lib/client/hooks";
import { Change, MomentumBadge, PlatformBadge, SERIES_COLORS, StatusBadge, Thumbnail } from "./ui";

export function MarketCard({ market }: { market: MarketCardDTO }) {
  const now = useWorldNow();
  const open = market.status === "OPEN";
  const top = [...market.topOutcomes].sort((a, b) => b.price - a.price);
  const href = `/markets/${market.id}`;

  return (
    <article className="card card-hover flex gap-3 p-3" aria-label={`@${market.video.creatorHandle} market`}>
      <Link href={href} className="shrink-0" aria-label={`Open @${market.video.creatorHandle} market`}>
        <Thumbnail
          hue={market.video.thumbnailHue}
          caption={market.video.caption}
          seed={market.video.simulated ? market.video.id : undefined}
          src={market.video.thumbnailUrl}
          className="h-full w-20 sm:w-24 lg:w-28"
        />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col py-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <PlatformBadge platform={market.video.platform} />
          {market.status === "OPEN" ? <MomentumBadge label={market.momentum.label} /> : <StatusBadge status={market.status} />}
          {market.featured && <span className="badge badge-info">Featured</span>}
        </div>
        <Link href={href} className="mt-1.5">
          <h3 className="truncate text-[15px] font-semibold leading-snug">@{market.video.creatorHandle} · likes in 24h</h3>
          <p className="tabular mt-0.5 truncate text-xs text-muted">
            {compactNumber(market.currentLikes)} likes
            {market.likesPerMinute > 0 && ` · +${compactNumber(market.likesPerMinute)}/min`} · opened {duration(now - market.openedAt)} ago
          </p>
        </Link>

        <ul className="mt-3 space-y-2">
          {top.map((o, i) => (
            <li key={o.id} className="flex items-center gap-2">
              <Link href={href} className="flex min-w-0 flex-1 items-center gap-2">
                <span className="w-20 shrink-0 truncate text-sm font-medium text-ink-soft">{o.label}</span>
                <span className="hidden h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-wash sm:block" aria-hidden="true">
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.round(o.price * 100))}%`, background: i === 0 ? SERIES_COLORS[0] : "#3a3a40" }} />
                </span>
              </Link>
              <span className="tabular w-10 text-right text-base font-semibold" style={i === 0 ? { color: SERIES_COLORS[0] } : undefined}>
                {percent(o.price)}
              </span>
              <Change value={o.change1h} points className="w-9 text-[11px]" />
              {open ? (
                <Link href={`${href}?outcome=${o.id}`} className={`btn-outcome w-14 ${i === 1 ? "btn-outcome-alt" : ""}`} aria-label={`Buy ${o.label}`}>
                  Buy
                </Link>
              ) : (
                <span className="w-14 text-right text-xs font-medium text-muted">{o.price >= 0.999 ? "Won" : "—"}</span>
              )}
            </li>
          ))}
        </ul>

        <div className="tabular mt-auto flex items-center justify-between gap-2 pt-3 text-xs text-muted">
          <span>W${compactNumber(market.volume)} vol</span>
          {!market.video.simulated && (
            <a
              href={market.video.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent("original_video_opened", { market_id: market.id, surface: "card" })}
              className="font-semibold text-ink-soft hover:text-ink"
            >
              Watch original ↗
            </a>
          )}
          <span>
            {open
              ? `Closes in ${duration(market.settlesAt - now)}`
              : market.status === "PAUSED"
                ? "Paused"
                : market.status === "SETTLED"
                  ? "Settled"
                  : market.status === "CANCELLED"
                    ? "Cancelled"
                    : "Settling"}
          </span>
        </div>
      </div>
    </article>
  );
}
