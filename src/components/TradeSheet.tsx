"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, newIdempotencyKey, trackEvent } from "@/lib/client/api";
import { priceAfterBuy, quoteBuyShares, quoteSellProceeds } from "@/lib/market-engine/quote";
import type { MarketDetailDTO } from "@/lib/shared/dto";
import { credits, percent, price } from "@/lib/shared/format";
import { useApp } from "./AppProvider";
import { PrimaryButton, Thumbnail } from "./ui";

type Mode = "buy" | "sell";

type PanelProps = {
  market: MarketDetailDTO;
  outcomeId: string;
  onOutcomeChange: (id: string) => void;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  tradable: boolean;
  onDone: () => void;
  onClose?: () => void;
  /** Tighter spacing and no ticket header — for the inline ticket beside the chart. */
  compact?: boolean;
};

type Receipt = {
  tradeId: string;
  outcomeLabel: string;
  side: "BUY" | "SELL";
  shares: number;
  averagePrice: number;
  credits: number;
  realizedPnl: number;
  priceAfter: number;
  balanceAfter: number;
  createdAt: number;
};

const floor2 = (n: number) => Math.floor(n * 100) / 100;

/**
 * Order ticket (§8, §9). Enter → Review → Confirm → Receipt. Every order carries an
 * Idempotency-Key that stays the same across retries of that order, so a double tap or a flaky
 * network can never execute it twice, and the price the user reviewed so the server rejects the
 * order if the market moved meaningfully in between.
 */
export function TradePanel({ market, outcomeId, onOutcomeChange, mode, onModeChange, tradable, onDone, onClose, compact = false }: PanelProps) {
  const k = (regular: string, tight: string) => (compact ? tight : regular);
  const { me, refreshMe } = useApp();
  const outcome = market.outcomes.find((o) => o.id === outcomeId) ?? market.outcomes[0];
  const position = market.positions.find((p) => p.outcomeId === outcome.id && p.status === "OPEN");
  const held = market.positions.filter((p) => p.status === "OPEN");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ price: number; key: string } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const tracked = useRef<string | null>(null);

  // Selling needs an outcome the user actually holds.
  useEffect(() => {
    if (mode === "sell" && !position && held.length > 0) onOutcomeChange(held[0].outcomeId);
    if (mode === "sell" && held.length === 0) onModeChange("buy");
  }, [mode, position, held, onOutcomeChange, onModeChange]);

  // Reset the input when switching side or outcome.
  useEffect(() => {
    setError(null);
    setReview(null);
    setAmount(mode === "buy" ? "" : position ? String(floor2(position.shares)) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, outcome.id]);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;
  const b = market.liquidity;
  const maxBuy = market.limits?.maxBuy ?? 0;
  const balance = market.balance ?? me?.balance ?? 0;
  const insufficient = mode === "buy" && valid && value > balance;
  const overLimit = mode === "buy" && valid && !insufficient && value > maxBuy;
  const overSell = mode === "sell" && valid && position && value > floor2(position.shares) + 0.005;

  const markStarted = () => {
    const key = `${mode}:${outcome.id}`;
    if (tracked.current === key) return;
    tracked.current = key;
    trackEvent("trade_started", { market_id: market.id, outcome: outcome.label, price: outcome.price, mode });
  };

  const shares = mode === "buy" ? quoteBuyShares(outcome.price, b, valid ? value : 0) : Math.min(valid ? value : 0, position?.shares ?? 0);
  const proceeds = mode === "sell" ? quoteSellProceeds(outcome.price, b, shares) : 0;
  const newAvg = mode === "buy" && shares > 0 ? ((position?.shares ?? 0) * (position?.averageEntryPrice ?? 0) + value) / ((position?.shares ?? 0) + shares) : null;
  const slippage = mode === "buy" && shares > 0 ? value / shares - outcome.price : mode === "sell" && shares > 0 ? outcome.price - proceeds / shares : 0;

  const startReview = () => {
    setError(null);
    setReview({ price: outcome.price, key: newIdempotencyKey() });
  };

  const confirm = async () => {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      const r =
        mode === "buy"
          ? await api<{ receipt: Receipt }>(`/api/markets/${market.id}/buy`, {
              method: "POST",
              body: { outcomeId: outcome.id, credits: value, expectedPrice: review.price },
              idempotencyKey: review.key,
            })
          : await api<{ receipt: Receipt }>(`/api/markets/${market.id}/sell`, {
              method: "POST",
              body: { outcomeId: outcome.id, shares: position && value >= floor2(position.shares) ? position.shares : value, expectedPrice: review.price },
              idempotencyKey: review.key,
            });
      setReceipt(r.receipt);
      setReview(null);
      setAmount("");
      await refreshMe();
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "PRICE_CHANGED") {
        // Refresh the quote; the user reviews the new price with a new key.
        onDone();
        setReview(null);
      }
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (receipt) {
    return (
      <div role="status" aria-live="polite">
        <p id={compact ? undefined : "ticket-title"} className="text-xs font-medium uppercase tracking-wide text-success">{receipt.side === "BUY" ? "Order filled" : "Sold"}</p>
        <p className="mt-1 text-lg font-semibold">
          {receipt.side === "BUY" ? `Bought ${receipt.shares.toFixed(2)} shares of ${receipt.outcomeLabel}` : `Sold for ${credits(receipt.credits, { decimals: 2 })} (${credits(receipt.realizedPnl, { sign: true, decimals: 2 })})`}
        </p>
        <dl className="tabular mt-3 space-y-1.5 text-sm">
          <Row label={receipt.side === "BUY" ? "You paid" : "You received"} value={credits(receipt.credits, { decimals: 2 })} />
          <Row label="Average price" value={price(receipt.averagePrice)} />
          {receipt.side === "BUY" && <Row label={`Pays if ${receipt.outcomeLabel} wins`} value={credits(receipt.shares, { decimals: 2 })} />}
          <Row label="Price now" value={percent(receipt.priceAfter)} />
          <Row label="Cash balance" value={credits(receipt.balanceAfter, { decimals: 2 })} />
          <Row label="Time" value={new Date(receipt.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })} />
          <Row label="Receipt" value={receipt.tradeId.slice(-10)} />
        </dl>
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn btn-secondary flex-1" onClick={() => setReceipt(null)}>
            New order
          </button>
          {onClose ? (
            <button type="button" className="btn btn-primary flex-1" onClick={onClose}>
              Done
            </button>
          ) : (
            <Link href="/portfolio" className="btn btn-primary flex-1">
              Portfolio
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {!compact && (
        <div className="mb-4 flex items-center gap-3">
          <Thumbnail hue={market.video.thumbnailHue} showPlay={false} seed={market.video.simulated ? market.video.id : undefined} src={market.video.thumbnailUrl} className="size-9" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted">@{market.video.creatorHandle} · likes in 24h</p>
            <p id="ticket-title" className="truncate text-base font-semibold">
              {mode === "buy" ? "Buy" : "Sell"} {outcome.label}
            </p>
          </div>
          {onClose && (
            <button onClick={onClose} aria-label="Close" className="grid size-11 place-items-center rounded-lg text-muted hover:bg-wash">
              ✕
            </button>
          )}
        </div>
      )}

      <div role="tablist" aria-label="Order side" className="flex gap-5">
        {(["buy", "sell"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => onModeChange(m)}
            disabled={m === "sell" && held.length === 0}
            className={`-mb-px ${k("min-h-11", "min-h-10")} border-b-2 text-sm font-semibold capitalize disabled:cursor-not-allowed disabled:opacity-40 ${mode === m ? "border-indigo text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {m}
          </button>
        ))}
      </div>

      <label className={`${k("mt-4", "mt-3")} block`} hidden={compact && mode === "buy"}>
        <span className="text-xs font-medium text-muted">Outcome</span>
        <select
          value={outcome.id}
          onChange={(e) => onOutcomeChange(e.target.value)}
          className={`tabular mt-1 ${k("h-11", "h-11")} w-full rounded-lg border border-line bg-surface px-3 text-base font-semibold outline-none focus:border-indigo`}
        >
          {(mode === "sell" ? market.outcomes.filter((o) => held.some((p) => p.outcomeId === o.id)) : market.outcomes).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label} · {percent(o.price)} · W${o.price.toFixed(2)}
            </option>
          ))}
        </select>
      </label>

      {!tradable || (mode === "buy" && !market.tradingEnabled) || (mode === "sell" && !market.sellingEnabled) ? (
        <p className="mt-5 rounded-lg bg-wash px-4 py-3 text-sm font-medium text-ink-soft" role="status">
          {market.status === "SETTLED" || market.status === "CANCELLED"
            ? "This market has ended."
            : market.status === "DRAFT"
              ? "This market is waiting for review."
              : !market.tradingEnabled || !market.sellingEnabled
                ? "Trading is paused across Wesify for maintenance. Your positions are safe."
                : market.status === "PAUSED"
                  ? `Trading is paused. ${market.pausedReason ?? ""}`
                  : "Trading has ended. Settlement is in progress."}
        </p>
      ) : market.isOwnMarket && mode === "buy" ? (
        <p role="note" className="mt-5 rounded-lg bg-wash px-4 py-3 text-sm font-medium text-ink-soft">
          This is your market. Creators can’t bet on markets they created or on their own videos.
        </p>
      ) : !me ? (
        <Link href="/welcome" className="bg-gradient-main mt-5 flex min-h-12 items-center justify-center rounded-lg text-base font-semibold">
          Sign up to trade · get W$10,000
        </Link>
      ) : me.status === "frozen" ? (
        <p className="notice notice-warning mt-5">Your account is under review, so trading is paused. Contact support if you have questions.</p>
      ) : review ? (
        <div className="mt-4 space-y-3" aria-live="polite">
          <p className="text-sm font-semibold">Review your order</p>
          <dl className="tabular space-y-1.5 text-sm">
            <Row label="Order" value={`${mode === "buy" ? "Buy" : "Sell"} ${outcome.label}`} />
            <Row label="Price now" value={`${percent(review.price)} (W$${review.price.toFixed(2)})`} />
            {mode === "buy" ? (
              <>
                <Row label="You pay" value={credits(value, { decimals: 2 })} />
                <Row label="You get about" value={`${shares.toFixed(2)} shares`} />
                <Row label={`Pays if ${outcome.label} wins`} value={credits(shares, { decimals: 2 })} />
                <Row label="Cash after" value={credits(balance - value, { decimals: 2 })} />
              </>
            ) : (
              <>
                <Row label="You sell" value={`${shares.toFixed(2)} shares`} />
                <Row label="You receive about" value={credits(proceeds, { decimals: 2 })} />
                <Row label="Cash after" value={credits(balance + proceeds, { decimals: 2 })} />
              </>
            )}
          </dl>
          <p className="text-xs text-muted">If the price moves more than 3 points before your order reaches us, we&apos;ll stop and show you the new price.</p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary flex-1" onClick={() => setReview(null)} disabled={busy}>
              Edit
            </button>
            <PrimaryButton onClick={confirm} disabled={busy} className="flex-1" aria-busy={busy}>
              {busy ? "Confirming…" : mode === "buy" ? `Confirm buy` : `Confirm sell`}
            </PrimaryButton>
          </div>
        </div>
      ) : (
        <div className={compact ? "mt-3 grid grid-cols-2 items-start gap-x-4" : ""}>
          <div className="min-w-0">
            <label className={`${k("mt-4", "mt-0")} block`}>
              <span className="flex items-center justify-between text-xs font-medium text-muted">
                <span>{mode === "buy" ? "Amount" : "Shares"}</span>
                <span className="tabular">{mode === "buy" ? (compact ? `Max ${credits(maxBuy, { decimals: 0 })}` : `Cash ${credits(balance, { decimals: 0 })} · Max ${credits(maxBuy, { decimals: 0 })}`) : position ? `You own ${position.shares.toFixed(2)}` : ""}</span>
              </span>
              <div className={`mt-1 flex ${k("h-12", "h-11")} items-center rounded-lg border px-3 focus-within:border-indigo ${insufficient || overLimit || overSell ? "border-danger" : "border-line"}`}>
                {mode === "buy" && <span className="text-lg font-semibold text-muted">W$</span>}
                <input
                  inputMode="decimal"
                  value={amount}
                  placeholder="0"
                  onFocus={(e) => {
                    markStarted();
                    // Keep the field visible above the on-screen keyboard (§62).
                    setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
                  }}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  className="tabular h-full w-full bg-transparent pl-1 text-right text-xl font-semibold outline-none placeholder:text-line-strong"
                  aria-label={mode === "buy" ? "Amount in W$" : "Shares to sell"}
                  aria-invalid={insufficient || overLimit || Boolean(overSell)}
                />
              </div>
            </label>

            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {mode === "buy"
                ? ([
                    ["+10", () => setAmount(String(Math.min(maxBuy, (valid ? value : 0) + 10)))],
                    ["+50", () => setAmount(String(Math.min(maxBuy, (valid ? value : 0) + 50)))],
                    ["+100", () => setAmount(String(Math.min(maxBuy, (valid ? value : 0) + 100)))],
                    ["Max", () => setAmount(String(Math.floor(maxBuy)))],
                  ] as const).map(([label, fn]) => <Chip key={label} onClick={fn}>{label}</Chip>)
                : position &&
                  ([
                    ["25%", 0.25],
                    ["50%", 0.5],
                    ["75%", 0.75],
                    ["All", 1],
                  ] as const).map(([label, f]) => (
                    <Chip key={label} onClick={() => setAmount(String(floor2(position.shares * f)))}>
                      {label}
                    </Chip>
                  ))}
            </div>
          </div>

          <div className="min-w-0">
            <dl className={`tabular ${k("mt-5 space-y-2", "mt-0 space-y-1.5")} text-sm`}>
              {mode === "buy" ? (
                <>
                  <Row label="Price now" value={`${percent(outcome.price)} · ${price(outcome.price)}`} />
                  <Row label="Avg price" value={shares > 0 ? price(value / shares) : price(outcome.price)} />
                  <Row label="Shares" value={shares.toFixed(2)} />
                  {newAvg !== null && position && <Row label="New avg entry" value={price(newAvg)} />}
                  <Row label="Price after" value={shares > 0 ? percent(priceAfterBuy(outcome.price, b, shares)) : "—"} />
                </>
              ) : (
                position && (
                  <>
                    <Row label="Avg entry → now" value={`${price(position.averageEntryPrice)} → ${price(outcome.price)}`} />
                    <Row label="Position value" value={credits(position.value, { decimals: 2 })} />
                    <Row label="Unrealized P&L" value={credits(position.unrealizedPnl, { sign: true, decimals: 2 })} />
                    <Row label="Realized on this sale" value={credits(proceeds - shares * position.averageEntryPrice, { sign: true, decimals: 2 })} />
                  </>
                )
              )}
              {slippage > 0.005 && <Row label="Price impact" value={`${(slippage * 100).toFixed(1)} pts`} />}
            </dl>

            <div className={`${k("mt-4 pt-4", "mt-2")} flex items-end justify-between`}>
              <span className="text-sm font-medium text-ink-soft">{mode === "buy" ? `If ${outcome.label} wins` : "You receive"}</span>
              <span className="tabular text-gradient text-2xl font-semibold">{credits(mode === "buy" ? shares : proceeds, { decimals: 2 })}</span>
            </div>

            <PrimaryButton onClick={startReview} disabled={!valid || busy || insufficient || overLimit || Boolean(overSell)} className={`w-full ${k("mt-4", "mt-2 min-h-11!")}`}>
              Review {mode === "buy" ? "buy" : "sell"}
            </PrimaryButton>
          </div>

          {(insufficient || overLimit || overSell) && (
            <p role="alert" className={`mt-3 rounded-lg bg-wash px-3 py-2.5 text-sm font-medium text-ink-soft ${compact ? "col-span-2" : ""}`}>
              {insufficient
                ? `Not enough W$. You have ${credits(balance, { decimals: 2 })}.`
                : overLimit
                  ? `Max ${credits(maxBuy, { decimals: 0 })} per trade here (20% of your cash, 50% of your portfolio per market).`
                  : "You don't have that many shares."}
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-wash px-3 py-2.5 text-sm font-medium text-ink-soft">
          {error}
        </p>
      )}
      <p className={`${k("mt-3", "mt-1.5")} text-center text-[11px] text-muted`}>Wesify Credits have no monetary value.</p>
    </div>
  );
}

/** Mobile bottom sheet wrapping the order ticket. */
export function TradeSheet(props: Omit<PanelProps, "onClose"> & { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" onClick={props.onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-title"
        className="animate-rise max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <TradePanel {...props} />
      </div>
    </div>
  );
}

function Chip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="tabular min-h-11 rounded-md border border-line text-xs font-semibold hover:bg-wash">
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}
