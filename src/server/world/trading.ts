import * as lmsr from "@/lib/market-engine/lmsr";
import {
  DEFAULT_PRICE_TOLERANCE,
  MAX_MARKET_FRACTION_OF_PORTFOLIO,
  MAX_POTENTIAL_PAYOUT_PER_MARKET,
  MAX_PRICE_AFTER_BUY,
  MAX_TRADE_FRACTION_OF_BALANCE,
  MAX_TRADES_PER_HOUR,
  MIN_TRADE_CREDITS,
} from "@/lib/shared/constants";
import { newId } from "@/lib/shared/random";
import type { MarketRow, TradeRow, UserRow } from "@/lib/shared/types";
import { flagRisk, notify, track, type Ctx } from "./context";
import { Errors } from "./errors";
import { flagEnabled } from "./flags";
import { floorCents, postLedger, roundCents } from "./ledger";
import {
  getMarket,
  getOrCreatePosition,
  lmsrStateOf,
  recordPositionEvent,
  refreshPrices,
} from "./markets";
import { evaluateReferral } from "./referrals";
import { positionKey } from "./state";

export type TradeReceipt = {
  tradeId: string;
  marketId: string;
  outcomeId: string;
  outcomeLabel: string;
  creatorHandle: string;
  side: "BUY" | "SELL";
  shares: number;
  averagePrice: number;
  credits: number;
  realizedPnl: number;
  priceBefore: number;
  priceAfter: number;
  balanceAfter: number;
  createdAt: number;
};

export type TradeResult = {
  trade: TradeRow;
  receipt: TradeReceipt;
  balance: number;
  position: { shares: number; averageEntryPrice: number; realizedPnl: number };
  prices: Record<string, number>;
};

/** Checks that apply to both sides of a trade: account state, kill switches, market state. */
export function assertCanTrade(ctx: Ctx, user: UserRow, market: MarketRow, side: "BUY" | "SELL") {
  if (user.status === "suspended" || user.status === "deleted") throw Errors.accountSuspended();
  if (user.status === "frozen") throw Errors.accountFrozen();
  if (flagEnabled(ctx, "globalPause")) throw Errors.tradingDisabled();
  if (side === "BUY" && !flagEnabled(ctx, "trading")) throw Errors.tradingDisabled();
  if (side === "SELL" && !flagEnabled(ctx, "selling")) throw Errors.sellingDisabled();
  assertTradable(ctx, market);
}

export function assertTradable(ctx: Ctx, market: MarketRow) {
  if (market.status === "SETTLED" || market.status === "CANCELLED") throw Errors.marketFinished();
  if (market.status === "DRAFT") throw Errors.marketNotOpen();
  if (market.status === "PAUSED") throw Errors.tradingPaused(market.pausedReason);
  if (market.status !== "OPEN" || ctx.now() >= market.locksAt) throw Errors.marketClosed();
}

/**
 * §51: nobody can bet on a market they created or on their own video — whether they opened it
 * from the creator studio, pasted the link themselves, it's tied to one of their connected
 * accounts, or the handle matches one of them.
 */
export function isOwnMarket(ctx: Ctx, userId: string, marketId: string): boolean {
  const { market, video } = getMarket(ctx, marketId);
  if (market.creatorUserId === userId || market.createdByUserId === userId) return true;
  return ctx.state.socialAccounts.some(
    (a) =>
      a.userId === userId &&
      a.status !== "revoked" &&
      (a.id === video.socialAccountId ||
        (a.platform === video.platform && a.handle.toLowerCase() === video.creatorHandle.toLowerCase())),
  );
}

function assertNotCreator(ctx: Ctx, userId: string, marketId: string) {
  if (isOwnMarket(ctx, userId, marketId)) throw Errors.selfTrading();
}

/** Balance + mark-to-market value of all open positions. */
export function portfolioValue(ctx: Ctx, userId: string): { balance: number; positionsValue: number; total: number } {
  const user = ctx.state.users[userId];
  let positionsValue = 0;
  for (const p of Object.values(ctx.state.positions)) {
    if (p.userId !== userId || p.shares <= 1e-9) continue;
    const outcome = ctx.state.outcomes[p.marketId].find((o) => o.id === p.outcomeId)!;
    positionsValue += p.shares * outcome.currentPrice;
  }
  return { balance: user.creditsBalance, positionsValue, total: user.creditsBalance + positionsValue };
}

function costBasis(ctx: Ctx, userId: string, marketId?: string): number {
  return Object.values(ctx.state.positions)
    .filter((p) => p.userId === userId && (!marketId || p.marketId === marketId) && p.shares > 1e-9)
    .reduce((sum, p) => sum + p.shares * p.averageEntryPrice, 0);
}

/**
 * The 50%-per-market cap is measured at cost basis, not mark-to-market, so a trader's own
 * price impact cannot inflate their limit.
 */
export function tradeLimits(ctx: Ctx, userId: string, marketId: string) {
  const user = ctx.state.users[userId];
  const maxPerTrade = floorCents(user.creditsBalance * MAX_TRADE_FRACTION_OF_BALANCE);
  const portfolioAtCost = user.creditsBalance + costBasis(ctx, userId);
  const maxMoreInMarket = floorCents(
    portfolioAtCost * MAX_MARKET_FRACTION_OF_PORTFOLIO - costBasis(ctx, userId, marketId),
  );
  return {
    maxPerTrade,
    maxMoreInMarket: Math.max(0, maxMoreInMarket),
    maxBuy: Math.max(0, Math.min(maxPerTrade, maxMoreInMarket, user.creditsBalance)),
  };
}

function pricesRecord(ctx: Ctx, marketId: string): Record<string, number> {
  return Object.fromEntries(ctx.state.outcomes[marketId].map((o) => [o.id, o.currentPrice]));
}

function assertTradeRate(ctx: Ctx, user: UserRow) {
  if (user.isBot) return;
  const since = ctx.now() - 3_600_000;
  let n = 0;
  for (let i = ctx.state.trades.length - 1; i >= 0; i--) {
    const t = ctx.state.trades[i];
    if (t.createdAt < since) break;
    if (t.userId === user.id && ++n >= MAX_TRADES_PER_HOUR) throw Errors.tradeRate();
  }
}

/** The price the user saw must still hold within tolerance (§8 price changed during order). */
function assertExpectedPrice(expected: number | undefined, actual: number, tolerance = DEFAULT_PRICE_TOLERANCE) {
  if (expected === undefined || !Number.isFinite(expected)) return;
  if (Math.abs(actual - expected) > tolerance) throw Errors.priceChanged(expected, actual);
}

// ---------------------------------------------------------------------------

export type BuyInput = {
  userId: string;
  marketId: string;
  outcomeId: string;
  credits: number;
  /** Price shown when the user confirmed; the order fails if it has moved more than `tolerance`. */
  expectedPrice?: number;
  tolerance?: number;
};

export function buy(ctx: Ctx, input: BuyInput): TradeResult {
  // Validate everything before mutating anything, so a failure leaves no partial state.
  const user = ctx.state.users[input.userId];
  if (!user) throw Errors.unauthorized();
  const { market, outcomes, video } = getMarket(ctx, input.marketId);
  assertCanTrade(ctx, user, market, "BUY");
  const index = outcomes.findIndex((o) => o.id === input.outcomeId);
  if (index < 0) throw Errors.notFound("Outcome");
  if (!Number.isFinite(input.credits)) throw Errors.invalid("Enter an amount.");
  const credits = floorCents(input.credits);
  if (credits < MIN_TRADE_CREDITS) throw Errors.invalid(`Minimum trade is W$${MIN_TRADE_CREDITS}.`);
  if (credits > user.creditsBalance) throw Errors.insufficientCredits();
  assertNotCreator(ctx, user.id, market.id);
  assertTradeRate(ctx, user);
  const limits = tradeLimits(ctx, user.id, market.id);
  if (credits > limits.maxPerTrade) throw Errors.tradeLimit(limits.maxPerTrade);
  if (credits > limits.maxMoreInMarket) throw Errors.marketLimit(limits.maxMoreInMarket);

  const state = lmsrStateOf(market, outcomes);
  const priceBefore = lmsr.prices(state)[index];
  assertExpectedPrice(input.expectedPrice, priceBefore, input.tolerance);
  const shares = lmsr.sharesForCredits(state, index, credits);
  if (!(shares > 0) || !Number.isFinite(shares)) throw Errors.invalid("Trade too small.");
  const priceAfter = lmsr.prices(lmsr.withQuantityDelta(state, index, shares))[index];
  if (priceAfter > MAX_PRICE_AFTER_BUY) throw Errors.priceBound();
  const existing = ctx.state.positions[positionKey(user.id, market.id, input.outcomeId)];
  if (!user.isBot && (existing?.shares ?? 0) + shares > MAX_POTENTIAL_PAYOUT_PER_MARKET) throw Errors.exposureLimit(MAX_POTENTIAL_PAYOUT_PER_MARKET);

  // Commit.
  const now = ctx.now();
  const outcome = outcomes[index];
  const tradeId = newId("trd");
  postLedger(ctx, {
    userId: user.id,
    type: "BUY",
    amount: -credits,
    referenceType: "trade",
    referenceId: tradeId,
    description: `Bought ${outcome.label} on @${video.creatorHandle}`,
  });
  outcome.quantity += shares;
  refreshPrices(ctx, market, now);

  const position = getOrCreatePosition(ctx, user.id, market.id, input.outcomeId);
  const newShares = position.shares + shares;
  position.averageEntryPrice = (position.shares * position.averageEntryPrice + credits) / newShares;
  position.shares = newShares;
  position.totalBought = roundCents(position.totalBought + credits);
  position.closedAt = null;
  position.settlement = null;
  position.updatedAt = now;

  const trade: TradeRow = {
    id: tradeId,
    userId: user.id,
    marketId: market.id,
    outcomeId: input.outcomeId,
    side: "BUY",
    shares,
    price: credits / shares,
    credits,
    realizedPnl: 0,
    priceBefore,
    priceAfter: outcome.currentPrice,
    createdAt: now,
  };
  ctx.state.trades.push(trade);

  if (!user.isBot) {
    checkTradeRisk(ctx, trade, user.creditsBalance + credits);
    notify(ctx, {
      userId: user.id,
      kind: "TRADE",
      title: `Bought ${shares.toFixed(2)} shares of ${outcome.label}.`,
      body: `W$${credits.toFixed(2)} at ${Math.round((credits / shares) * 100)}¢ average on @${video.creatorHandle}. Pays W$${shares.toFixed(2)} if it wins.`,
      marketId: market.id,
    });
    evaluateReferral(ctx, user.id);
  }
  const isFirst = !user.isBot && ctx.state.trades.filter((t) => t.userId === user.id).length === 1;
  track(ctx, "trade_completed", user.id, {
    market_id: market.id,
    video_id: video.id,
    platform: video.platform,
    outcome: outcome.label,
    price: priceBefore,
    trade_size: credits,
    user_balance: user.creditsBalance,
    video_age: now - video.publishedAt,
    momentum_score: market.momentumScore,
    first_trade: isFirst,
    ms_since_signup: now - user.createdAt,
  });

  return {
    trade,
    receipt: receiptOf(ctx, trade, outcome.label, video.creatorHandle, user.creditsBalance),
    balance: user.creditsBalance,
    position: { shares: position.shares, averageEntryPrice: position.averageEntryPrice, realizedPnl: position.realizedPnl },
    prices: pricesRecord(ctx, market.id),
  };
}

export type SellInput = { userId: string; marketId: string; outcomeId: string; shares: number; expectedPrice?: number; tolerance?: number };

export function sell(ctx: Ctx, input: SellInput): TradeResult {
  const user = ctx.state.users[input.userId];
  if (!user) throw Errors.unauthorized();
  const { market, outcomes, video } = getMarket(ctx, input.marketId);
  const position = ctx.state.positions[positionKey(user.id, market.id, input.outcomeId)];
  if (!position || position.shares <= 1e-9) throw Errors.noPosition();
  assertCanTrade(ctx, user, market, "SELL");
  if (!Number.isFinite(input.shares) || input.shares <= 0) throw Errors.invalid("Enter shares to sell.");
  if (input.shares > position.shares + 1e-6) throw Errors.noPosition();
  assertTradeRate(ctx, user);
  // Selling (nearly) everything closes the position exactly.
  const shares = input.shares >= position.shares - 1e-6 ? position.shares : input.shares;

  const index = outcomes.findIndex((o) => o.id === input.outcomeId);
  const state = lmsrStateOf(market, outcomes);
  const priceBefore = lmsr.prices(state)[index];
  assertExpectedPrice(input.expectedPrice, priceBefore, input.tolerance);
  const proceeds = floorCents(lmsr.proceedsForShares(state, index, shares));
  const basis = shares * position.averageEntryPrice;
  const realized = roundCents(proceeds - basis);

  const now = ctx.now();
  const outcome = outcomes[index];
  const tradeId = newId("trd");
  if (proceeds > 0) {
    postLedger(ctx, {
      userId: user.id,
      type: "SELL",
      amount: proceeds,
      referenceType: "trade",
      referenceId: tradeId,
      description: `Sold ${outcome.label} on @${video.creatorHandle}`,
    });
  }
  outcome.quantity -= shares;
  if (Math.abs(outcome.quantity) < 1e-9) outcome.quantity = 0;
  refreshPrices(ctx, market, now);

  const exitPrice = shares > 0 ? proceeds / shares : 0;
  recordPositionEvent(ctx, position, { kind: "SELL", pnl: realized, won: null, exitPrice });
  position.shares = shares === position.shares ? 0 : position.shares - shares;
  position.realizedPnl = roundCents(position.realizedPnl + realized);
  position.updatedAt = now;
  if (position.shares === 0) {
    position.closedAt = now;
    position.notifiedGainLevel = 0;
    position.notifiedLossLevel = 0;
  }

  const trade: TradeRow = {
    id: tradeId,
    userId: user.id,
    marketId: market.id,
    outcomeId: input.outcomeId,
    side: "SELL",
    shares,
    price: exitPrice,
    credits: proceeds,
    realizedPnl: realized,
    priceBefore,
    priceAfter: outcome.currentPrice,
    createdAt: now,
  };
  ctx.state.trades.push(trade);
  if (!user.isBot) {
    notify(ctx, {
      userId: user.id,
      kind: "TRADE",
      title: `Sold ${shares.toFixed(2)} shares of ${outcome.label}.`,
      body: `You received W$${proceeds.toFixed(2)} (${realized >= 0 ? "+" : "−"}W$${Math.abs(realized).toFixed(2)}) on @${video.creatorHandle}.`,
      marketId: market.id,
    });
  }
  track(ctx, "position_sold", user.id, {
    market_id: market.id,
    video_id: video.id,
    platform: video.platform,
    outcome: outcome.label,
    price: priceBefore,
    trade_size: proceeds,
    user_balance: user.creditsBalance,
    momentum_score: market.momentumScore,
  });

  return {
    trade,
    receipt: receiptOf(ctx, trade, outcome.label, video.creatorHandle, user.creditsBalance),
    balance: user.creditsBalance,
    position: { shares: position.shares, averageEntryPrice: position.averageEntryPrice, realizedPnl: position.realizedPnl },
    prices: pricesRecord(ctx, market.id),
  };
}

function receiptOf(ctx: Ctx, t: TradeRow, outcomeLabel: string, creatorHandle: string, balanceAfter: number): TradeReceipt {
  return {
    tradeId: t.id,
    marketId: t.marketId,
    outcomeId: t.outcomeId,
    outcomeLabel,
    creatorHandle,
    side: t.side,
    shares: t.shares,
    averagePrice: t.price,
    credits: t.credits,
    realizedPnl: t.realizedPnl,
    priceBefore: t.priceBefore,
    priceAfter: t.priceAfter,
    balanceAfter,
    createdAt: t.createdAt,
  };
}

/** Users who share a device or hashed IP with this user (§27 related-account detection). */
export function relatedUsers(ctx: Ctx, userId: string): Set<string> {
  const mine = Object.values(ctx.state.devices ?? {}).filter((d) => d.userIds.includes(userId));
  const related = new Set<string>();
  const ips = new Set(mine.flatMap((d) => d.ipHashes));
  for (const d of mine) for (const u of d.userIds) if (u !== userId) related.add(u);
  if (ips.size) {
    for (const d of Object.values(ctx.state.devices ?? {})) {
      if (d.ipHashes.some((ip) => ips.has(ip))) for (const u of d.userIds) if (u !== userId) related.add(u);
    }
  }
  return related;
}

/**
 * Flag-only anti-manipulation checks (§27). They never block the trade and never punish on their
 * own: they put the user or market in the review queue for a human decision.
 */
function checkTradeRisk(ctx: Ctx, trade: TradeRow, balanceBefore: number) {
  const user = ctx.state.users[trade.userId];
  const now = trade.createdAt;
  if (trade.priceBefore < 0.05 && trade.credits >= balanceBefore * 0.15) {
    flagRisk(ctx, {
      entityType: "user",
      entityId: user.id,
      reason: "Large trade on a long-shot outcome",
      severity: 0.3,
      metadata: { tradeId: trade.id, marketId: trade.marketId, credits: trade.credits, price: trade.priceBefore },
    });
  }
  const recentMarket = ctx.state.trades.filter((t) => t.marketId === trade.marketId && t.createdAt >= now - 3_600_000 && t.side === "BUY");
  const mine = recentMarket.filter((t) => t.userId === user.id && t.createdAt >= now - 10 * 60_000);
  if (mine.length === 10) {
    flagRisk(ctx, { entityType: "user", entityId: user.id, reason: "Rapid repeated trading in one market", severity: 0.4, metadata: { marketId: trade.marketId, trades: mine.length } });
  }
  // Sudden repeated identical trades: the same amount on the same outcome, again and again.
  const identical = recentMarket.filter((t) => t.outcomeId === trade.outcomeId && t.credits === trade.credits && t.createdAt >= now - 10 * 60_000 && !ctx.state.users[t.userId]?.isBot);
  if (identical.filter((t) => t.userId === user.id).length === 3) {
    flagRisk(ctx, { entityType: "user", entityId: user.id, reason: "Repeated identical trades", severity: 0.4, metadata: { marketId: trade.marketId, credits: trade.credits } });
  }
  const identicalUsers = new Set(identical.map((t) => t.userId));
  if (identicalUsers.size === 4) {
    flagRisk(ctx, { entityType: "market", entityId: trade.marketId, reason: "Several accounts placed identical trades", severity: 0.6, metadata: { outcomeId: trade.outcomeId, credits: trade.credits, users: [...identicalUsers] } });
  }
  // Many brand-new accounts piling into one outcome.
  const newcomers = new Set(
    recentMarket
      .filter((t) => t.outcomeId === trade.outcomeId)
      .map((t) => ctx.state.users[t.userId])
      .filter((u) => u && !u.isBot && now - u.createdAt < 24 * 3_600_000)
      .map((u) => u!.id),
  );
  if (newcomers.size === 5) {
    flagRisk(ctx, { entityType: "market", entityId: trade.marketId, reason: "Many new accounts trading one outcome", severity: 0.6, metadata: { outcomeId: trade.outcomeId, users: [...newcomers] } });
  }
  // Accounts sharing a device or network trading the same outcome.
  const related = relatedUsers(ctx, user.id);
  if (related.size) {
    const partners = recentMarket.filter((t) => t.outcomeId === trade.outcomeId && related.has(t.userId)).map((t) => t.userId);
    if (partners.length) {
      flagRisk(ctx, {
        entityType: "user",
        entityId: user.id,
        reason: "Accounts sharing a device or network traded the same outcome",
        severity: 0.6,
        metadata: { marketId: trade.marketId, outcomeId: trade.outcomeId, related: [...new Set(partners)] },
      });
    }
  }
}
