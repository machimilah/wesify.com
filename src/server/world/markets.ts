import * as lmsr from "@/lib/market-engine/lmsr";
import { coldStartPrior, generateRanges } from "@/lib/market-engine/ranges";
import {
  DEFAULT_LIQUIDITY_B,
  LOCK_BEFORE_SETTLEMENT_MS,
  MARKET_DURATION_MS,
  MARKET_QUESTION,
  MAX_ACTIVE_MARKETS,
  MAX_REPRICE_MOVE,
  MAX_REPRICE_MOVE_SPIKE,
  MAX_VIDEO_AGE_AT_CREATION_MS,
  MIN_BASELINE_LIKES,
  MIN_LIKES_AT_CREATION,
  MIN_SNAPSHOTS_AT_CREATION,
  MIN_VIDEO_AGE_AT_CREATION_MS,
  type RangeDef,
} from "@/lib/shared/constants";
import { compactNumber, credits as fmtCredits } from "@/lib/shared/format";
import { newId } from "@/lib/shared/random";
import { CANCEL_REASONS, RULES_VERSION } from "@/lib/shared/rules";
import type { CancelReason, MarketRow, MetricSnapshot, OutcomeRow, PositionRow, SnapshotRow, VideoRow } from "@/lib/shared/types";
import {
  MODEL_VERSION,
  computeFeatures,
  enforceReachable,
  forecast,
  isSpike,
  isValidDistribution,
  momentumLabel,
  normalize,
  robustHistory,
  smoothMomentum,
  smoothProbabilities,
  winningRangeIndex,
} from "@/lib/virality-engine";
import { audit, flagRisk, notify, raiseAlert, track, type Ctx } from "./context";
import { Errors, WesifyError } from "./errors";
import { floorCents, postLedger, roundCents } from "./ledger";
import { isFinal, isLive, transition } from "./lifecycle";
import { positionKey, type PositionEvent } from "./state";

const HOUR = 3_600_000;
export const SETTLEMENT_BLOCKED = "Settlement integrity check failed";
export const METRICS_DELAYED = "Metrics are temporarily delayed.";
export const UNDER_REVIEW = "Unusual like activity is under review.";
export const SETTLEMENT_ENGINE_VERSION = "settle-v2";
/** A final metric captured more than this long after settlement time is flagged for review. */
const FINAL_METRIC_MAX_DELAY_MS = 30 * 60_000;

export const rangesOf = (outcomes: OutcomeRow[]): RangeDef[] =>
  outcomes.map((o) => ({ label: o.label, min: o.minValue, max: o.maxValue }));

export function lmsrStateOf(market: MarketRow, outcomes: OutcomeRow[]): lmsr.LmsrState {
  return {
    b: market.liquidityParameter,
    quantities: outcomes.map((o) => o.quantity),
    modelProbabilities: outcomes.map((o) => o.modelProbability),
  };
}

export function getMarket(ctx: Ctx, marketId: string) {
  const market = ctx.state.markets[marketId];
  if (!market) throw Errors.notFound();
  const outcomes = ctx.state.outcomes[marketId];
  const video = ctx.state.videos[market.videoId];
  return { market, outcomes, video };
}

export function openPositions(ctx: Ctx, marketId: string): PositionRow[] {
  return Object.values(ctx.state.positions).filter(
    (p) => p.marketId === marketId && p.shares > 1e-9,
  );
}

/** Snapshots that may drive pricing: suspicious readings are kept for review but never priced. */
export function usableSnapshots(ctx: Ctx, videoId: string): SnapshotRow[] {
  return (ctx.state.snapshots[videoId] ?? []).filter((s) => !s.suspicious);
}

/** Writes LMSR prices onto outcome rows and appends a price-history point. */
export function refreshPrices(ctx: Ctx, market: MarketRow, at: number) {
  const outcomes = ctx.state.outcomes[market.id];
  const ps = lmsr.prices(lmsrStateOf(market, outcomes));
  const history = (ctx.state.priceHistory[market.id] ??= []);
  outcomes.forEach((o, i) => {
    o.currentPrice = ps[i];
    history.push({
      marketId: market.id,
      outcomeId: o.id,
      price: Math.round(ps[i] * 1e5) / 1e5,
      modelProbability: Math.round(o.modelProbability * 1e5) / 1e5,
      recordedAt: Math.round(at),
    });
  });
}

/** Latest recorded price for an outcome at or before `t`. */
export function priceAt(ctx: Ctx, marketId: string, outcomeId: string, t: number): number | null {
  const history = ctx.state.priceHistory[marketId] ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.outcomeId === outcomeId && h.recordedAt <= t) return h.price;
  }
  return null;
}

export function activeMarketCount(ctx: Ctx) {
  return Object.values(ctx.state.markets).filter((m) => m.status === "OPEN" || m.status === "PAUSED").length;
}

// ---------------------------------------------------------------------------
// Eligibility (§22)
// ---------------------------------------------------------------------------

export type EligibilityInput = {
  publishedAt: number;
  openedAt: number;
  history: MetricSnapshot[];
  followers: number | null;
  avgLikes: number | null;
};

/**
 * Plain-English reasons a video can't get a market right now; empty when eligible. Covers minimum
 * and maximum video age, minimum engagement, minimum data quality, expected trader interest (a
 * creator big enough to draw traders) and a manipulation-risk check on the trajectory so far.
 */
export function eligibilityIssues(input: EligibilityInput): string[] {
  const issues: string[] = [];
  const age = input.openedAt - input.publishedAt;
  if (age < MIN_VIDEO_AGE_AT_CREATION_MS) issues.push("This video was just posted. Markets open once it's at least 5 minutes old.");
  if (age >= MAX_VIDEO_AGE_AT_CREATION_MS) issues.push("This video is too old. Markets open within 6 hours of posting.");
  const history = [...input.history].sort((a, b) => a.capturedAt - b.capturedAt);
  const likes = history.at(-1)?.likes ?? 0;
  if (history.length < MIN_SNAPSHOTS_AT_CREATION) issues.push("We don't have enough like data for this video yet.");
  if (likes < MIN_LIKES_AT_CREATION) issues.push(`This video needs at least ${MIN_LIKES_AT_CREATION} likes before a market can open.`);
  const baseline = input.avgLikes ?? (input.followers ? input.followers * 0.05 : null);
  if (baseline !== null && baseline < MIN_BASELINE_LIKES && likes < MIN_BASELINE_LIKES) {
    issues.push("This creator's videos usually get too few likes for a market to be interesting.");
  }
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1];
    const b = history[i];
    const minutes = Math.max(1, (b.capturedAt - a.capturedAt) / 60_000);
    if (b.likes < a.likes * 0.8 && a.likes > 200) {
      issues.push("This video's like count is inconsistent right now.");
      break;
    }
    if ((b.likes - a.likes) / minutes > 50_000) {
      issues.push("This video's likes jumped in a way we can't verify yet.");
      break;
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Creation (§9.1, §22, §54, §56)
// ---------------------------------------------------------------------------

export type CreateMarketInput = {
  video: Omit<VideoRow, "id" | "createdAt">;
  openedAt: number;
  initialHistory: MetricSnapshot[];
  liquidity?: number;
  actor: string | null;
  durationMs?: number;
  source?: MarketRow["source"];
  /** Creator baseline for the range formula (§1). */
  baseline?: { followers: number | null; avgLikes: number | null };
  /** DRAFT = a submission waiting for admin approval; OPEN = start trading now. */
  status?: "OPEN" | "DRAFT";
  /** System seeding and admin overrides skip the eligibility rules and the supply cap. */
  skipEligibility?: boolean;
};

function buildOutcomes(marketId: string, ranges: RangeDef[], at: number): OutcomeRow[] {
  return ranges.map((r, i) => ({
    id: newId("out"),
    marketId,
    label: r.label,
    minValue: r.min,
    maxValue: r.max,
    sortOrder: i,
    quantity: 0,
    modelProbability: 1 / ranges.length,
    currentPrice: 1 / ranges.length,
    createdAt: at,
  }));
}

export function createMarket(ctx: Ctx, input: CreateMarketInput) {
  const { state } = ctx;
  const key = `${input.video.platform}:${input.video.platformVideoId}`;
  const existingVideoId = state.videoKeys[key];
  if (existingVideoId) {
    // One market per video and ruleset (§14): return the existing one instead of a duplicate.
    const existing = Object.values(state.markets).find((m) => m.videoId === existingVideoId);
    if (existing) return { market: existing, created: false };
  }
  if (input.openedAt < input.video.publishedAt) throw Errors.invalid("Invalid video timestamp.");
  if (input.initialHistory.length === 0) throw Errors.videoUnavailable();
  const followers = input.baseline?.followers ?? input.video.creatorFollowers ?? null;
  const avgLikes = input.baseline?.avgLikes ?? input.video.creatorAvgLikes ?? null;
  const status = input.status ?? "OPEN";
  if (!input.skipEligibility) {
    if (input.openedAt - input.video.publishedAt >= MAX_VIDEO_AGE_AT_CREATION_MS) throw Errors.videoTooOld();
    const issues = eligibilityIssues({ publishedAt: input.video.publishedAt, openedAt: input.openedAt, history: input.initialHistory, followers, avgLikes });
    if (issues.length) throw Errors.notEligible(issues[0]);
    if (status === "OPEN" && activeMarketCount(ctx) >= MAX_ACTIVE_MARKETS) throw Errors.marketCapacity();
  }

  const videoId = newId("vid");
  const video: VideoRow = { ...input.video, id: videoId, createdAt: input.openedAt, creatorFollowers: followers, creatorAvgLikes: avgLikes };
  const history = [...input.initialHistory].sort((a, b) => a.capturedAt - b.capturedAt);
  const currentLikes = history[history.length - 1].likes;
  const duration = input.durationMs ?? MARKET_DURATION_MS;
  const { ranges, basis } = generateRanges({ followers, avgLikes, currentLikes });

  const marketId = newId("mkt");
  const market: MarketRow = {
    id: marketId,
    videoId,
    question: MARKET_QUESTION,
    status: "DRAFT",
    openedAt: input.openedAt,
    locksAt: input.openedAt + duration - LOCK_BEFORE_SETTLEMENT_MS,
    settlesAt: input.openedAt + duration,
    finalMetric: null,
    winningOutcomeId: null,
    liquidityParameter: input.liquidity ?? DEFAULT_LIQUIDITY_B,
    pausedReason: null,
    momentumScore: 0,
    momentumLabel: "STABLE",
    currentLikes,
    change3h: 0,
    riskScore: 0,
    createdAt: input.openedAt,
    lastPricedAt: history[history.length - 1].capturedAt,
    createdByUserId: input.actor && state.users[input.actor] ? input.actor : null,
    source: input.source ?? (input.actor && state.users[input.actor] ? "paste" : "system"),
    rulesVersion: RULES_VERSION,
    rangeBasis: basis,
    review: status === "DRAFT" ? { submittedAt: input.openedAt, decidedAt: null, decidedBy: null, note: null } : null,
    proposedSettlement: null,
    settlementAttempts: 0,
    cancellation: null,
    unavailableSince: null,
    unavailableReason: null,
    featured: false,
    hidden: false,
  };

  // All DRAFT requirements satisfied → commit and price.
  state.videos[videoId] = video;
  state.videoKeys[key] = videoId;
  state.snapshots[videoId] = history.map((h) => ({ ...h, id: newId("snp"), videoId, source: input.video.provider }));
  state.markets[marketId] = market;
  state.outcomes[marketId] = buildOutcomes(marketId, ranges, input.openedAt);
  state.priceHistory[marketId] = [];

  reprice(ctx, market, market.lastPricedAt, { initial: true });
  audit(ctx, {
    actor: input.actor,
    action: "market.create",
    entityType: "market",
    entityId: marketId,
    metadata: { videoId, platformVideoId: video.platformVideoId, scenario: video.scenario, status, ranges: ranges.map((r) => r.label), basis },
  });
  if (status === "OPEN") {
    transition(ctx, market, "OPEN", { actor: input.actor, reason: "created" });
    notifyInterestedUsers(ctx, market);
  }
  return { market, created: true };
}

/**
 * Opens a DRAFT submission (§22 admin review). The 24-hour window starts at approval, ranges are
 * recomputed from the likes at that moment, and the submitter is notified.
 */
export function approveDraft(ctx: Ctx, marketId: string, opts: { actor: string; note?: string | null; history: MetricSnapshot[]; force?: boolean }) {
  const { market, video } = getMarket(ctx, marketId);
  if (market.status !== "DRAFT") throw Errors.invalid("Only markets waiting for review can be approved.");
  const now = ctx.now();
  const history = [...opts.history].sort((a, b) => a.capturedAt - b.capturedAt);
  if (!opts.force) {
    const issues = eligibilityIssues({ publishedAt: video.publishedAt, openedAt: now, history, followers: video.creatorFollowers ?? null, avgLikes: video.creatorAvgLikes ?? null });
    if (issues.length) throw Errors.notEligible(issues[0]);
    if (activeMarketCount(ctx) >= MAX_ACTIVE_MARKETS) throw Errors.marketCapacity();
  }
  const currentLikes = history.at(-1)?.likes ?? market.currentLikes;
  const { ranges, basis } = generateRanges({ followers: video.creatorFollowers ?? null, avgLikes: video.creatorAvgLikes ?? null, currentLikes });
  const duration = market.settlesAt - market.openedAt;
  market.openedAt = now;
  market.createdAt = market.createdAt || now;
  market.locksAt = now + duration - LOCK_BEFORE_SETTLEMENT_MS;
  market.settlesAt = now + duration;
  market.currentLikes = currentLikes;
  market.rangeBasis = basis;
  market.lastPricedAt = history.at(-1)?.capturedAt ?? now;
  market.review = { ...(market.review ?? { submittedAt: now }), decidedAt: now, decidedBy: opts.actor, note: opts.note ?? null };
  ctx.state.snapshots[video.id] = history.map((h) => ({ ...h, id: newId("snp"), videoId: video.id, source: video.provider }));
  ctx.state.outcomes[marketId] = buildOutcomes(marketId, ranges, now);
  ctx.state.priceHistory[marketId] = [];
  reprice(ctx, market, market.lastPricedAt, { initial: true });
  transition(ctx, market, "OPEN", { actor: opts.actor, reason: "submission approved" });
  if (market.createdByUserId) {
    notify(ctx, {
      userId: market.createdByUserId,
      kind: "SUBMISSION",
      title: `Your market on @${video.creatorHandle} is live.`,
      body: "Thanks for the link. Trading is open for 24 hours.",
      marketId,
    });
  }
  notifyInterestedUsers(ctx, market);
  track(ctx, "market_opened", market.createdByUserId ?? null, { market_id: marketId, source: market.source });
  return market;
}

export function rejectDraft(ctx: Ctx, marketId: string, opts: { actor: string; note: string }) {
  const { market, video } = getMarket(ctx, marketId);
  if (market.status !== "DRAFT") throw Errors.invalid("Only markets waiting for review can be rejected.");
  const now = ctx.now();
  market.review = { ...(market.review ?? { submittedAt: now }), decidedAt: now, decidedBy: opts.actor, note: opts.note };
  market.cancellation = { reason: "ADMIN", explanation: `This submission wasn't approved: ${opts.note}`, at: now };
  transition(ctx, market, "CANCELLED", { actor: opts.actor, reason: `submission rejected: ${opts.note}` });
  ctx.state.settlements[marketId] = {
    id: newId("stl"),
    marketId,
    kind: "CANCELLED",
    finalMetric: null,
    winningOutcomeId: null,
    source: "review",
    settledAt: now,
    metadata: { reason: "ADMIN", note: opts.note, refunds: 0 },
  };
  if (market.createdByUserId) {
    notify(ctx, { userId: market.createdByUserId, kind: "SUBMISSION", title: `Your link for @${video.creatorHandle} wasn't approved.`, body: opts.note, marketId });
  }
  return market;
}

/** §22 "notify interested users": people who traded this creator before hear about the new market. */
function notifyInterestedUsers(ctx: Ctx, market: MarketRow) {
  const flags = (ctx.state.marketFlags[market.id] ??= {});
  if (flags.openedNotified) return;
  flags.openedNotified = true;
  const video = ctx.state.videos[market.videoId];
  const handle = video.creatorHandle.toLowerCase();
  const creatorMarkets = new Set(
    Object.values(ctx.state.markets)
      .filter((m) => m.id !== market.id && ctx.state.videos[m.videoId]?.creatorHandle.toLowerCase() === handle)
      .map((m) => m.id),
  );
  if (!creatorMarkets.size) return;
  const users = new Set<string>();
  for (const t of ctx.state.trades) if (creatorMarkets.has(t.marketId)) users.add(t.userId);
  for (const userId of users) {
    if (userId === market.createdByUserId || userId === market.creatorUserId) continue;
    notify(ctx, { userId, kind: "MARKET_OPENED", title: `New market on @${video.creatorHandle}.`, body: "You traded this creator before. Trading is open for 24 hours.", marketId: market.id });
  }
}

// ---------------------------------------------------------------------------
// Metric collection & pricing loop (§18, §19, §21, §23)
// ---------------------------------------------------------------------------

/**
 * Records one like-count observation. Duplicates (same or older timestamp) are ignored. Drops over
 * 20% and physically implausible jumps are stored but marked suspicious and excluded from pricing;
 * a lower level confirmed by three consecutive readings is accepted as a data correction.
 */
export function recordSnapshot(ctx: Ctx, marketId: string, snap: { likes: number; capturedAt: number; source: string }) {
  const { market } = getMarket(ctx, marketId);
  const series = (ctx.state.snapshots[market.videoId] ??= []);
  const last = series[series.length - 1];
  if (last && snap.capturedAt <= last.capturedAt) return false;
  if (!Number.isFinite(snap.likes) || snap.likes < 0) return false;

  const usable = series.filter((s) => !s.suspicious);
  const lastGood = usable[usable.length - 1];
  const row: SnapshotRow = { id: newId("snp"), videoId: market.videoId, ...snap, likes: Math.round(snap.likes) };
  if (lastGood) row.suspicious = classifySnapshot(ctx, market, usable, row);
  series.push(row);

  if (row.suspicious) confirmCorrection(ctx, market, series);
  const priced = series.filter((s) => !s.suspicious);
  market.currentLikes = priced[priced.length - 1]?.likes ?? market.currentLikes;
  market.lastPricedAt = snap.capturedAt;
  reprice(ctx, market, snap.capturedAt);
  return true;
}

function classifySnapshot(ctx: Ctx, market: MarketRow, usable: SnapshotRow[], snap: SnapshotRow): boolean {
  const last = usable[usable.length - 1];
  const hourAgo = usable.find((s) => s.capturedAt >= last.capturedAt - HOUR) ?? usable[0];
  const minutes = Math.max(1, (last.capturedAt - hourAgo.capturedAt) / 60_000);
  const baselinePerMin = Math.max(1, (last.likes - hourAgo.likes) / minutes);
  const stepMin = Math.max(1, (snap.capturedAt - last.capturedAt) / 60_000);
  const stepPerMin = (snap.likes - last.likes) / stepMin;

  // Impossible velocity (§27): no organic video gains this fast. Price nothing from it; pause for review.
  if (stepPerMin > 50_000 || (snap.likes > last.likes * 10 && snap.likes - last.likes > 10_000)) {
    flagRisk(ctx, { entityType: "market", entityId: market.id, reason: "Impossible like velocity", severity: 0.9, metadata: { from: last.likes, to: snap.likes, stepPerMin } });
    if (market.status === "OPEN") transition(ctx, market, "PAUSED", { actor: "system", reason: UNDER_REVIEW });
    return true;
  }
  if (snap.likes - last.likes > 5_000 && stepPerMin > baselinePerMin * 15) {
    flagRisk(ctx, { entityType: "market", entityId: market.id, reason: "Unusual metric jump", severity: 0.7, metadata: { from: last.likes, to: snap.likes, baselinePerMin, stepPerMin } });
  }
  if (snap.likes < last.likes * 0.8) {
    flagRisk(ctx, { entityType: "market", entityId: market.id, reason: "Metric inconsistency (likes dropped)", severity: 0.5, metadata: { from: last.likes, to: snap.likes } });
    return true;
  }
  return false;
}

/** Three consecutive consistent low readings mean the platform really corrected the count. */
function confirmCorrection(ctx: Ctx, market: MarketRow, series: SnapshotRow[]) {
  const tail = series.slice(-3);
  if (tail.length < 3 || !tail.every((s) => s.suspicious)) return;
  const lo = Math.min(...tail.map((s) => s.likes));
  const hi = Math.max(...tail.map((s) => s.likes));
  if (lo <= 0 || hi > lo * 1.05) return;
  for (const s of tail) s.suspicious = false;
  flagRisk(ctx, { entityType: "market", entityId: market.id, reason: "Like count corrected downward by the platform", severity: 0.6, metadata: { likes: hi } });
}

const maxAbsDiff = (a: number[], b: number[]) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
/** Log-linear blend of two distributions: λ=0 → a, λ=1 → b. */
const blend = (a: number[], b: number[], lambda: number) => normalize(a.map((p, i) => Math.exp((1 - lambda) * Math.log(p) + lambda * Math.log(b[i]))));

/**
 * One model update (§21). Model probability is the prior; user trades are the quantities. A single
 * update may move any price at most MAX_REPRICE_MOVE (more during a spike), except when a range
 * becomes unreachable. Invalid model output is never priced: the previous prior stays and an alert
 * fires. Every run is stored with its model version for backtesting (§19).
 */
export function reprice(ctx: Ctx, market: MarketRow, at: number, opts: { initial?: boolean } = {}) {
  const outcomes = ctx.state.outcomes[market.id];
  const ranges = rangesOf(outcomes);
  const history = robustHistory(usableSnapshots(ctx, market.videoId));
  const raw = computeFeatures(history, at);
  const momentum = opts.initial ? raw.momentumScore : smoothMomentum(market.momentumScore, raw.momentumScore);
  const features = { ...raw, momentumScore: momentum };
  const prior = market.rangeBasis ? coldStartPrior(ranges, market.rangeBasis.center) : undefined;

  const fc = forecast({ currentLikes: market.currentLikes, now: at, settlesAt: market.settlesAt, features, ranges, prior });
  const previous = opts.initial ? null : outcomes.map((o) => o.modelProbability);
  let model = enforceReachable(smoothProbabilities(previous, fc.probabilities, { spike: isSpike(features) }), ranges, market.currentLikes);

  if (!isValidDistribution(model, outcomes.length)) {
    raiseAlert(ctx, "critical", "Model produced an invalid probability distribution", { marketId: market.id, model });
    flagRisk(ctx, { entityType: "market", entityId: market.id, reason: "Invalid model output", severity: 0.8, metadata: { model } });
    return { features, forecast: fc };
  }

  const state = lmsrStateOf(market, outcomes);
  const before = lmsr.prices(state);
  let capped = false;
  if (previous) {
    const cap = isSpike(features) ? MAX_REPRICE_MOVE_SPIKE : MAX_REPRICE_MOVE;
    const pricesWith = (m: number[]) => lmsr.prices({ ...state, modelProbabilities: m });
    if (maxAbsDiff(pricesWith(model), before) > cap) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (maxAbsDiff(pricesWith(blend(previous, model, mid)), before) > cap) hi = mid;
        else lo = mid;
      }
      model = enforceReachable(blend(previous, model, lo), ranges, market.currentLikes);
      capped = true;
    }
  }
  outcomes.forEach((o, i) => (o.modelProbability = model[i]));

  market.momentumScore = momentum;
  market.momentumLabel = momentumLabel(momentum);
  market.change3h = raw.change3h;
  refreshPrices(ctx, market, at);

  const video = ctx.state.videos[market.videoId];
  const list = ((ctx.state.forecasts ??= {})[market.id] ??= []);
  list.push({
    marketId: market.id,
    at,
    modelVersion: MODEL_VERSION,
    expectedFinalLikes: Math.round(fc.expectedFinalLikes),
    uncertainty: Math.round(fc.uncertainty * 1000) / 1000,
    momentum: Math.round(momentum * 1000) / 1000,
    probabilities: model.map((p) => Math.round(p * 1e5) / 1e5),
    pricesBefore: before.map((p) => Math.round(p * 1e5) / 1e5),
    pricesAfter: outcomes.map((o) => Math.round(o.currentPrice * 1e5) / 1e5),
    capped,
    videoAgeMin: video ? Math.round((at - video.publishedAt) / 60_000) : 0,
  });
  if (!opts.initial) notifyMovement(ctx, market, at);
  return { features, forecast: fc };
}

const GAIN_LEVELS = [0.5, 1, 2, 4, 9];
const LOSS_LEVELS = [-0.5, -0.8];

function notifyMovement(ctx: Ctx, market: MarketRow, at: number) {
  const outcomes = ctx.state.outcomes[market.id];
  const video = ctx.state.videos[market.videoId];
  const holders = openPositions(ctx, market.id).filter((p) => !ctx.state.users[p.userId]?.isBot);
  if (holders.length === 0) return;

  const flags = (ctx.state.marketFlags[market.id] ??= {});
  if (!flags.lastSpikeNotifiedAt || at - flags.lastSpikeNotifiedAt >= 3 * HOUR) {
    let best: { o: OutcomeRow; from: number } | null = null;
    for (const o of outcomes) {
      const from = priceAt(ctx, market.id, o.id, at - HOUR);
      if (from === null) continue;
      if (o.currentPrice - from >= 0.1 && o.currentPrice >= from * 1.6) {
        if (!best || o.currentPrice - from > best.o.currentPrice - best.from) best = { o, from };
      }
    }
    if (best) {
      flags.lastSpikeNotifiedAt = at;
      const userIds = new Set(holders.map((h) => h.userId));
      for (const userId of userIds) {
        notify(ctx, {
          userId,
          kind: "SPIKE",
          title: `Big move on @${video.creatorHandle}'s market.`,
          body: `${best.o.label} moved from ${Math.round(best.from * 100)}% to ${Math.round(best.o.currentPrice * 100)}%.`,
          marketId: market.id,
        });
      }
    }
  }

  for (const p of holders) {
    const o = outcomes.find((x) => x.id === p.outcomeId)!;
    if (p.averageEntryPrice <= 0) continue;
    const change = o.currentPrice / p.averageEntryPrice - 1;
    const level = [...GAIN_LEVELS].reverse().find((l) => change >= l);
    if (level && level > p.notifiedGainLevel) {
      p.notifiedGainLevel = level;
      notify(ctx, {
        userId: p.userId,
        kind: "PRICE_MOVE",
        title: `Your ${o.label} position is up ${Math.round(change * 100)}%.`,
        body: `@${video.creatorHandle} · now ${Math.round(o.currentPrice * 100)}%`,
        marketId: market.id,
      });
    }
    const down = LOSS_LEVELS.find((l) => change <= l);
    if (down && down < (p.notifiedLossLevel ?? 0)) {
      p.notifiedLossLevel = down;
      notify(ctx, {
        userId: p.userId,
        kind: "POSITION_DOWN",
        title: `Your ${o.label} position is down ${Math.round(-change * 100)}%.`,
        body: `@${video.creatorHandle} · now ${Math.round(o.currentPrice * 100)}%. You can sell any time before trading closes.`,
        marketId: market.id,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle: pause, lock, settle, cancel (§24, §25, §26)
// ---------------------------------------------------------------------------

export function pauseMarket(ctx: Ctx, marketId: string, reason: string, actor: string | null) {
  const { market } = getMarket(ctx, marketId);
  if (market.status === "PAUSED") {
    market.pausedReason = reason;
    return false;
  }
  if (market.status !== "OPEN") throw Errors.invalid("Only open markets can be paused.");
  return transition(ctx, market, "PAUSED", { actor, reason });
}

export function resumeMarket(ctx: Ctx, marketId: string, actor: string | null) {
  const { market } = getMarket(ctx, marketId);
  if (market.status !== "PAUSED") return false;
  if (ctx.now() >= market.locksAt) return transition(ctx, market, "LOCKED", { actor, reason: "lock time passed while paused" });
  return transition(ctx, market, "OPEN", { actor, reason: "resumed" });
}

export function lockMarket(ctx: Ctx, marketId: string, actor: string | null = null) {
  const { market } = getMarket(ctx, marketId);
  if (market.status !== "OPEN" && market.status !== "PAUSED") return false;
  return transition(ctx, market, "LOCKED", { actor, reason: "trading closed" });
}

export function notifyClosingSoon(ctx: Ctx, marketId: string) {
  const { market, video } = getMarket(ctx, marketId);
  const flags = (ctx.state.marketFlags[marketId] ??= {});
  if (flags.closingNotified) return;
  flags.closingNotified = true;
  const userIds = new Set(openPositions(ctx, marketId).map((p) => p.userId));
  for (const userId of userIds) {
    notify(ctx, {
      userId,
      kind: "CLOSING",
      title: "This market closes in 30 minutes.",
      body: `@${video.creatorHandle} · ${compactNumber(market.currentLikes)} likes`,
      marketId,
    });
  }
}

export type SettlementResult = {
  alreadySettled: boolean;
  marketId: string;
  finalMetric: number | null;
  winningOutcomeId: string | null;
  payouts: number;
};

/**
 * Validates a final metric (§25): it must be a whole number, consistent with the recorded
 * trajectory (no big drop, no implausible jump), and captured close to the settlement time.
 */
export function integrityIssues(ctx: Ctx, marketId: string, finalLikes: number, capturedAt?: number): string[] {
  const { market } = getMarket(ctx, marketId);
  const issues: string[] = [];
  if (!Number.isFinite(finalLikes) || finalLikes < 0 || !Number.isInteger(finalLikes)) {
    issues.push("Final likes must be a non-negative integer");
    return issues;
  }
  const series = usableSnapshots(ctx, market.videoId);
  const last = series[series.length - 1];
  if (last && finalLikes < last.likes * 0.9) issues.push("Final likes are well below the last snapshot");
  const hourAgo = series.find((s) => last && s.capturedAt >= last.capturedAt - HOUR);
  if (last && hourAgo) {
    const perMin = Math.max(1, (last.likes - hourAgo.likes) / Math.max(1, (last.capturedAt - hourAgo.capturedAt) / 60_000));
    const minutesSince = Math.max(5, ((capturedAt ?? market.settlesAt) - last.capturedAt) / 60_000);
    if (finalLikes - last.likes > 5_000 && finalLikes - last.likes > perMin * minutesSince * 20) issues.push("Final likes jumped far above the recent trend");
  }
  if (capturedAt !== undefined && capturedAt - market.settlesAt > FINAL_METRIC_MAX_DELAY_MS) {
    issues.push(`Final likes were captured ${Math.round((capturedAt - market.settlesAt) / 60_000)} minutes after settlement time`);
  }
  if (market.riskScore >= 0.9) issues.push("Market has an open high-severity risk flag");
  return issues;
}

/**
 * Stage 1 of settlement (§1 "settlement happens after review"). Records the proposed final metric
 * and winner. Without review (demo worlds, or the flag off) a clean proposal settles immediately;
 * otherwise the market waits in SETTLING for a reviewer.
 */
export function proposeSettlement(
  ctx: Ctx,
  marketId: string,
  metric: { likes: number; source: string; capturedAt: number },
  opts: { actor: string | null; requireReview: boolean },
) {
  const { market, outcomes, video } = getMarket(ctx, marketId);
  if (ctx.state.settlements[marketId]) return { status: "final" as const };
  if (market.status === "LOCKED") transition(ctx, market, "SETTLING", { actor: opts.actor, reason: "settlement time reached" });
  if (market.status !== "SETTLING") throw Errors.invalid("Market isn't ready to settle.");
  const issues = integrityIssues(ctx, marketId, metric.likes, metric.capturedAt);
  const winnerIndex = winningRangeIndex(rangesOf(outcomes), metric.likes);
  market.proposedSettlement = {
    finalMetric: metric.likes,
    source: metric.source,
    capturedAt: metric.capturedAt,
    winningOutcomeId: outcomes[winnerIndex]?.id ?? outcomes[0].id,
    issues,
    proposedAt: ctx.now(),
  };
  audit(ctx, { actor: opts.actor, action: "market.propose_settlement", entityType: "market", entityId: marketId, metadata: { finalMetric: metric.likes, source: metric.source, issues } });
  if (!opts.requireReview && issues.length === 0) {
    const result = settleMarket(ctx, marketId, metric.likes, { source: metric.source, actor: opts.actor ?? "system", capturedAt: metric.capturedAt });
    return { status: "settled" as const, result };
  }
  market.pausedReason = issues.length ? SETTLEMENT_BLOCKED : "Awaiting review";
  if (issues.length) {
    flagRisk(ctx, { entityType: "market", entityId: marketId, reason: `Settlement needs review: ${issues.join("; ")}`, severity: 0.8, metadata: { finalLikes: metric.likes } });
  }
  raiseAlert(ctx, issues.length ? "warning" : "info", `Settlement waiting for review: @${video.creatorHandle}`, { marketId, finalMetric: metric.likes, issues });
  return { status: "review" as const, issues };
}

/**
 * Stage 2 (reviewer). Confirms the proposal, or settles on a corrected number with a written reason.
 * Proposals with integrity issues can only be confirmed with `acknowledgeIssues`.
 */
export function approveSettlement(
  ctx: Ctx,
  marketId: string,
  opts: { actor: string; finalMetric?: number; reason?: string; acknowledgeIssues?: boolean },
): SettlementResult {
  const { market } = getMarket(ctx, marketId);
  if (ctx.state.settlements[marketId]) return settleMarket(ctx, marketId, market.finalMetric ?? 0, { source: "review", actor: opts.actor });
  const proposal = market.proposedSettlement ?? null;
  if (!proposal && opts.finalMetric === undefined) throw Errors.invalid("There's no proposed result yet. Enter the final like count.");
  // Settling on a number other than the recorded one is a correction and needs a written reason.
  const override = proposal !== null && opts.finalMetric !== undefined && opts.finalMetric !== proposal.finalMetric;
  if (override && !opts.reason?.trim()) throw Errors.invalid("Explain why you're settling on a different number.");
  const finalMetric = opts.finalMetric ?? proposal!.finalMetric;
  const issues = proposal && !override ? proposal.issues : integrityIssues(ctx, marketId, finalMetric);
  if (issues.length && !opts.acknowledgeIssues) throw new WesifyError("SETTLEMENT_ISSUES", `Review these first: ${issues.join("; ")}`, 409, { issues });
  if (market.status === "LOCKED") transition(ctx, market, "SETTLING", { actor: opts.actor, reason: "manual settlement" });
  return settleMarket(ctx, marketId, finalMetric, {
    source: override ? "reviewer-correction" : proposal ? proposal.source : "manual-entry",
    actor: opts.actor,
    force: true,
    capturedAt: proposal?.capturedAt,
    reviewNote: opts.reason ?? null,
  });
}

/**
 * Pays out a market (§25). Idempotent: a second call returns the existing settlement and pays
 * nothing, whatever metric it's given. Everything below runs synchronously, so no other request
 * can interleave between validation and the last ledger row.
 */
export function settleMarket(
  ctx: Ctx,
  marketId: string,
  finalLikes: number,
  opts: { source: string; actor: string | null; force?: boolean; capturedAt?: number; reviewNote?: string | null },
): SettlementResult {
  const { market, outcomes, video } = getMarket(ctx, marketId);
  const existing = ctx.state.settlements[marketId];
  if (existing) {
    return { alreadySettled: true, marketId, finalMetric: existing.finalMetric, winningOutcomeId: existing.winningOutcomeId, payouts: 0 };
  }
  if (market.status === "DRAFT" || market.status === "OPEN" || market.status === "PAUSED") {
    throw Errors.invalid("Close trading before settling this market.");
  }

  const issues = integrityIssues(ctx, marketId, finalLikes, opts.capturedAt);
  if (issues.length && (!opts.force || !Number.isInteger(finalLikes) || finalLikes < 0)) {
    if (market.status === "LOCKED") transition(ctx, market, "SETTLING", { actor: opts.actor, reason: "settlement blocked" });
    market.pausedReason = SETTLEMENT_BLOCKED;
    flagRisk(ctx, { entityType: "market", entityId: marketId, reason: `Settlement blocked: ${issues.join("; ")}`, severity: 0.8, metadata: { finalLikes } });
    throw Errors.invalid(`Settlement blocked: ${issues.join("; ")}`);
  }

  const winnerIndex = winningRangeIndex(rangesOf(outcomes), finalLikes);
  const winner = outcomes[winnerIndex];
  if (!winner) throw Errors.invalid("No range contains this like count.");
  const now = ctx.now();
  if (market.status === "LOCKED") transition(ctx, market, "SETTLING", { actor: opts.actor, reason: "settling" });

  let payouts = 0;
  for (const p of openPositions(ctx, marketId)) {
    const won = p.outcomeId === winner.id;
    // Winning shares pay W$1.00 each, rounded down to the cent; losing shares pay W$0 (§25).
    const payout = won ? floorCents(p.shares) : 0;
    const costBasis = roundCents(p.shares * p.averageEntryPrice);
    const pnl = roundCents(payout - costBasis);
    const outcome = outcomes.find((o) => o.id === p.outcomeId)!;
    if (payout > 0) {
      postLedger(ctx, {
        userId: p.userId,
        type: "SETTLEMENT",
        amount: payout,
        referenceType: "market",
        referenceId: marketId,
        description: `Payout: ${outcome.label} on @${video.creatorHandle}`,
      });
      payouts += payout;
    }
    recordPositionEvent(ctx, p, { kind: "SETTLE", pnl, won, exitPrice: won ? 1 : 0 });
    p.realizedPnl = roundCents(p.realizedPnl + pnl);
    p.settlement = { won, payout, costBasis, pnl, kind: "SETTLED" };
    p.shares = 0;
    p.closedAt = now;
    p.updatedAt = now;
    notify(ctx, {
      userId: p.userId,
      kind: "SETTLEMENT",
      title: won ? `You won ${fmtCredits(payout)} on @${video.creatorHandle}.` : `${outcome.label} didn't hit on @${video.creatorHandle}.`,
      body: `Final likes: ${compactNumber(finalLikes)} · ${winner.label}`,
      marketId,
    });
  }

  outcomes.forEach((o) => (o.currentPrice = o.id === winner.id ? 1 : 0));
  const history = (ctx.state.priceHistory[marketId] ??= []);
  outcomes.forEach((o) =>
    history.push({ marketId, outcomeId: o.id, price: o.currentPrice, modelProbability: o.modelProbability, recordedAt: Math.min(now, market.settlesAt) }),
  );

  market.finalMetric = finalLikes;
  market.currentLikes = Math.max(market.currentLikes, finalLikes);
  market.winningOutcomeId = winner.id;
  market.pausedReason = null;
  transition(ctx, market, "SETTLED", { actor: opts.actor, reason: `final likes ${finalLikes}` });
  ctx.state.settlements[marketId] = {
    id: newId("stl"),
    marketId,
    kind: "SETTLED",
    finalMetric: finalLikes,
    winningOutcomeId: winner.id,
    source: opts.source,
    settledAt: now,
    metadata: {
      payouts: roundCents(payouts),
      forced: Boolean(opts.force),
      issues,
      capturedAt: opts.capturedAt ?? null,
      engineVersion: SETTLEMENT_ENGINE_VERSION,
      reviewedBy: opts.force ? opts.actor : null,
      reviewNote: opts.reviewNote ?? null,
      proposal: market.proposedSettlement ?? null,
    },
  };
  audit(ctx, { actor: opts.actor, action: "market.settle", entityType: "market", entityId: marketId, metadata: { finalLikes, winner: winner.label, payouts, source: opts.source, engineVersion: SETTLEMENT_ENGINE_VERSION } });
  track(ctx, "market_settled", null, { market_id: marketId, video_id: video.id, platform: video.platform, outcome: winner.label });
  return { alreadySettled: false, marketId, finalMetric: finalLikes, winningOutcomeId: winner.id, payouts };
}

/**
 * Refunds every open position at cost basis (§26). Idempotent like settlement. Shares already sold
 * stay sold. `reason` picks the public explanation shown on the market page.
 */
export function cancelMarket(ctx: Ctx, marketId: string, opts: { reason: string; actor: string | null; code?: CancelReason; note?: string | null }) {
  const { market, video } = getMarket(ctx, marketId);
  if (ctx.state.settlements[marketId]) return { alreadyFinal: true, refunds: 0 };
  if (isFinal(market.status)) return { alreadyFinal: true, refunds: 0 };
  const code: CancelReason = opts.code ?? "ADMIN";
  const now = ctx.now();
  let refunds = 0;
  for (const p of openPositions(ctx, marketId)) {
    const costBasis = roundCents(p.shares * p.averageEntryPrice);
    if (costBasis > 0) {
      postLedger(ctx, {
        userId: p.userId,
        type: "CANCELLATION_REFUND",
        amount: costBasis,
        referenceType: "market",
        referenceId: marketId,
        description: `Refund: cancelled market on @${video.creatorHandle}`,
      });
      refunds += costBasis;
    }
    recordPositionEvent(ctx, p, { kind: "REFUND", pnl: 0, won: null, exitPrice: p.averageEntryPrice });
    p.settlement = { won: false, payout: costBasis, costBasis, pnl: 0, kind: "CANCELLED" };
    p.shares = 0;
    p.closedAt = now;
    p.updatedAt = now;
    notify(ctx, {
      userId: p.userId,
      kind: "CANCELLED",
      title: `Market on @${video.creatorHandle} was cancelled.`,
      body: `${fmtCredits(costBasis)} refunded. ${CANCEL_REASONS[code].explanation}`,
      marketId,
    });
  }
  market.cancellation = { reason: code, explanation: opts.note?.trim() ? `${CANCEL_REASONS[code].explanation} ${opts.note.trim()}` : CANCEL_REASONS[code].explanation, at: now };
  market.pausedReason = null;
  transition(ctx, market, "CANCELLED", { actor: opts.actor, reason: `${code}: ${opts.reason}` });
  ctx.state.settlements[marketId] = {
    id: newId("stl"),
    marketId,
    kind: "CANCELLED",
    finalMetric: null,
    winningOutcomeId: null,
    source: "cancellation",
    settledAt: now,
    metadata: { reason: opts.reason, code, refunds: roundCents(refunds), engineVersion: SETTLEMENT_ENGINE_VERSION },
  };
  audit(ctx, { actor: opts.actor, action: "market.cancel", entityType: "market", entityId: marketId, metadata: { reason: opts.reason, code, refunds } });
  track(ctx, "market_cancelled", null, { market_id: marketId, reason: code });
  return { alreadyFinal: false, refunds: roundCents(refunds) };
}

export { isLive };

export function recordPositionEvent(
  ctx: Ctx,
  p: PositionRow,
  e: { kind: PositionEvent["kind"]; pnl: number; won: boolean | null; exitPrice: number },
) {
  ctx.state.positionEvents.push({
    id: newId("pev"),
    userId: p.userId,
    marketId: p.marketId,
    outcomeId: p.outcomeId,
    kind: e.kind,
    pnl: e.pnl,
    won: e.won,
    entryPrice: p.averageEntryPrice,
    exitPrice: e.exitPrice,
    createdAt: ctx.now(),
  });
}

export function getOrCreatePosition(ctx: Ctx, userId: string, marketId: string, outcomeId: string): PositionRow {
  const key = positionKey(userId, marketId, outcomeId);
  const now = ctx.now();
  return (ctx.state.positions[key] ??= {
    id: newId("pos"),
    userId,
    marketId,
    outcomeId,
    shares: 0,
    averageEntryPrice: 0,
    realizedPnl: 0,
    totalBought: 0,
    closedAt: null,
    settlement: null,
    notifiedGainLevel: 0,
    notifiedLossLevel: 0,
    createdAt: now,
    updatedAt: now,
  });
}
