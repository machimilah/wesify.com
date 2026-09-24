"use client";

import Link from "next/link";
import { useRef } from "react";
import type { MarketCardDTO } from "@/lib/shared/dto";
import { compactNumber, duration, percent } from "@/lib/shared/format";
import { useWorldNow } from "@/lib/client/hooks";
import { MomentumBadge, PlatformBadge, SERIES_COLORS, Thumbnail } from "./ui";

/** Wide scoreboard-style market card for the home page rows. */
export function MarketRowCard({ market }: { market: MarketCardDTO }) {
  const now = useWorldNow();
  const top = [...market.topOutcomes].sort((a, b) => b.price - a.price).slice(0, 2);

  return (
    <article className="w-[340px] shrink-0 snap-start sm:w-[460px]">
      <Link href={`/markets/${market.id}`} className="card card-hover flex h-full gap-3 rounded-2xl p-4 sm:gap-4">
        {/* Video on the left, stretched to the info column's height. */}
        <Thumbnail
          hue={market.video.thumbnailHue}
          caption={market.video.caption}
          seed={market.video.simulated ? market.video.id : undefined}
          src={market.video.thumbnailUrl}
          className="w-20 sm:w-28"
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5">
            <PlatformBadge platform={market.video.platform} />
            {market.status === "OPEN" ? <MomentumBadge label={market.momentum.label} /> : <span className="badge badge-warning">Paused</span>}
          </div>
          <h3 className="mt-1.5 truncate text-base font-semibold">@{market.video.creatorHandle} · likes in 24h</h3>
          <p className="tabular mt-0.5 truncate text-sm text-muted">{compactNumber(market.currentLikes)} likes</p>

          <ul className="mt-4 space-y-3">
            {top.map((o, i) => {
              const color = SERIES_COLORS[i];
              return (
                <li key={o.id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold">{o.label}</p>
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-wash" aria-hidden="true">
                      <span className="block h-full rounded-full" style={{ width: `${Math.max(3, Math.round(o.price * 100))}%`, background: i === 0 ? color : "#3a3a40" }} />
                    </span>
                  </div>
                  <span
                    className="tabular min-w-[60px] rounded-full border px-3 py-1.5 text-center text-base font-bold sm:min-w-[68px]"
                    style={{ borderColor: i === 0 ? color : "#3a3a40", color: i === 0 ? color : undefined }}
                  >
                    {percent(o.price)}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="tabular mt-auto truncate pt-4 text-sm text-muted">
            W${compactNumber(market.volume)} vol · {market.status === "OPEN" ? `Closes in ${duration(market.settlesAt - now)}` : market.status === "PAUSED" ? "Trading paused" : "Closed"}
          </p>
        </div>
      </Link>
    </article>
  );
}

/** A titled row of cards that scrolls horizontally, with ‹ › buttons on larger screens. */
export function MarketRow({ title, markets, id }: { title: string; markets: MarketCardDTO[]; id?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  if (markets.length === 0) return null;

  const scroll = (dir: -1 | 1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section id={id} aria-label={title} className="mt-10 scroll-mt-20">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <div className="hidden gap-1 sm:flex">
          <ArrowButton label={`Scroll ${title} left`} onClick={() => scroll(-1)} dir="left" />
          <ArrowButton label={`Scroll ${title} right`} onClick={() => scroll(1)} dir="right" />
        </div>
      </div>
      <div className="relative">
        <div ref={scroller} className="no-scrollbar flex snap-x gap-4 overflow-x-auto pb-1">
          {markets.map((m) => (
            <MarketRowCard key={m.id} market={m} />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-bg to-transparent lg:w-28" aria-hidden="true" />
      </div>
    </section>
  );
}

function ArrowButton({ label, onClick, dir }: { label: string; onClick: () => void; dir: "left" | "right" }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="grid size-9 place-items-center rounded-full text-ink-soft hover:bg-wash hover:text-ink">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
