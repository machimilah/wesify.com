"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RequireAccount } from "@/components/RequireAccount";
import { Change, Empty, ErrorState, Skeleton, Stat, Tabs, Thumbnail } from "@/components/ui";
import { trackEvent } from "@/lib/client/api";
import { usePoll, useWorldNow } from "@/lib/client/hooks";
import type { PortfolioDTO, PositionDTO } from "@/lib/shared/dto";
import { credits, duration, percent, price } from "@/lib/shared/format";

type Tab = "open" | "settled" | "history";

export default function PortfolioPage() {
  return (
    <RequireAccount title="Your portfolio">
      <Portfolio />
    </RequireAccount>
  );
}

function Portfolio() {
  const { data, error, refresh } = usePoll<PortfolioDTO>("/api/portfolio");
  const [tab, setTab] = useState<Tab>("open");
  const now = useWorldNow();

  useEffect(() => trackEvent("portfolio_viewed"), []);

  if (error && !data) return <ErrorState message={error.message} onRetry={() => void refresh()} />;
  if (!data) return <Skeleton className="mt-6 h-64" />;

  const total = data.balance + data.openValue;
  const closed = [...data.settled, ...data.closed].sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));

  return (
    <div className="pt-6">
      <section aria-label="Summary">
        <p className="text-sm font-medium text-muted">Portfolio value</p>
        <p className="tabular mt-1 text-4xl font-semibold tracking-tight">{credits(total, { decimals: 2 })}</p>
        <div className="card mt-5 grid grid-cols-2 gap-4 p-4 md:grid-cols-5">
          <Stat label="Cash" value={credits(data.balance, { decimals: 2 })} />
          <Stat label="Positions" value={credits(data.openValue, { decimals: 2 })} />
          <Stat
            label="Unrealized P&L"
            value={credits(data.unrealizedPnl, { sign: true, decimals: 2 })}
            sub={<Change value={data.openValue - data.unrealizedPnl > 0 ? data.unrealizedPnl / (data.openValue - data.unrealizedPnl) : null} />}
          />
          <Stat label="Realized P&L" value={credits(data.realizedPnl, { sign: true, decimals: 2 })} sub={<Link href="/wallet" className="text-muted underline">Wallet history</Link>} />
          <Stat label="Accuracy" value={data.accuracy === null ? "—" : percent(data.accuracy)} sub={data.accuracy === null ? <span className="text-muted">After first settlement</span> : <span className="text-muted">Settled positions on the winning range</span>} />
        </div>
      </section>

      <Tabs
        className="mt-8"
        label="Positions"
        value={tab}
        onChange={setTab}
        options={[
          { value: "open", label: `Positions${data.open.length ? ` · ${data.open.length}` : ""}` },
          { value: "settled", label: "Settled" },
          { value: "history", label: "History" },
        ]}
      />

      {tab === "open" && (
        <>
          {data.open.length === 0 ? (
            <Empty title="No open positions.">
              <Link href="/" className="font-semibold text-indigo">
                Browse markets →
              </Link>
            </Empty>
          ) : (
            <Table head={["Market", "Shares", "Avg → Now", "Value", "Return", ""]}>
              {data.open.map((p) => (
                <OpenRow key={p.id} p={p} now={now} />
              ))}
            </Table>
          )}
        </>
      )}

      {tab === "settled" &&
        (closed.length === 0 ? (
          <Empty title="Nothing settled yet." />
        ) : (
          <Table head={["Market", "Result", "Entry", "Payout", "Net", ""]}>
            {closed.map((p) => (
              <ClosedRow key={p.id} p={p} />
            ))}
          </Table>
        ))}

      {tab === "history" &&
        (data.trades.length === 0 ? (
          <Empty title="No trades yet." />
        ) : (
          <Table head={["Market", "Side", "Shares", "Price", "Amount", "When"]}>
            {data.trades.map((t) => (
              <tr key={t.id} className="hover:bg-wash/60">
                <td className="py-3 pr-2">
                  <Link href={`/markets/${t.marketId}`} className="block min-w-0">
                    <span className="block truncate font-semibold">{t.side === "BUY" ? "Bought" : "Sold"} {t.outcomeLabel}</span>
                    <span className="block truncate text-xs text-muted">@{t.creatorHandle}</span>
                  </Link>
                </td>
                <td className="px-2 py-3 text-right">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${t.side === "BUY" ? "bg-blue/10 text-up" : "bg-violet/12 text-[#7a4ee0]"}`}>{t.side === "BUY" ? "Buy" : "Sell"}</span>
                </td>
                <td className="px-2 py-3 text-right">{t.shares.toFixed(2)}</td>
                <td className="px-2 py-3 text-right">{price(t.price)}</td>
                <td className="px-2 py-3 text-right font-semibold">
                  {t.side === "BUY" ? "−" : "+"}
                  {credits(t.credits, { decimals: 2 })}
                  {t.side === "SELL" && <span className="block text-xs font-normal text-muted">{credits(t.realizedPnl, { sign: true, decimals: 2 })} P&L</span>}
                </td>
                <td className="py-3 pl-2 text-right text-xs text-muted">{duration(now - t.createdAt)} ago</td>
              </tr>
            ))}
          </Table>
        ))}
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      {/* On phones, columns 2–3 collapse so the value and action stay on screen. */}
      <table className="tabular w-full text-sm max-sm:[&_:is(td,th):nth-child(2)]:hidden max-sm:[&_:is(td,th):nth-child(3)]:hidden sm:min-w-[640px]">
        <thead>
          <tr className="text-left text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} className={`py-2.5 font-medium ${i === 0 ? "pr-2" : "px-2 text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function MarketCell({ p, sub }: { p: PositionDTO; sub: string }) {
  return (
    <Link href={`/markets/${p.marketId}`} className="flex min-w-0 items-center gap-3">
      <Thumbnail hue={p.market.thumbnailHue} showPlay={false} seed={p.market.thumbnailUrl ? undefined : p.market.videoId} src={p.market.thumbnailUrl} className="size-9" />
      <span className="min-w-0">
        <span className="block truncate font-semibold">{p.outcomeLabel}</span>
        <span className="block truncate text-xs text-muted">
          @{p.market.creatorHandle} · {sub}
        </span>
      </span>
    </Link>
  );
}

function OpenRow({ p, now }: { p: PositionDTO; now: number }) {
  const open = p.market.status === "OPEN" && now < p.market.locksAt;
  const paused = p.market.status === "PAUSED";
  return (
    <tr className="hover:bg-wash/60">
      <td className="py-3 pr-2">
        <MarketCell p={p} sub={open ? `${duration(p.market.locksAt - now)} left` : paused ? "Paused" : "Settling"} />
      </td>
      <td className="px-2 py-3 text-right">{p.shares.toFixed(2)}</td>
      <td className="px-2 py-3 text-right text-ink-soft">
        {price(p.averageEntryPrice)} → {price(p.currentPrice)}
      </td>
      <td className="px-2 py-3 text-right font-semibold">{credits(p.value, { decimals: 2 })}</td>
      <td className="px-2 py-3 text-right">
        <span className="block font-semibold">{credits(p.unrealizedPnl, { sign: true, decimals: 2 })}</span>
        <Change value={p.averageEntryPrice > 0 ? p.currentPrice / p.averageEntryPrice - 1 : null} className="text-[11px]" />
      </td>
      <td className="py-3 pl-2 text-right">
        {open && (
          <Link href={`/markets/${p.marketId}`} className="btn-solid inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-semibold">
            Sell
          </Link>
        )}
      </td>
    </tr>
  );
}

function ClosedRow({ p }: { p: PositionDTO }) {
  const label = p.status === "CANCELLED" ? "Refunded" : p.status === "CLOSED" ? "Sold early" : p.settlement?.won ? "Won" : "Lost";
  return (
    <tr className="hover:bg-wash/60">
      <td className="py-3 pr-2">
        <MarketCell p={p} sub={p.market.winningLabel ? `${p.market.winningLabel} won` : label} />
      </td>
      <td className="px-2 py-3 text-right">
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${label === "Won" ? "bg-blue/10 text-up" : "bg-wash text-ink-soft"}`}>{label}</span>
      </td>
      <td className="px-2 py-3 text-right">{price(p.averageEntryPrice)}</td>
      <td className="px-2 py-3 text-right">{p.settlement && p.status !== "CLOSED" ? credits(p.settlement.payout, { decimals: 2 }) : "—"}</td>
      <td className="px-2 py-3 text-right font-semibold">
        {p.realizedPnl > 0 ? "▲ " : p.realizedPnl < 0 ? "▼ " : ""}
        {credits(p.realizedPnl, { sign: true, decimals: 2 })}
      </td>
      <td className="py-3 pl-2 text-right">
        {p.realizedPnl > 0 && (
          <Link href={`/share/${p.id}`} className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-xs font-semibold">
            Share
          </Link>
        )}
      </td>
    </tr>
  );
}
