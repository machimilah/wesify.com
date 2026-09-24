"use client";

import { useState } from "react";
import { Empty, ErrorState, Skeleton, Tabs } from "@/components/ui";
import { usePoll } from "@/lib/client/hooks";
import type { LeaderboardDTO, LeaderboardPeriod } from "@/lib/shared/dto";
import { credits, percent } from "@/lib/shared/format";

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("today");
  const { data, error, refresh } = usePoll<LeaderboardDTO>(`/api/leaderboard?period=${period}`, { intervalMs: 60_000 });

  return (
    <div className="mx-auto max-w-3xl pt-6">
      <h1 className="text-[28px] font-semibold tracking-tight">Top Traders</h1>
      <p className="mt-1 text-sm text-muted">Realized W$ profit, adjusted for accuracy. Play money only.</p>
      <Tabs
        className="mt-5"
        label="Period"
        value={period}
        onChange={setPeriod}
        options={[
          { value: "today", label: "Today" },
          { value: "7d", label: "This week" },
          { value: "all", label: "All time" },
        ]}
      />
      {error && !data && <ErrorState message={error.message} onRetry={() => void refresh()} />}
      {!data && !error && <Skeleton className="mt-4 h-64" />}
      {data?.me && (
        <div className="card mt-4 flex items-center justify-between gap-3 p-4 text-sm">
          {data.me.eligible ? (
            <span>
              You&apos;re <span className="font-semibold">#{data.me.rank}</span> with {credits(data.me.realizedProfit, { sign: true, decimals: 0 })}.
            </span>
          ) : (
            <span>
              To rank this period: {data.me.tradesNeeded > 0 && `${data.me.tradesNeeded} more trade${data.me.tradesNeeded === 1 ? "" : "s"}`}
              {data.me.tradesNeeded > 0 && data.me.marketsNeeded > 0 && " and "}
              {data.me.marketsNeeded > 0 && `${data.me.marketsNeeded} more market${data.me.marketsNeeded === 1 ? "" : "s"}`}
              {data.me.tradesNeeded === 0 && data.me.marketsNeeded === 0 && "sell a position or hold one to settlement"}.
            </span>
          )}
          <span className="tabular text-muted">{percent(data.me.accuracy)} accurate</span>
        </div>
      )}
      {data && data.rows.length === 0 && <Empty title="No one has qualified yet.">Make 5 trades in 2 markets and close a position to rank.</Empty>}
      {data && data.rows.length > 0 && (
        <table className="tabular mt-2 w-full text-sm">
          <caption className="sr-only">Leaderboard for {period === "today" ? "today" : period === "7d" ? "this week" : "all time"}</caption>
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="w-12 py-2.5 font-medium">#</th>
              <th scope="col" className="py-2.5 font-medium">Trader</th>
              <th scope="col" className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">Accuracy</th>
              <th scope="col" className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">Markets</th>
              <th scope="col" className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">Trades</th>
              <th scope="col" className="py-2.5 text-right font-medium">Profit</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.username} className={r.isMe ? "bg-wash/70" : ""}>
                <td className="py-3">
                  <span className={`grid size-7 place-items-center rounded-md text-xs font-semibold ${r.rank <= 3 ? "bg-gradient-main" : "bg-wash text-ink-soft"}`}>{r.rank}</span>
                </td>
                <td className="max-w-0 py-3">
                  <span className="block truncate font-semibold">
                    {r.username}
                    {r.isMe && <span className="text-gradient font-semibold"> · you</span>}
                    {r.isBot && <span className="badge ml-1.5">SIM</span>}
                    {r.badges.map((b) => (
                      <span key={b} className="badge badge-info ml-1.5">
                        {b}
                      </span>
                    ))}
                  </span>
                  <span className="block text-xs text-muted sm:hidden">
                    {percent(r.accuracy)} accurate · {r.markets} markets · {r.trades} trades
                  </span>
                </td>
                <td className="hidden px-2 py-3 text-right sm:table-cell">{percent(r.accuracy)}</td>
                <td className="hidden px-2 py-3 text-right sm:table-cell">{r.markets}</td>
                <td className="hidden px-2 py-3 text-right sm:table-cell">{r.trades}</td>
                <td className="py-3 text-right font-semibold">{credits(r.realizedProfit, { sign: true, decimals: 0 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && (
        <details className="card mt-6 p-4 text-sm">
          <summary className="min-h-11 cursor-pointer font-semibold">How the ranking works</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
            {data.methodology.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
