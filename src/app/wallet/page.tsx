"use client";

import Link from "next/link";
import { useState } from "react";
import { RequireAccount } from "@/components/RequireAccount";
import { Empty, ErrorState, Skeleton, Stat } from "@/components/ui";
import { api } from "@/lib/client/api";
import { usePoll } from "@/lib/client/hooks";
import type { WalletDTO, WalletEntryDTO } from "@/lib/shared/dto";
import { credits } from "@/lib/shared/format";

/** W$ wallet (checklist §10): balance, totals by kind, and every ledger row with its reason. */
export default function WalletPage() {
  return (
    <RequireAccount title="Your wallet">
      <Wallet />
    </RequireAccount>
  );
}

const LABELS: Record<string, string> = {
  WELCOME_BONUS: "Welcome credits",
  BUY: "Trades (buys)",
  SELL: "Trades (sells)",
  SETTLEMENT: "Payouts",
  CANCELLATION_REFUND: "Refunds",
  ADMIN_ADJUSTMENT: "Adjustments",
  ADMIN_REFUND: "Support refunds",
  REFERRAL: "Referral rewards",
};

function Wallet() {
  const { data, error, refresh } = usePoll<WalletDTO>("/api/wallet", { intervalMs: 30_000 });
  const [older, setOlder] = useState<WalletEntryDTO[]>([]);
  const [cursor, setCursor] = useState<number | null | undefined>(undefined);

  if (error && !data) return <ErrorState message={error.message} onRetry={() => void refresh()} />;
  if (!data) return <Skeleton className="mt-6 h-64" />;
  const next = cursor === undefined ? data.nextCursor : cursor;
  const loadMore = async () => {
    if (!next) return;
    const page = await api<WalletDTO>(`/api/wallet?cursor=${next}`);
    setOlder((o) => [...o, ...page.entries]);
    setCursor(page.nextCursor);
  };
  const entries = [...data.entries, ...older];

  return (
    <div className="mx-auto max-w-3xl space-y-6 pt-6">
      <section aria-label="Balance">
        <p className="text-sm font-medium text-muted">W$ balance (play money)</p>
        <p className="tabular mt-1 text-4xl font-semibold tracking-tight">{credits(data.balance, { decimals: 2 })}</p>
        <p className="mt-1 text-xs text-muted">
          {data.reconciled ? "✓ Matches your transaction history below." : "We're checking your balance against your history."} W$ has no monetary value and can&apos;t be withdrawn.
        </p>
      </section>

      <div className="card grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
        {Object.entries(data.totals).map(([type, total]) => (
          <Stat key={type} label={LABELS[type] ?? type} value={credits(total ?? 0, { sign: true, decimals: 0 })} />
        ))}
      </div>

      <section aria-label="Transactions">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">History</h2>
        {entries.length === 0 ? (
          <Empty title="No transactions yet." />
        ) : (
          <ul className="card divide-y divide-line">
            {entries.map((e) => (
              <li key={e.id} className="tabular flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{e.description}</p>
                  <p className="text-xs text-muted">
                    {new Date(e.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {e.marketId && (
                      <>
                        {" · "}
                        <Link href={`/markets/${e.marketId}`} className="underline">
                          View market
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold">
                    <span aria-hidden="true">{e.amount >= 0 ? "▲ " : "▼ "}</span>
                    {credits(e.amount, { sign: true, decimals: 2 })}
                  </p>
                  <p className="text-xs text-muted">Balance {credits(e.balanceAfter, { decimals: 2 })}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {next ? (
          <div className="mt-4 text-center">
            <button type="button" className="btn btn-secondary" onClick={() => void loadMore()}>
              Load older
            </button>
          </div>
        ) : null}
      </section>
      <p className="text-center text-xs text-muted">
        Something missing? <Link href="/support?category=missing_credits" className="underline">Tell us</Link> and we&apos;ll check it against the ledger.
      </p>
    </div>
  );
}
