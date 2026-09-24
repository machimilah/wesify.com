"use client";

import Link from "next/link";
import { useApp } from "@/components/AppProvider";
import { ConnectedAccounts } from "@/components/ConnectedAccounts";
import { RequireAccount } from "@/components/RequireAccount";
import { ErrorState, SecondaryButton, Skeleton, Stat } from "@/components/ui";
import { usePoll } from "@/lib/client/hooks";
import type { ProfileDTO } from "@/lib/shared/dto";
import { credits, percent } from "@/lib/shared/format";

export default function ProfilePage() {
  return (
    <RequireAccount title="Your profile">
      <Profile />
    </RequireAccount>
  );
}

function Profile() {
  const { data, error, refresh } = usePoll<ProfileDTO>("/api/profile", { intervalMs: 30_000 });
  const { logout, isDemo, config } = useApp();
  if (error && !data) return <ErrorState message={error.message} onRetry={() => void refresh()} />;
  if (!data) return <Skeleton className="mt-6 h-64" />;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pt-6">
      <div className="flex items-center gap-4">
        <div
          className="grid size-14 shrink-0 place-items-center rounded-full text-xl font-semibold text-white"
          style={{ background: `linear-gradient(135deg, hsl(${data.avatarHue} 90% 62%), hsl(${data.avatarHue + 40} 75% 60%))` }}
          aria-hidden="true"
        >
          {data.username.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate-anywhere text-2xl font-semibold tracking-tight">{data.username}</h1>
          <p className="text-sm text-muted">
            Joined {new Date(data.joinedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            {data.rank ? ` · #${data.rank} all time` : ""}
          </p>
        </div>
        {!isDemo && <SecondaryButton onClick={() => void logout()}>Log out</SecondaryButton>}
      </div>

      <div className="card grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
        <Stat label="Cash (W$)" value={credits(data.balance, { decimals: 0 })} />
        <Stat label="Realized P&L" value={credits(data.realizedPnl, { sign: true, decimals: 0 })} />
        <Stat label="Markets traded" value={data.marketsTraded} />
        <Stat label="Win rate" value={data.winRate === null ? "—" : percent(data.winRate)} sub={<span className="text-muted">Profitable exits</span>} />
        <Stat label="Accuracy" value={data.accuracy === null ? "—" : percent(data.accuracy)} sub={<span className="text-muted">Held to a winning result</span>} />
        <Stat label="Current streak" value={data.streak > 0 ? `${data.streak} ▲` : "0"} />
        <Stat label="Trades" value={data.totalTrades} />
        <Stat label="Rank (all time)" value={data.rank ? `#${data.rank}` : "—"} sub={data.rank ? undefined : <span className="text-muted">5 trades to rank</span>} />
      </div>

      <div className="card divide-y divide-line">
        <div className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">Best trade</p>
            {data.bestTrade ? (
              <Link href={`/markets/${data.bestTrade.marketId}`} className="block truncate font-semibold hover:underline">
                {data.bestTrade.outcomeLabel} <span className="font-normal text-muted">· @{data.bestTrade.creatorHandle}</span>
              </Link>
            ) : (
              <p className="text-sm text-muted">Close a winning position to see it here.</p>
            )}
          </div>
          {data.bestTrade && <span className="tabular text-gradient text-lg font-semibold">{credits(data.bestTrade.pnl, { sign: true, decimals: 2 })}</span>}
        </div>
        <ProfileLink href="/wallet" title="Wallet" sub="Every W$ change with its reason" />
        <ProfileLink href="/leaderboard" title="Leaderboard" />
        <ProfileLink href="/settings" title="Account settings" sub="Email, password, notifications, privacy, delete account" />
        <ProfileLink href="/creator" title="Creator studio" sub="Open markets on your own videos (invite only)" />
        {config?.flags.referrals && (
          <div className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs font-medium text-muted">Invite friends</p>
              <p className="tabular font-semibold tracking-wider">{data.referralCode}</p>
            </div>
            <p className="text-right text-xs text-muted">You both get W$1,000 once they&apos;ve made 3 trades.</p>
          </div>
        )}
        <ProfileLink href="/support" title="Help & support" />
      </div>

      <ConnectedAccounts accounts={data.connectedAccounts} onChange={() => void refresh()} />

      <p className="text-center text-xs text-muted">Wesify Credits have no monetary value.</p>
    </div>
  );
}

function ProfileLink({ href, title, sub }: { href: string; title: string; sub?: string }) {
  return (
    <Link href={href} className="flex min-h-14 items-center justify-between p-4 hover:bg-wash/60">
      <span>
        <span className="block font-semibold">{title}</span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
      <span aria-hidden="true" className="text-muted">→</span>
    </Link>
  );
}
