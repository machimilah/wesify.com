"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThumbsUp } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { MarketRow } from "@/components/MarketRow";
import { PriceChart } from "@/components/PriceChart";
import { ReportDialog } from "@/components/ReportDialog";
import { TradePanel, TradeSheet } from "@/components/TradeSheet";
import { FirstTradeTutorial } from "@/components/Tutorial";
import { Change, Empty, ErrorState, MomentumBadge, PlatformBadge, SERIES_COLORS, Skeleton, StatusBadge, Thumbnail } from "@/components/ui";
import { WatchOriginal } from "@/components/WatchOriginal";
import { trackEvent } from "@/lib/client/api";
import { usePoll, useWorldNow } from "@/lib/client/hooks";
import type { MarketCardDTO, MarketDetailDTO, PositionDTO } from "@/lib/shared/dto";
import { GENRES, genreOf } from "@/lib/shared/genres";
import { compactNumber, credits, duration, percent, price } from "@/lib/shared/format";

type Mode = "buy" | "sell";

export default function MarketPage() {
  const { id } = useParams<{ id: string }>();
  const { data: market, error, loading, refresh, stale } = usePoll<MarketDetailDTO>(`/api/markets/${id}`);
  const { toast } = useApp();
  const now = useWorldNow();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("buy");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [version, setVersion] = useState(0);
  const viewed = useRef(false);

  useEffect(() => {
    const preselect = new URLSearchParams(window.location.search).get("outcome");
    if (preselect) setSelected(preselect);
  }, []);

  useEffect(() => {
    if (market && !viewed.current) {
      viewed.current = true;
      trackEvent("market_viewed", { market_id: market.id, status: market.status });
    }
  }, [market]);

  // After an order: refresh prices and the chart. The sheet stays open to show the receipt.
  const onDone = useCallback(() => {
    setVersion((v) => v + 1);
    void refresh();
  }, [refresh]);

  if (loading && !market) {
    return (
      <div className="grid gap-4 pt-6 md:grid-cols-[minmax(0,29%)_minmax(0,1fr)] xl:grid-cols-[370px_minmax(0,1fr)]" aria-busy="true" aria-label="Loading market">
        <Skeleton className="mx-auto aspect-[9/16] w-full max-w-[280px] sm:max-w-sm md:max-w-none" />
        <div className="space-y-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-72" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  if (error && !market) {
    return error.status === 404 ? (
      <Empty title="Market not found.">
        It may have been removed. <Link href="/" className="underline">Browse markets</Link>
      </Empty>
    ) : (
      <ErrorState message={error.message} onRetry={() => void refresh()} />
    );
  }
  if (!market) return null;

  const ranked = [...market.outcomes].sort((a, b) => b.price - a.price);
  const leader = ranked[0];
  const selectedId = market.outcomes.some((o) => o.id === selected) ? selected! : leader.id;
  const tradable = market.status === "OPEN" && now < market.locksAt;
  const openPositions = market.positions.filter((p) => p.status === "OPEN");
  const settledPositions = market.positions.filter((p) => p.status !== "OPEN");
  const settledOrCancelled = market.status === "SETTLED" || market.status === "CANCELLED";

  const choose = (outcomeId: string, nextMode: Mode = "buy") => {
    setSelected(outcomeId);
    setMode(nextMode);
    if (window.matchMedia("(max-width: 767px)").matches) setSheetOpen(true);
  };

  const share = async () => {
    const url = `${window.location.origin}/markets/${market.id}`;
    const text = `How many likes will @${market.video.creatorHandle}'s video have after 24 hours? ${leader.label} is at ${percent(leader.price)} on Wesify.`;
    trackEvent("market_shared", { market_id: market.id });
    try {
      if (navigator.share) await navigator.share({ title: "Wesify", text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast("Link copied");
      }
    } catch {
      /* cancelled */
    }
  };

  const panelProps = { market, outcomeId: selectedId, onOutcomeChange: setSelected, mode, onModeChange: setMode, tradable, onDone };

  return (
    <div className="pb-20 pt-4 md:pb-0">
      <div className="grid gap-4 md:grid-cols-[minmax(0,29%)_minmax(0,1fr)] md:items-start xl:grid-cols-[370px_minmax(0,1fr)]">
        <section aria-label="Video" className="card mx-auto w-full max-w-[280px] p-3 sm:max-w-sm md:sticky md:top-20 md:max-w-none md:p-2.5 lg:p-3">
          <Thumbnail
            hue={market.video.thumbnailHue}
            caption={market.video.caption}
            seed={market.video.simulated ? market.video.id : undefined}
            src={market.video.thumbnailUrl}
            className="aspect-[9/16] w-full rounded-xl"
          />
          <div className="mt-3">
            <WatchOriginal market={market} surface="market" className="min-h-11 text-sm" />
          </div>
          <p className="mt-2 text-center text-xs text-muted">
            Video by <span className="font-medium text-ink-soft">@{market.video.creatorHandle}</span>
            {market.video.authorName ? ` (${market.video.authorName})` : ""} on {market.video.platformName}. Wesify links to it and doesn&apos;t host it.
          </p>
        </section>

        <div className="min-w-0 space-y-4">
          <div className="card space-y-5 p-5 xl:p-6">
            <section className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <PlatformBadge platform={market.video.platform} />
                  <StatusBadge status={market.status} />
                  {market.status === "OPEN" && <MomentumBadge label={market.momentum.label} />}
                </div>
                <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight lg:text-3xl">
                  How many likes will @{market.video.creatorHandle}’s video have after 24 hours?
                </h1>
                <div className="tabular mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                  <span>W${compactNumber(market.volume)} vol</span>
                  <span>{market.traders} traders</span>
                  <span>{market.status === "OPEN" ? `Closes in ${duration(market.locksAt - now)}` : statusText(market.status)}</span>
                  {market.likesPerMinute > 0 && !settledOrCancelled && <span>+{compactNumber(market.likesPerMinute)} likes/min</span>}
                  <span className={stale ? "text-warning" : ""}>{stale ? "Reconnecting…" : `Likes updated ${duration(Math.max(0, now - market.lastMetricAt))} ago`}</span>
                </div>
              </div>
              <div
                key={market.currentLikes}
                className="tabular animate-flash flex shrink-0 items-center gap-2 text-4xl font-semibold leading-none tracking-tight lg:text-5xl"
                style={{ color: SERIES_COLORS[0] }}
                aria-label={`${market.currentLikes.toLocaleString("en-US")} likes right now`}
              >
                <ThumbsUp className="size-7 lg:size-9" aria-hidden="true" />
                <span aria-hidden="true">{market.currentLikes.toLocaleString("en-US")}</span>
              </div>
            </section>

            <StatusBanner market={market} now={now} />

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_440px] xl:gap-5">
              <section aria-label="Price history" className="group relative h-[200px] min-w-0 self-center">
                <PriceChart marketId={market.id} outcomes={market.outcomes} version={version} height={200} legend={false} fill span={{ from: market.openedAt, to: market.settlesAt }} />
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  aria-label="Open chart full screen"
                  className="absolute left-0 top-0 grid size-11 place-items-center rounded-lg bg-wash text-ink-soft opacity-0 transition hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <ExpandIcon />
                </button>
              </section>
              <aside className="hidden min-w-0 rounded-xl bg-bg p-4 md:block xl:p-5" aria-label="Order ticket" data-tour="ticket">
                <TradePanel {...panelProps} compact />
              </aside>
            </div>

            <section aria-label="Outcomes" className="min-w-0 pt-1" data-tour="outcomes">
              <div className="flex items-center justify-between pb-2 text-xs font-medium uppercase tracking-wide text-muted">
                <span>Final likes · 24h window</span>
                <span className="hidden sm:inline">Price · 1h · 3h</span>
              </div>
              <ul>
                {[...market.outcomes].reverse().map((o) => {
                  const isWinner = market.winningOutcomeId === o.id;
                  const isSelected = o.id === selectedId;
                  return (
                    <li key={o.id} className={`flex items-center gap-3 py-3 last:pb-1 ${isSelected ? "md:bg-wash/60" : ""} md:-mx-2 md:rounded-lg md:px-2 xl:-mx-3 xl:px-3`}>
                      <button className="flex min-h-12 min-w-0 flex-1 items-center gap-4 text-left" onClick={() => setSelected(o.id)} aria-label={`${o.label}, ${percent(o.price)} chance, W$${o.price.toFixed(2)} per share`}>
                        <span className="w-28 shrink-0 truncate text-lg font-semibold sm:w-36">
                          {o.label} {isWinner && <span className="text-gradient">· Winner</span>}
                        </span>
                        <span className="hidden h-3.5 min-w-0 flex-1 overflow-hidden rounded-full bg-wash sm:block" aria-hidden="true">
                          <span className="block h-full rounded-full bg-line-strong" style={{ width: `${Math.max(2, Math.round(o.price * 100))}%` }} />
                        </span>
                      </button>
                      <span className="w-16 text-right">
                        <span key={o.price.toFixed(3)} className="tabular animate-flash block rounded text-2xl font-semibold">
                          {percent(o.price)}
                        </span>
                        <span className="tabular block text-[11px] text-muted">{price(o.price)}</span>
                      </span>
                      <span className="hidden w-20 flex-col items-end gap-0.5 text-[11px] sm:flex">
                        <Change value={o.change1h} points suffix="pts" />
                        <Change value={o.change3h} points suffix="pts" className="opacity-70" />
                      </span>
                      <span className="flex w-20 justify-end lg:w-24">
                        {tradable && !market.isOwnMarket && market.tradingEnabled && (
                          <button onClick={() => choose(o.id)} aria-pressed={isSelected} className="btn-outcome min-h-11! w-full text-base" aria-label={`Buy ${o.label}`}>
                            Buy
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-muted">Price = the market&apos;s chance for that range. A winning share pays W$1.00.</p>
            </section>
          </div>

          {openPositions.length > 0 && (
            <section aria-label="Your positions">
              <h2 className="mb-3 text-lg font-semibold tracking-tight">Your positions</h2>
              <PositionsTable positions={openPositions} canSell={tradable && market.sellingEnabled} onSell={(p) => choose(p.outcomeId, "sell")} />
            </section>
          )}

          {settledPositions.length > 0 && (
            <section aria-label="Results">
              <h2 className="mb-3 text-lg font-semibold tracking-tight">Results</h2>
              <ul className="card">
                {settledPositions.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold">{p.outcomeLabel}</p>
                      <p className="text-xs text-muted">{p.status === "CANCELLED" ? "Refunded at cost" : p.status === "CLOSED" ? "Sold early" : p.settlement?.won ? "Won" : "Lost"}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="tabular text-base font-semibold">{credits(p.realizedPnl, { sign: true, decimals: 2 })}</p>
                      {p.realizedPnl > 0 && (
                        <Link href={`/share/${p.id}`} onClick={() => trackEvent("share_clicked", { market_id: market.id })} className="btn btn-secondary">
                          Share
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Market rules" className="card p-4 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight">Rules</h2>
              <Link href="/rules" className="text-sm font-semibold text-crimson-soft">
                All rules →
              </Link>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">{market.settlementDefinition}</p>
            <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
              <li>Each share of the winning range pays W$1.00; the other ranges pay W$0. A count exactly on a boundary belongs to the higher range.</li>
              <li>Trading closes 1 minute before the 24-hour mark. You can sell any time before then.</li>
              <li>If the video is deleted or goes private, trading pauses; after 1 hour the market is cancelled and open positions are refunded at cost.</li>
              {market.rangeExplanation && <li>{market.rangeExplanation}</li>}
            </ul>
            <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted">Data source</dt>
                <dd className="font-medium text-ink-soft">{market.dataSource}</dd>
              </div>
              <div>
                <dt className="text-muted">Rules version</dt>
                <dd className="font-medium text-ink-soft">{market.rulesVersion}</dd>
              </div>
            </dl>
            <ol className="tabular mt-4 grid gap-3 text-xs sm:grid-cols-3">
              <Milestone label="Market opened" at={market.openedAt} done />
              <Milestone label="Trading closes" at={market.locksAt} done={now >= market.locksAt} />
              <Milestone label="Settles (after review)" at={market.settlesAt} done={market.status === "SETTLED"} />
            </ol>
          </section>

          {market.recentTrades.length > 0 && (
            <section aria-label="Recent activity" className="card p-4 md:p-6">
              <h2 className="mb-2 text-lg font-semibold tracking-tight">Activity</h2>
              <ul>
                {market.recentTrades.slice(0, 6).map((t, i) => (
                  <li key={i} className="tabular flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate text-ink-soft">
                      <span className="font-medium text-ink">{t.username}</span>
                      {t.isBot && <span className="badge ml-1">SIM</span>} {t.side === "BUY" ? "bought" : "sold"} <span className="font-semibold text-ink">{t.outcomeLabel}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {credits(t.credits, { decimals: 0 })} · {duration(now - t.createdAt)} ago
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={share} className="btn btn-secondary">
              Share market
            </button>
            <button type="button" onClick={() => setReporting(true)} className="btn btn-ghost">
              Report this market
            </button>
          </div>
        </div>
      </div>

      <MoreMarkets currentId={market.id} videoId={market.video.id} />

      {tradable && (
        <div className="fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-20 bg-surface px-4 py-2.5 md:hidden">
          <div className="flex items-center gap-3">
            <div className="tabular min-w-0 flex-1 text-sm">
              <span className="font-semibold">{market.currentLikes.toLocaleString("en-US")}</span> <span className="text-muted">likes now</span>
            </div>
            {openPositions.length > 0 && (
              <button onClick={() => choose(openPositions[0].outcomeId, "sell")} className="btn btn-secondary">
                Sell
              </button>
            )}
            <button onClick={() => choose(selectedId)} className="btn btn-primary px-6">
              Trade
            </button>
          </div>
        </div>
      )}

      {sheetOpen && <TradeSheet {...panelProps} onClose={() => setSheetOpen(false)} />}
      {expanded && <ChartDialog market={market} version={version} onClose={() => setExpanded(false)} />}
      {reporting && <ReportDialog entityType="market" entityId={market.id} title={`Report @${market.video.creatorHandle}'s market`} onClose={() => setReporting(false)} />}
      {tradable && <FirstTradeTutorial />}
    </div>
  );
}

function ChartDialog({ market, version, onClose }: { market: MarketDetailDTO; version: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-3 md:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Price history" className="animate-rise flex h-full max-h-[92dvh] w-full max-w-6xl flex-col rounded-2xl bg-surface p-5 md:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold tracking-tight md:text-2xl">How many likes will @{market.video.creatorHandle}’s video have after 24 hours?</h2>
            <div className="tabular mt-2 flex items-center gap-2 text-3xl font-semibold leading-none tracking-tight md:text-4xl" style={{ color: SERIES_COLORS[0] }}>
              <ThumbsUp className="size-6 md:size-7" aria-hidden="true" />
              <span>{market.currentLikes.toLocaleString("en-US")}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-wash hover:text-ink">
            ✕
          </button>
        </div>
        <div className="mt-5 min-h-0 flex-1">
          <PriceChart marketId={market.id} outcomes={market.outcomes} version={version} height={520} fill span={{ from: market.openedAt, to: market.settlesAt }} />
        </div>
      </div>
    </div>
  );
}

function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoreMarkets({ currentId, videoId }: { currentId: string; videoId: string }) {
  const { data } = usePoll<{ open: MarketCardDTO[] }>("/api/markets?limit=40", { intervalMs: 60_000 });
  if (!data) return null;
  const others = data.open.filter((m) => m.id !== currentId);
  const genre = GENRES.find((g) => g.value === genreOf(videoId))!;
  const closing = [...others].sort((a, b) => a.settlesAt - b.settlesAt);
  return (
    <div className="mt-4">
      <MarketRow title={`More in ${genre.label}`} markets={others.filter((m) => genreOf(m.video.id) === genre.value)} />
      <MarketRow title="Trending" markets={others.slice(0, 12)} />
      <MarketRow title="Closing soon" markets={closing.slice(0, 12)} />
    </div>
  );
}

function statusText(status: MarketDetailDTO["status"]) {
  return { OPEN: "Open", PAUSED: "Trading paused", LOCKED: "Trading ended", SETTLING: "Settling", SETTLED: "Settled", CANCELLED: "Cancelled", DRAFT: "In review" }[status];
}

function Milestone({ label, at, done }: { label: string; at: number; done: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-1 size-2 shrink-0 rounded-full ${done ? "bg-gradient-main" : "border border-line-strong"}`} aria-hidden="true" />
      <span>
        <span className="block font-semibold text-ink">
          {label}
          <span className="sr-only">{done ? " (done)" : ""}</span>
        </span>
        <span className="text-muted">{new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
      </span>
    </li>
  );
}

/** Every non-open state gets its own plain-English explanation (§6, §7, §24 correct UI for every state). */
function StatusBanner({ market, now }: { market: MarketDetailDTO; now: number }) {
  let title: string | null = null;
  let body: string | null = null;
  let tone = "bg-gradient-main";
  if (market.status === "DRAFT") {
    title = "Submitted for review.";
    body = "Thanks for the link. A Wesify reviewer checks new videos before they open, usually within a few hours. We'll notify you when it's live.";
    tone = "notice";
  } else if (market.status === "SETTLED") {
    const winner = market.outcomes.find((o) => o.id === market.winningOutcomeId);
    title = `Final likes: ${(market.finalMetric ?? 0).toLocaleString("en-US")}`;
    body = `${winner?.label} won. Winning shares paid W$1.00 each.`;
  } else if (market.status === "CANCELLED") {
    title = market.cancellation ? `Cancelled: ${market.cancellation.label}` : "This market was cancelled.";
    body = `${market.cancellation?.explanation ?? ""} Open positions were refunded at cost.`.trim();
    tone = "notice notice-warning";
  } else if (market.status === "SETTLING") {
    title = market.settlementStage === "awaiting_review" ? "Final count recorded. A reviewer is confirming it." : "Trading has ended. Waiting for the final like count.";
    body = "Winnings are paid automatically once the result is confirmed, usually within a few hours.";
  } else if (market.status === "LOCKED" || (market.status === "OPEN" && now >= market.locksAt)) {
    title = "Trading has ended.";
    body = "The final like count is recorded at the 24-hour mark, then checked by a reviewer.";
  } else if (market.status === "PAUSED") {
    title = "Trading is paused.";
    body = market.pausedReason;
    tone = "notice notice-warning";
  } else if (!market.tradingEnabled) {
    title = "Trading is paused across Wesify.";
    body = "Maintenance is in progress. Your positions are safe.";
    tone = "notice notice-warning";
  }
  if (!title) return null;
  return (
    <div role="status" className={`${tone} rounded-xl px-4 py-3`}>
      <p className="text-base font-semibold">{title}</p>
      {body && <p className="text-sm opacity-90">{body}</p>}
    </div>
  );
}

function PositionsTable({ positions, canSell, onSell }: { positions: PositionDTO[]; canSell: boolean; onSell: (p: PositionDTO) => void }) {
  return (
    <>
      <ul className="card sm:hidden">
        {positions.map((p) => (
          <li key={p.id} className="tabular p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">{p.outcomeLabel}</span>
              <span className="text-right">
                <span className="block font-semibold">{credits(p.value, { decimals: 2 })}</span>
                <span className="text-xs text-muted">{credits(p.unrealizedPnl, { sign: true, decimals: 2 })} </span>
                <Change value={p.averageEntryPrice > 0 ? p.currentPrice / p.averageEntryPrice - 1 : null} className="text-[11px]" />
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              {p.shares.toFixed(2)} shares · {price(p.averageEntryPrice)} → {price(p.currentPrice)} · pays {credits(p.shares, { decimals: 2 })} if it wins
            </p>
            <div className="mt-3 flex gap-2">
              {canSell && (
                <button onClick={() => onSell(p)} className="btn-solid min-h-11 flex-1 rounded-lg text-sm font-semibold">
                  Sell
                </button>
              )}
              {p.unrealizedPnl > 0 && (
                <Link href={`/share/${p.id}`} onClick={() => trackEvent("share_clicked", { market_id: p.marketId })} className="btn btn-secondary flex-1">
                  Share
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="card hidden overflow-x-auto sm:block">
        <table className="tabular w-full min-w-[520px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Outcome</th>
              <th scope="col" className="px-2 py-2.5 text-right font-medium">Shares</th>
              <th scope="col" className="px-2 py-2.5 text-right font-medium">Avg → Now</th>
              <th scope="col" className="px-2 py-2.5 text-right font-medium">Value</th>
              <th scope="col" className="px-2 py-2.5 text-right font-medium">Return</th>
              <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-semibold">{p.outcomeLabel}</td>
                <td className="px-2 py-3 text-right">{p.shares.toFixed(2)}</td>
                <td className="px-2 py-3 text-right text-ink-soft">
                  {price(p.averageEntryPrice)} → {price(p.currentPrice)}
                </td>
                <td className="px-2 py-3 text-right font-semibold">{credits(p.value, { decimals: 2 })}</td>
                <td className="px-2 py-3 text-right">
                  <span className="block font-semibold">{credits(p.unrealizedPnl, { sign: true, decimals: 2 })}</span>
                  <Change value={p.averageEntryPrice > 0 ? p.currentPrice / p.averageEntryPrice - 1 : null} className="text-[11px]" />
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="inline-flex gap-1.5">
                    {canSell && (
                      <button onClick={() => onSell(p)} className="btn-solid min-h-10 rounded-lg px-3 text-xs font-semibold">
                        Sell
                      </button>
                    )}
                    {p.unrealizedPnl > 0 && (
                      <Link href={`/share/${p.id}`} onClick={() => trackEvent("share_clicked", { market_id: p.marketId })} className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs font-semibold">
                        Share
                      </Link>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
