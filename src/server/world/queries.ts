import { LEADERBOARD_MIN_MARKETS, LEADERBOARD_MIN_TRADES, MAX_FEED_MARKETS_PER_CREATOR } from "@/lib/shared/constants";
import type {
  AccountSettingsDTO,
  HistoryDTO,
  LeaderboardDTO,
  LeaderboardPeriod,
  LeaderboardRowDTO,
  MarketCardDTO,
  MarketDetailDTO,
  MeDTO,
  OutcomeDTO,
  PortfolioDTO,
  PositionDTO,
  ProfileDTO,
  ShareCardDTO,
  TradeDTO,
  VideoDTO,
  WalletDTO,
} from "@/lib/shared/dto";
import { compactNumber } from "@/lib/shared/format";
import { CANCEL_REASONS, RULES_VERSION, settlementDefinition } from "@/lib/shared/rules";
import type { LedgerType, MarketRow, OutcomeRow, PositionRow, UserRow, VideoRow } from "@/lib/shared/types";
import { platformDisplayName } from "@/lib/social-providers";
import { velocity } from "@/lib/virality-engine";
import { DEFAULT_NOTIFICATION_PREFS, type Ctx } from "./context";
import { Errors } from "./errors";
import { flagEnabled } from "./flags";
import { ledgerBalance } from "./ledger";
import { isFinal } from "./lifecycle";
import { getMarket, priceAt, usableSnapshots } from "./markets";
import { isOwnMarket, tradeLimits } from "./trading";
import { listSessions } from "./users";
import type { WorldState } from "./state";

const HOUR = 3_600_000;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function videoDTO(v: VideoRow): VideoDTO {
  return {
    id: v.id,
    platform: v.platform,
    platformName: platformDisplayName(v.platform),
    creatorHandle: v.creatorHandle,
    authorName: v.authorName ?? null,
    caption: v.takenDownAt ? "" : v.caption,
    canonicalUrl: v.canonicalUrl,
    thumbnailHue: v.thumbnailHue,
    thumbnailUrl: v.takenDownAt || v.thumbnailBroken ? null : (v.thumbnailUrl ?? null),
    publishedAt: v.publishedAt,
    simulated: v.provider === "mock" || (v.provider === "creator" && v.scenario !== null),
  };
}

function outcomeDTO(ctx: Ctx, market: MarketRow, o: OutcomeRow, now: number, sparkPoints = 0): OutcomeDTO {
  const t = Math.min(now, market.settlesAt);
  const hourAgo = priceAt(ctx, market.id, o.id, t - HOUR);
  const threeAgo = priceAt(ctx, market.id, o.id, t - 3 * HOUR);
  const sparkline: number[] = [];
  if (sparkPoints > 0) {
    const history = (ctx.state.priceHistory[market.id] ?? []).filter((h) => h.outcomeId === o.id && h.recordedAt >= t - 3 * HOUR);
    const step = Math.max(1, Math.floor(history.length / sparkPoints));
    for (let i = 0; i < history.length; i += step) sparkline.push(history[i].price);
    sparkline.push(o.currentPrice);
  }
  return {
    id: o.id,
    label: o.label,
    price: o.currentPrice,
    modelProbability: o.modelProbability,
    change1h: hourAgo === null ? null : o.currentPrice - hourAgo,
    change3h: threeAgo === null ? null : o.currentPrice - threeAgo,
    sparkline,
  };
}

// ---- Per-market trade stats, computed in one pass per request (§37 query optimization) ----

type Stats = { volume: number; volume1h: number; traders: Set<string>; trades: number };
const statsCache = new WeakMap<WorldState, { key: string; byMarket: Map<string, Stats> }>();

function marketStatsIndex(ctx: Ctx): Map<string, Stats> {
  const now = ctx.now();
  const key = `${ctx.state.trades.length}:${Math.floor(now / 60_000)}`;
  const cached = statsCache.get(ctx.state);
  if (cached && cached.key === key) return cached.byMarket;
  const byMarket = new Map<string, Stats>();
  for (const t of ctx.state.trades) {
    let s = byMarket.get(t.marketId);
    if (!s) byMarket.set(t.marketId, (s = { volume: 0, volume1h: 0, traders: new Set(), trades: 0 }));
    s.volume += t.credits;
    s.trades += 1;
    if (t.createdAt >= now - HOUR) s.volume1h += t.credits;
    s.traders.add(t.userId);
  }
  statsCache.set(ctx.state, { key, byMarket });
  return byMarket;
}

export function marketStats(ctx: Ctx, marketId: string) {
  const s = marketStatsIndex(ctx).get(marketId);
  return { volume: s?.volume ?? 0, volume1h: s?.volume1h ?? 0, traders: s?.traders.size ?? 0, trades: s?.trades ?? 0 };
}

export function marketCard(ctx: Ctx, market: MarketRow): MarketCardDTO {
  const now = ctx.now();
  const outcomes = ctx.state.outcomes[market.id];
  const video = ctx.state.videos[market.videoId];
  const stats = marketStats(ctx, market.id);
  const all = outcomes.map((o) => outcomeDTO(ctx, market, o, now));
  const top = [...all].sort((a, b) => b.price - a.price).slice(0, 2).sort((a, b) => outcomes.findIndex((o) => o.id === a.id) - outcomes.findIndex((o) => o.id === b.id));
  const snaps = usableSnapshots(ctx, video.id);
  const lastMetricAt = snaps.at(-1)?.capturedAt ?? market.lastPricedAt;

  // §4.4 feed_score: activity, momentum, recency, liquidity. Paused markets sink.
  const activity = clamp01(stats.volume1h / 3000);
  const recency = clamp01(1 - (now - market.openedAt) / (24 * HOUR));
  const liquidity = clamp01(stats.volume / 20000);
  const feedScore = (0.4 * activity + 0.35 * market.momentumScore + 0.15 * recency + 0.1 * liquidity) * (market.status === "PAUSED" ? 0.3 : 1) + (market.featured ? 1 : 0);

  return {
    id: market.id,
    status: market.status,
    video: videoDTO(video),
    currentLikes: market.currentLikes,
    likesPerMinute: snaps.length > 1 ? Math.max(0, Math.round(velocity(snaps, Math.min(now, lastMetricAt), 30))) : 0,
    momentum: { label: market.momentumLabel, score: market.momentumScore, change3h: market.change3h },
    openedAt: market.openedAt,
    locksAt: market.locksAt,
    settlesAt: market.settlesAt,
    topOutcomes: top,
    biggestMove1h: Math.max(0, ...all.map((o) => Math.abs(o.change1h ?? 0))),
    volume: stats.volume,
    traders: stats.traders,
    feedScore,
    pausedReason: market.status === "PAUSED" ? market.pausedReason : null,
    featured: Boolean(market.featured),
    lastMetricAt,
  };
}

// ---- Feed & search (§6, §32) ----

export type FeedSort = "trending" | "new" | "closing" | "movers" | "volume";

/**
 * Search relevance (§32): exact market id or video URL/id first, then exact handle, handle prefix,
 * handle contains, caption words. Returns 0 for no match.
 */
function searchScore(ctx: Ctx, market: MarketRow, q: string): number {
  const needle = q.trim().toLowerCase();
  if (!needle) return 1;
  const video = ctx.state.videos[market.videoId];
  if (needle.includes(market.id.toLowerCase())) return 100;
  if (needle.includes(video.platformVideoId)) return 90;
  const handle = video.creatorHandle.toLowerCase();
  const h = needle.replace(/^@/, "");
  if (handle === h) return 80;
  if (handle.startsWith(h)) return 60;
  if (handle.includes(h)) return 40;
  const words = needle.split(/\s+/).filter((w) => w.length > 2);
  const caption = video.caption.toLowerCase();
  if (words.length && words.every((w) => caption.includes(w))) return 20;
  return 0;
}

/** Keeps any one creator from filling the top of the feed (§23 market diversity). */
function diversify(cards: MarketCardDTO[], perCreator = MAX_FEED_MARKETS_PER_CREATOR, window = 20): MarketCardDTO[] {
  const head: MarketCardDTO[] = [];
  const deferred: MarketCardDTO[] = [];
  const counts = new Map<string, number>();
  for (const c of cards) {
    const k = c.video.creatorHandle.toLowerCase();
    const n = counts.get(k) ?? 0;
    if (head.length < window && n >= perCreator) deferred.push(c);
    else {
      head.push(c);
      counts.set(k, n + 1);
    }
  }
  return [...head, ...deferred];
}

export function feed(ctx: Ctx, opts: { q?: string; sort?: FeedSort; limit?: number; offset?: number } = {}) {
  const q = (opts.q ?? "").slice(0, 200);
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const scored = Object.values(ctx.state.markets)
    .filter((m) => !m.hidden && m.status !== "DRAFT")
    .map((m) => ({ m, s: searchScore(ctx, m, q) }))
    .filter((x) => x.s > 0);
  const live = scored.filter((x) => x.m.status === "OPEN" || x.m.status === "PAUSED");
  let open = live.map((x) => ({ card: marketCard(ctx, x.m), s: x.s }));
  const sort = opts.sort ?? "trending";
  open.sort((a, b) => {
    if (q && a.s !== b.s) return b.s - a.s;
    switch (sort) {
      case "new":
        return b.card.openedAt - a.card.openedAt;
      case "closing":
        return a.card.settlesAt - b.card.settlesAt;
      case "movers":
        return b.card.biggestMove1h - a.card.biggestMove1h;
      case "volume":
        return b.card.volume - a.card.volume;
      default:
        return b.card.feedScore - a.card.feedScore;
    }
  });
  let cards = open.map((x) => x.card);
  if (sort === "trending" && !q) cards = diversify(cards);
  open = [];
  const recent = scored
    .filter((x) => x.m.status !== "OPEN" && x.m.status !== "PAUSED")
    .sort((a, b) => b.m.settlesAt - a.m.settlesAt)
    .slice(0, 12)
    .map((x) => marketCard(ctx, x.m));
  return { open: cards.slice(offset, offset + limit), recent, total: cards.length, nextOffset: offset + limit < cards.length ? offset + limit : null };
}

export function marketDetail(ctx: Ctx, marketId: string, user: UserRow | null, opts: { isAdmin?: boolean } = {}): MarketDetailDTO {
  const { market, outcomes, video } = getMarket(ctx, marketId);
  if (market.hidden && !opts.isAdmin) throw Errors.notFound();
  if (market.status === "DRAFT" && !opts.isAdmin && market.createdByUserId !== user?.id) throw Errors.notFound();
  const now = ctx.now();
  const card = marketCard(ctx, market);
  const positions = user
    ? Object.values(ctx.state.positions)
        .filter((p) => p.userId === user.id && p.marketId === marketId && (p.shares > 1e-9 || p.settlement))
        .map((p) => positionDTO(ctx, p))
    : [];
  const snaps = usableSnapshots(ctx, video.id);
  const step = Math.max(1, Math.floor(snaps.length / 120));
  const likesHistory = snaps.filter((_, i) => i % step === 0 || i === snaps.length - 1).map((s) => ({ t: s.capturedAt, likes: s.likes }));
  const recentTrades = ctx.state.trades
    .filter((t) => t.marketId === marketId)
    .slice(-8)
    .reverse()
    .map((t) => {
      const u = ctx.state.users[t.userId];
      return {
        side: t.side,
        outcomeLabel: outcomes.find((o) => o.id === t.outcomeId)!.label,
        credits: t.credits,
        username: u.status === "deleted" || u.showOnLeaderboard === false ? "a trader" : u.username,
        isBot: u.isBot,
        createdAt: t.createdAt,
      };
    });
  const basis = market.rangeBasis;
  const rangeExplanation = basis
    ? `Ranges are centered on ${compactNumber(basis.center)} likes${
        basis.avgLikes || basis.followers
          ? `, from this creator's usual ${basis.avgLikes ? `${compactNumber(basis.avgLikes)} likes per video` : ""}${basis.avgLikes && basis.followers ? " and " : ""}${basis.followers ? `${compactNumber(basis.followers)} followers` : ""}`
          : ""
      }.`
    : null;
  const source =
    video.provider === "manual"
      ? "Entered by Wesify staff from the public like count"
      : video.provider === "creator"
        ? `${platformDisplayName(video.platform)} API via the creator's connected account${card.video.simulated ? " (simulated)" : ""}`
        : `${platformDisplayName(video.platform)} like count (simulated during testing)`;
  const code = market.cancellation?.reason;

  return {
    ...card,
    question: market.question,
    liquidity: market.liquidityParameter,
    outcomes: outcomes.map((o) => outcomeDTO(ctx, market, o, now, 24)),
    finalMetric: market.finalMetric,
    winningOutcomeId: market.winningOutcomeId,
    tradingPaused: market.status === "PAUSED" || flagEnabled(ctx, "globalPause"),
    positions,
    limits: user ? tradeLimits(ctx, user.id, marketId) : null,
    isOwnMarket: user ? isOwnMarket(ctx, user.id, marketId) : false,
    balance: user ? user.creditsBalance : null,
    likesHistory,
    recentTrades,
    settlementDefinition: settlementDefinition(platformDisplayName(video.platform)),
    dataSource: source,
    rulesVersion: market.rulesVersion ?? RULES_VERSION,
    rangeExplanation,
    settlementStage: market.status === "SETTLING" ? (market.proposedSettlement ? "awaiting_review" : "awaiting_metric") : null,
    cancellation: market.cancellation && code ? { reason: code, label: CANCEL_REASONS[code].label, explanation: market.cancellation.explanation, at: market.cancellation.at } : null,
    review: market.review && market.status === "DRAFT" ? { submittedAt: market.review.submittedAt, decidedAt: market.review.decidedAt, note: market.review.note } : null,
    tradingEnabled: flagEnabled(ctx, "trading") && !flagEnabled(ctx, "globalPause"),
    sellingEnabled: flagEnabled(ctx, "selling") && !flagEnabled(ctx, "globalPause"),
  };
}

export function priceHistory(ctx: Ctx, marketId: string, range: "1H" | "3H" | "6H" | "ALL"): HistoryDTO {
  const { market, outcomes } = getMarket(ctx, marketId);
  const now = Math.min(ctx.now(), market.settlesAt + HOUR);
  const from = range === "ALL" ? 0 : now - { "1H": 1, "3H": 3, "6H": 6 }[range] * HOUR;
  const idx = new Map(outcomes.map((o, i) => [o.id, i]));
  const all = ctx.state.priceHistory[marketId] ?? [];
  // Start each line at its price when the window opens; for ALL that is the first recorded price.
  const current = outcomes.map((o) => priceAt(ctx, marketId, o.id, from) ?? all.find((h) => h.outcomeId === o.id)?.price ?? o.currentPrice);
  const byTime = new Map<number, number[]>();
  const start = Math.max(from, all[0]?.recordedAt ?? market.openedAt);
  const points: { t: number; prices: number[] }[] = [{ t: start, prices: [...current] }];
  for (const h of all) {
    if (h.recordedAt <= start) continue;
    const i = idx.get(h.outcomeId);
    if (i === undefined) continue;
    current[i] = h.price;
    byTime.set(h.recordedAt, [...current]);
  }
  for (const [t, prices] of [...byTime.entries()].sort((a, b) => a[0] - b[0])) points.push({ t, prices });
  const maxPoints = 200;
  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  return { outcomes: outcomes.map((o) => ({ id: o.id, label: o.label })), points: sampled };
}

export function positionDTO(ctx: Ctx, p: PositionRow): PositionDTO {
  const { market, outcomes, video } = getMarket(ctx, p.marketId);
  const outcome = outcomes.find((o) => o.id === p.outcomeId)!;
  const costBasis = p.shares * p.averageEntryPrice;
  const value = p.shares * outcome.currentPrice;
  const status: PositionDTO["status"] =
    p.shares > 1e-9 ? "OPEN" : p.settlement?.kind === "CANCELLED" ? "CANCELLED" : p.settlement ? "SETTLED" : "CLOSED";
  return {
    id: p.id,
    marketId: p.marketId,
    outcomeId: p.outcomeId,
    outcomeLabel: outcome.label,
    shares: p.shares,
    averageEntryPrice: p.averageEntryPrice,
    currentPrice: outcome.currentPrice,
    value,
    costBasis,
    unrealizedPnl: value - costBasis,
    realizedPnl: p.realizedPnl,
    status,
    settlement: p.settlement,
    closedAt: p.closedAt,
    market: {
      id: market.id,
      status: market.status,
      creatorHandle: video.creatorHandle,
      caption: video.caption,
      thumbnailHue: video.thumbnailHue,
      thumbnailUrl: videoDTO(video).thumbnailUrl,
      videoId: video.id,
      settlesAt: market.settlesAt,
      locksAt: market.locksAt,
      winningLabel: outcomes.find((o) => o.id === market.winningOutcomeId)?.label ?? null,
      finalMetric: market.finalMetric,
    },
  };
}

function userEvents(ctx: Ctx, userId: string) {
  return ctx.state.positionEvents.filter((e) => e.userId === userId && e.kind !== "REFUND");
}

/** Accuracy: share of settled positions that were on the winning range. */
function accuracy(ctx: Ctx, userId: string): number | null {
  const settled = userEvents(ctx, userId).filter((e) => e.kind === "SETTLE");
  return settled.length ? settled.filter((e) => e.won).length / settled.length : null;
}

export function portfolio(ctx: Ctx, user: UserRow): PortfolioDTO {
  const rows = Object.values(ctx.state.positions).filter((p) => p.userId === user.id);
  const all = rows.map((p) => positionDTO(ctx, p));
  const open = all.filter((p) => p.status === "OPEN").sort((a, b) => a.market.settlesAt - b.market.settlesAt);
  const settled = all.filter((p) => p.status === "SETTLED" || p.status === "CANCELLED").sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  const closed = all.filter((p) => p.status === "CLOSED").sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  const trades: TradeDTO[] = ctx.state.trades
    .filter((t) => t.userId === user.id)
    .slice(-100)
    .reverse()
    .map((t) => {
      const { outcomes, video } = getMarket(ctx, t.marketId);
      return {
        id: t.id,
        marketId: t.marketId,
        creatorHandle: video.creatorHandle,
        outcomeLabel: outcomes.find((o) => o.id === t.outcomeId)!.label,
        side: t.side,
        shares: t.shares,
        price: t.price,
        credits: t.credits,
        realizedPnl: t.realizedPnl,
        createdAt: t.createdAt,
      };
    });
  const openValue = open.reduce((s, p) => s + p.value, 0);
  return {
    balance: user.creditsBalance,
    openValue,
    unrealizedPnl: open.reduce((s, p) => s + p.unrealizedPnl, 0),
    realizedPnl: userEvents(ctx, user.id).reduce((s, e) => s + e.pnl, 0),
    accuracy: accuracy(ctx, user.id),
    open,
    settled,
    closed,
    trades,
  };
}

export function connectedAccountsOf(ctx: Ctx, userId: string): ProfileDTO["connectedAccounts"] {
  return ctx.state.socialAccounts
    .filter((a) => a.userId === userId && a.status !== "revoked" && a.mode)
    .map((a) => ({ id: a.id, platform: a.platform, handle: a.handle, mode: a.mode!, status: a.status === "error" ? ("error" as const) : ("active" as const) }));
}

export function profile(ctx: Ctx, user: UserRow): ProfileDTO {
  const events = userEvents(ctx, user.id).sort((a, b) => a.createdAt - b.createdAt);
  let streak = 0;
  for (let i = events.length - 1; i >= 0 && events[i].pnl > 0; i--) streak++;
  const best = events.reduce<(typeof events)[number] | null>((b, e) => (e.pnl > 0 && (!b || e.pnl > b.pnl) ? e : b), null);
  const userTrades = ctx.state.trades.filter((t) => t.userId === user.id);
  let bestTrade: ProfileDTO["bestTrade"] = null;
  if (best) {
    const { outcomes, video } = getMarket(ctx, best.marketId);
    bestTrade = { pnl: best.pnl, outcomeLabel: outcomes.find((o) => o.id === best.outcomeId)!.label, creatorHandle: video.creatorHandle, marketId: best.marketId };
  }
  const board = leaderboard(ctx, "all", user);
  return {
    username: user.username,
    avatarHue: user.avatarHue,
    joinedAt: user.createdAt,
    balance: user.creditsBalance,
    marketsTraded: new Set(userTrades.map((t) => t.marketId)).size,
    totalTrades: userTrades.length,
    winRate: events.length ? events.filter((e) => e.pnl > 0).length / events.length : null,
    accuracy: accuracy(ctx, user.id),
    realizedPnl: events.reduce((s, e) => s + e.pnl, 0),
    bestTrade,
    streak,
    referralCode: user.referralCode,
    rank: board.me?.eligible ? board.me.rank : null,
    connectedAccounts: connectedAccountsOf(ctx, user.id),
  };
}

// ---- Wallet (§10) ----

export function wallet(ctx: Ctx, user: UserRow, opts: { cursor?: number; limit?: number } = {}): WalletDTO {
  const rows = ctx.state.ledger.filter((l) => l.userId === user.id);
  const totals: Partial<Record<LedgerType, number>> = {};
  for (const r of rows) totals[r.type] = Math.round(((totals[r.type] ?? 0) + r.amount) * 100) / 100;
  const limit = Math.min(opts.limit ?? 50, 200);
  const end = opts.cursor ?? rows.length;
  const page = rows.slice(Math.max(0, end - limit), end).reverse();
  const tradeMarket = new Map<string, string>();
  for (const t of ctx.state.trades) if (t.userId === user.id) tradeMarket.set(t.id, t.marketId);
  const ledger = ledgerBalance(ctx, user.id);
  return {
    balance: user.creditsBalance,
    ledgerBalance: ledger,
    reconciled: Math.abs(ledger - user.creditsBalance) < 0.005,
    totals,
    entries: page.map((r) => ({
      id: r.id,
      type: r.type,
      amount: r.amount,
      balanceAfter: r.balanceAfter,
      description: r.description ?? r.type,
      createdAt: r.createdAt,
      marketId: r.referenceType === "market" ? r.referenceId : r.referenceType === "trade" && r.referenceId ? (tradeMarket.get(r.referenceId) ?? null) : null,
    })),
    nextCursor: end - limit > 0 ? end - limit : null,
  };
}

// ---- Leaderboard (§13) ----

export const LEADERBOARD_METHODOLOGY = [
  "Ranked by realized W$ profit from sells and settlements in the period, adjusted for accuracy: profit × (0.5 + share of profitable exits).",
  `To be ranked you need at least ${LEADERBOARD_MIN_TRADES} trades in at least ${LEADERBOARD_MIN_MARKETS} different markets in the period, so one lucky trade can't top the board.`,
  "Ties are broken by accuracy, then number of trades, then who joined first.",
  "Accounts under review, suspended accounts and people who hid themselves in settings are left out. Simulated traders are labelled SIM.",
  "Recomputed every minute.",
];

type BoardRow = LeaderboardRowDTO & { userId: string; eligible: boolean; tradesNeeded: number; marketsNeeded: number; joined: number; hidden: boolean };
type BoardEntry = { at: number; rows: BoardRow[] };
const boardCache = new WeakMap<WorldState, Map<string, BoardEntry>>();

export function leaderboard(ctx: Ctx, period: LeaderboardPeriod, me: UserRow | null): LeaderboardDTO {
  const now = ctx.now();
  const cache: Map<string, BoardEntry> = boardCache.get(ctx.state) ?? new Map();
  boardCache.set(ctx.state, cache);
  let entry = cache.get(period);
  if (!entry || now - entry.at > 60_000 || now < entry.at) {
    const since = period === "today" ? now - 24 * HOUR : period === "7d" ? now - 7 * 24 * HOUR : 0;
    const stats = new Map<string, { profit: number; wins: number; events: number; trades: number; markets: Set<string> }>();
    const get = (id: string) => stats.get(id) ?? stats.set(id, { profit: 0, wins: 0, events: 0, trades: 0, markets: new Set() }).get(id)!;
    for (const e of ctx.state.positionEvents) {
      if (e.createdAt < since || e.kind === "REFUND") continue;
      const s = get(e.userId);
      s.profit += e.pnl;
      s.events += 1;
      if (e.pnl > 0) s.wins += 1;
    }
    for (const t of ctx.state.trades) {
      if (t.createdAt < since) continue;
      const s = get(t.userId);
      s.trades += 1;
      s.markets.add(t.marketId);
    }
    const rows = [...stats.entries()]
      .map(([userId, s]) => {
        const u = ctx.state.users[userId];
        const acc = s.events ? s.wins / s.events : 0;
        const multiplier = 0.5 + acc;
        const eligible = s.trades >= LEADERBOARD_MIN_TRADES && s.markets.size >= LEADERBOARD_MIN_MARKETS && s.events > 0;
        const badges: string[] = [];
        if (acc >= 0.7 && s.events >= 5) badges.push("Sharp");
        if (s.markets.size >= 10) badges.push("Explorer");
        return {
          userId,
          rank: 0,
          username: u.username,
          isBot: u.isBot,
          score: s.profit >= 0 ? s.profit * multiplier : s.profit / multiplier,
          realizedProfit: s.profit,
          accuracy: acc,
          trades: s.trades,
          markets: s.markets.size,
          isMe: false,
          badges,
          eligible,
          tradesNeeded: Math.max(0, LEADERBOARD_MIN_TRADES - s.trades),
          marketsNeeded: Math.max(0, LEADERBOARD_MIN_MARKETS - s.markets.size),
          joined: u.createdAt,
          hidden: u.status !== "active" || u.showOnLeaderboard === false || (u.riskScore ?? 0) >= 0.8,
        };
      })
      .sort((a, b) => b.score - a.score || b.accuracy - a.accuracy || b.trades - a.trades || a.joined - b.joined);
    let rank = 0;
    for (const r of rows) if (r.eligible && !r.hidden) r.rank = ++rank;
    entry = { at: now, rows };
    cache.set(period, entry);
  }
  const ranked = entry.rows.filter((r) => r.rank > 0);
  const strip = ({ userId: _u, eligible: _e, tradesNeeded: _t, marketsNeeded: _m, joined: _j, hidden: _h, ...r }: (typeof entry.rows)[number]) => r;
  const mine = me ? entry.rows.find((r) => r.userId === me.id) : undefined;
  return {
    period,
    rows: ranked.slice(0, 50).map((r) => ({ ...strip(r), isMe: r.userId === me?.id })),
    me: mine ? { ...strip(mine), isMe: true, eligible: mine.rank > 0, tradesNeeded: mine.tradesNeeded, marketsNeeded: mine.marketsNeeded } : null,
    methodology: LEADERBOARD_METHODOLOGY,
    computedAt: entry.at,
  };
}

export function meDTO(ctx: Ctx, user: UserRow, authProvider: MeDTO["authProvider"] = "local"): MeDTO {
  return {
    id: user.id,
    username: user.username,
    balance: user.creditsBalance,
    avatarHue: user.avatarHue,
    createdAt: user.createdAt,
    referralCode: user.referralCode,
    unreadNotifications: ctx.state.notifications.filter((n) => n.userId === user.id && !n.read).length,
    email: user.email ?? null,
    emailVerified: Boolean(user.emailVerifiedAt),
    role: user.role ?? "user",
    status: user.status ?? "active",
    onboardingCompleted: Boolean(user.onboardingCompletedAt),
    tutorialCompleted: Boolean(user.tutorialCompletedAt),
    hasPassword: Boolean(user.passwordHash),
    authProvider,
    consent: user.consent ? { analytics: user.consent.analytics, marketing: user.consent.marketing } : null,
    needsAccountUpgrade: authProvider === "local" && (!user.email || !user.termsAcceptedAt),
  };
}

export function accountSettings(ctx: Ctx, user: UserRow, currentSessionHash: string | undefined, authProvider: MeDTO["authProvider"]): AccountSettingsDTO {
  return {
    username: user.username,
    email: user.email ?? null,
    emailVerified: Boolean(user.emailVerifiedAt),
    hasPassword: Boolean(user.passwordHash),
    authProvider,
    notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS, ...(user.notificationPrefs ?? {}) },
    showOnLeaderboard: user.showOnLeaderboard !== false,
    consent: user.consent ? { analytics: user.consent.analytics, marketing: user.consent.marketing } : null,
    termsAcceptedAt: user.termsAcceptedAt ?? null,
    termsVersion: user.termsVersion ?? null,
    ageConfirmedAt: user.ageConfirmedAt ?? null,
    sessions: listSessions(ctx, user.id, currentSessionHash),
    connectedAccounts: connectedAccountsOf(ctx, user.id),
  };
}

export function shareCard(ctx: Ctx, positionId: string): ShareCardDTO {
  const p = Object.values(ctx.state.positions).find((x) => x.id === positionId);
  if (!p) throw Errors.notFound("Position");
  const dto = positionDTO(ctx, p);
  const owner = ctx.state.users[p.userId];
  if (ctx.state.markets[p.marketId]?.hidden || owner.status === "deleted") throw Errors.notFound("Position");
  const events = ctx.state.positionEvents.filter((e) => e.userId === p.userId && e.outcomeId === p.outcomeId);
  const lastExit = events.at(-1);
  const latestPrice = dto.status === "OPEN" ? dto.currentPrice : (lastExit?.exitPrice ?? dto.currentPrice);
  return {
    username: owner.showOnLeaderboard === false ? "a Wesify trader" : owner.username,
    creatorHandle: dto.market.creatorHandle,
    outcomeLabel: dto.outcomeLabel,
    entryPrice: p.averageEntryPrice,
    latestPrice,
    status: dto.status,
    won: p.settlement && p.settlement.kind === "SETTLED" ? p.settlement.won : null,
    marketId: p.marketId,
  };
}

export { isFinal };
