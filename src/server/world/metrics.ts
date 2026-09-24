import { newId } from "@/lib/shared/random";
import { naiveLinearForecast, winningRangeIndex } from "@/lib/virality-engine";
import type { Ctx } from "./context";
import { isFinal } from "./lifecycle";
import { rangesOf } from "./markets";
import { marketStats } from "./queries";

/**
 * Metrics for the founder dashboard, business dashboard and model analytics (checklist §39–§41,
 * §67). Everything is derived from first-party state so the numbers are visible without SQL.
 * Bots (simulated traders) are always excluded from people metrics.
 */

const DAY = 86_400_000;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Records that a user was active today (DAU/WAU/MAU, retention) and extends their visit. */
export function recordActivity(ctx: Ctx, userId: string | null, visitId: string | null, opts: { marketView?: boolean } = {}) {
  const now = ctx.now();
  if (userId) {
    const user = ctx.state.users[userId];
    if (user && !user.isBot) {
      if (!user.lastActiveAt || now - user.lastActiveAt > 60_000) user.lastActiveAt = now;
      const days = ((ctx.state.activity ??= {})[userId] ??= []);
      const k = dayKey(now);
      if (days[days.length - 1] !== k) {
        days.push(k);
        if (days.length > 400) days.splice(0, days.length - 400);
      }
    }
  }
  if (!visitId) return;
  const visits = (ctx.state.visits ??= {});
  let v = visits[visitId];
  if (!v || now - v.lastAt > 30 * 60_000) {
    const id = v ? newId("vis") : visitId;
    v = visits[id] = { id, userId, startedAt: now, lastAt: now, marketViews: 0 };
  }
  v.lastAt = now;
  v.userId ??= userId;
  if (opts.marketView) v.marketViews++;
}

function people(ctx: Ctx) {
  return Object.values(ctx.state.users).filter((u) => !u.isBot && u.status !== "deleted");
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function activeUsers(ctx: Ctx, days: number, now: number) {
  const since = dayKey(now - (days - 1) * DAY);
  return Object.entries(ctx.state.activity ?? {}).filter(([id, ds]) => !ctx.state.users[id]?.isBot && ds.some((d) => d >= since)).length;
}

/** Share of a signup cohort active N days after signing up (±0 days, exact day). */
function retention(ctx: Ctx, n: number, now: number) {
  const eligible = people(ctx).filter((u) => u.createdAt <= now - n * DAY);
  if (!eligible.length) return null;
  const hit = eligible.filter((u) => {
    const target = dayKey(u.createdAt + n * DAY);
    return (ctx.state.activity?.[u.id] ?? []).some((d) => d >= target);
  }).length;
  return hit / eligible.length;
}

export function businessMetrics(ctx: Ctx) {
  const now = ctx.now();
  const users = people(ctx);
  const humanIds = new Set(users.map((u) => u.id));
  const trades = ctx.state.trades.filter((t) => humanIds.has(t.userId));
  const buys = trades.filter((t) => t.side === "BUY");
  const byUser = new Map<string, typeof trades>();
  for (const t of trades) (byUser.get(t.userId) ?? byUser.set(t.userId, []).get(t.userId)!).push(t);
  const traders = [...byUser.keys()];
  const since7 = now - 7 * DAY;
  const activeTraders = traders.filter((id) => byUser.get(id)!.some((t) => t.createdAt >= since7)).length;
  const newTraders = traders.filter((id) => byUser.get(id)![0].createdAt >= since7).length;
  const marketsPerTrader = traders.map((id) => new Set(byUser.get(id)!.map((t) => t.marketId)).size);

  // Positions closed before settlement (sold) vs held to the end.
  const exits = ctx.state.positionEvents.filter((e) => humanIds.has(e.userId) && e.kind !== "REFUND");
  const sells = exits.filter((e) => e.kind === "SELL").length;

  const liveOrDone = Object.values(ctx.state.markets).filter((m) => m.status !== "DRAFT");
  const perMarketTrades = liveOrDone.map((m) => marketStats(ctx, m.id).trades);
  const lowLiquidity = liveOrDone.filter((m) => (m.status === "OPEN" || m.status === "PAUSED") && m.openedAt < now - 2 * 3_600_000 && marketStats(ctx, m.id).traders < 3).length;

  const shares = ctx.state.events.filter((e) => e.name === "share_clicked" || e.name === "market_shared").length;
  const referrals = ctx.state.referrals ?? [];
  const model = modelAnalytics(ctx);

  return {
    registeredUsers: users.length,
    dau: activeUsers(ctx, 1, now),
    wau: activeUsers(ctx, 7, now),
    mau: activeUsers(ctx, 28, now),
    activeTraders7d: activeTraders,
    newTraders7d: newTraders,
    tradesPerTrader: traders.length ? trades.length / traders.length : 0,
    marketsPerTrader: marketsPerTrader.length ? marketsPerTrader.reduce((a, b) => a + b, 0) / marketsPerTrader.length : 0,
    averageTradeSize: buys.length ? buys.reduce((s, t) => s + t.credits, 0) / buys.length : 0,
    medianTradeSize: median(buys.map((t) => t.credits)),
    totalVolume: trades.reduce((s, t) => s + t.credits, 0),
    firstTradeConversion: users.length ? traders.length / users.length : 0,
    secondTradeConversion: traders.length ? traders.filter((id) => byUser.get(id)!.length >= 2).length / traders.length : 0,
    retentionD1: retention(ctx, 1, now),
    retentionD7: retention(ctx, 7, now),
    retentionD28: retention(ctx, 28, now),
    sellBeforeSettlementRate: exits.length ? sells / exits.length : null,
    marketsWithLowLiquidity: lowLiquidity,
    averageTradesPerMarket: perMarketTrades.length ? perMarketTrades.reduce((a, b) => a + b, 0) / perMarketTrades.length : 0,
    creatorShareRate: traders.length ? shares / traders.length : 0,
    referralConversion: referrals.length ? referrals.filter((r) => r.status === "rewarded").length / referrals.length : null,
    modelBrier: model.overall.brier,
    timeToFirstTradeMedianMin: median(
      traders.map((id) => (byUser.get(id)![0].createdAt - (ctx.state.users[id]?.createdAt ?? 0)) / 60_000).filter((m) => m >= 0),
    ),
    sessionLengthMedianMin: median(Object.values(ctx.state.visits ?? {}).map((v) => (v.lastAt - v.startedAt) / 60_000)),
    marketsViewedPerSession: (() => {
      const v = Object.values(ctx.state.visits ?? {});
      return v.length ? v.reduce((s, x) => s + x.marketViews, 0) / v.length : 0;
    })(),
  };
}

/** Weekly signup cohorts × weeks since signup, as the share still active (§39 cohort analysis). */
export function cohorts(ctx: Ctx, weeks = 8) {
  const now = ctx.now();
  const start = now - weeks * 7 * DAY;
  const rows: { cohort: string; size: number; weeks: (number | null)[] }[] = [];
  for (let w = 0; w < weeks; w++) {
    const from = start + w * 7 * DAY;
    const to = from + 7 * DAY;
    const members = people(ctx).filter((u) => u.createdAt >= from && u.createdAt < to);
    const cells: (number | null)[] = [];
    for (let k = 0; k < weeks - w; k++) {
      const a = dayKey(from + k * 7 * DAY);
      const b = dayKey(from + (k + 1) * 7 * DAY);
      if (from + k * 7 * DAY > now) cells.push(null);
      else cells.push(members.length ? members.filter((u) => (ctx.state.activity?.[u.id] ?? []).some((d) => d >= a && d < b)).length / members.length : null);
    }
    rows.push({ cohort: dayKey(from), size: members.length, weeks: cells });
  }
  return rows;
}

/** Signup → onboarding → first market view → first trade → second trade (§39 funnel analysis). */
export function funnel(ctx: Ctx, days = 30) {
  const since = ctx.now() - days * DAY;
  const cohort = people(ctx).filter((u) => u.createdAt >= since);
  const ids = new Set(cohort.map((u) => u.id));
  const viewed = new Set(ctx.state.events.filter((e) => e.name === "market_viewed" && e.userId && ids.has(e.userId)).map((e) => e.userId!));
  const tradeCounts = new Map<string, number>();
  for (const t of ctx.state.trades) if (ids.has(t.userId)) tradeCounts.set(t.userId, (tradeCounts.get(t.userId) ?? 0) + 1);
  return [
    { step: "Signed up", users: cohort.length },
    { step: "Finished onboarding", users: cohort.filter((u) => u.onboardingCompletedAt).length },
    { step: "Viewed a market", users: viewed.size },
    { step: "First trade", users: [...tradeCounts.values()].filter((n) => n >= 1).length },
    { step: "Second trade", users: [...tradeCounts.values()].filter((n) => n >= 2).length },
  ];
}

export function founderDashboard(ctx: Ctx) {
  const now = ctx.now();
  const today = dayKey(now);
  const users = people(ctx);
  const humanIds = new Set(users.map((u) => u.id));
  const todayTrades = ctx.state.trades.filter((t) => humanIds.has(t.userId) && dayKey(t.createdAt) === today);
  const firstTradeByUser = new Map<string, number>();
  for (const t of ctx.state.trades) if (humanIds.has(t.userId) && !firstTradeByUser.has(t.userId)) firstTradeByUser.set(t.userId, t.createdAt);
  const tradesByUser = new Map<string, number>();
  for (const t of ctx.state.trades) if (humanIds.has(t.userId)) tradesByUser.set(t.userId, (tradesByUser.get(t.userId) ?? 0) + 1);
  const markets = Object.values(ctx.state.markets);
  const jobs = Object.entries(ctx.state.jobs ?? {});
  const providers = Object.entries(ctx.state.providers ?? {});
  return {
    usersToday: activeUsers(ctx, 1, now),
    signupsToday: users.filter((u) => dayKey(u.createdAt) === today).length,
    activeTraders: new Set(todayTrades.map((t) => t.userId)).size,
    firstTradesToday: [...firstTradeByUser.values()].filter((t) => dayKey(t) === today).length,
    repeatTraders: [...tradesByUser.values()].filter((n) => n >= 2).length,
    tradesToday: todayTrades.length,
    volumeToday: todayTrades.reduce((s, t) => s + t.credits, 0),
    marketsLive: markets.filter((m) => m.status === "OPEN" || m.status === "PAUSED").length,
    marketsPaused: markets.filter((m) => m.status === "PAUSED").length,
    marketsSettling: markets.filter((m) => m.status === "SETTLING").length,
    settlementsAwaitingReview: markets.filter((m) => m.status === "SETTLING" && m.proposedSettlement).length,
    submissionsAwaitingReview: markets.filter((m) => m.status === "DRAFT").length,
    failedJobs: jobs.filter(([, j]) => j.lastErrorAt && now - j.lastErrorAt < DAY).map(([name, j]) => ({ name, error: j.lastError, at: j.lastErrorAt })),
    failedMetrics: providers.filter(([, p]) => p.consecutiveFailures > 0).map(([name, p]) => ({ name, consecutiveFailures: p.consecutiveFailures, error: p.lastError })),
    openSupportTickets: Object.values(ctx.state.supportTickets ?? {}).filter((t) => t.status !== "resolved").length,
    suspiciousUsers: users.filter((u) => (u.riskScore ?? 0) >= 0.5 || u.status === "frozen").length,
    openRiskFlags: ctx.state.riskFlags.filter((f) => (f.status ?? "open") === "open").length,
    retentionD1: retention(ctx, 1, now),
    retentionD7: retention(ctx, 7, now),
    creatorShares: ctx.state.events.filter((e) => (e.name === "share_clicked" || e.name === "market_shared") && dayKey(e.createdAt) === today).length,
    unacknowledgedAlerts: (ctx.state.alerts ?? []).filter((a) => !a.acknowledgedAt).length,
  };
}

// ---- Model analytics (§19 backtesting on live data, §41) ----

type Obs = { probs: number[]; naive: number[]; actual: number; ageMin: number; momentum: number; followers: number | null; spike: boolean; version: string };

function brier(obs: { probs: number[]; actual: number }[]) {
  if (!obs.length) return null;
  return obs.reduce((s, o) => s + o.probs.reduce((a, p, i) => a + (p - (i === o.actual ? 1 : 0)) ** 2, 0), 0) / obs.length;
}
function logloss(obs: { probs: number[]; actual: number }[]) {
  if (!obs.length) return null;
  return obs.reduce((s, o) => s - Math.log(Math.max(1e-6, o.probs[o.actual])), 0) / obs.length;
}
function bucketAccuracy(obs: { probs: number[]; actual: number }[]) {
  if (!obs.length) return null;
  return obs.filter((o) => o.probs.indexOf(Math.max(...o.probs)) === o.actual).length / obs.length;
}

export function modelAnalytics(ctx: Ctx) {
  const obs: Obs[] = [];
  const settledAt: { at: number; brier: number }[] = [];
  for (const m of Object.values(ctx.state.markets)) {
    if (m.status !== "SETTLED" || m.finalMetric === null) continue;
    const outcomes = ctx.state.outcomes[m.id];
    const ranges = rangesOf(outcomes);
    const actual = winningRangeIndex(ranges, m.finalMetric);
    const video = ctx.state.videos[m.videoId];
    const snaps = (ctx.state.snapshots[m.videoId] ?? []).filter((s) => !s.suspicious);
    // One observation per market per hour of its life, so long markets don't dominate.
    const seen = new Set<number>();
    for (const f of ctx.state.forecasts?.[m.id] ?? []) {
      const hour = Math.floor((f.at - m.openedAt) / 3_600_000);
      if (hour < 0 || hour > 23 || seen.has(hour) || f.probabilities.length !== outcomes.length) continue;
      seen.add(hour);
      const hourAgo = snaps.filter((s) => s.capturedAt <= f.at && s.capturedAt >= f.at - 3_600_000);
      const likesNow = hourAgo.at(-1)?.likes ?? 0;
      const v1h = hourAgo.length > 1 ? (likesNow - hourAgo[0].likes) / Math.max(1, (hourAgo.at(-1)!.capturedAt - hourAgo[0].capturedAt) / 60_000) : 0;
      obs.push({
        probs: f.probabilities,
        naive: naiveLinearForecast({ currentLikes: likesNow, now: f.at, settlesAt: m.settlesAt, velocity1h: v1h, ranges }),
        actual,
        ageMin: f.videoAgeMin,
        momentum: f.momentum,
        followers: video?.creatorFollowers ?? null,
        spike: f.capped || f.momentum >= 0.6,
        version: f.modelVersion,
      });
    }
    const mine = obs.filter((o, i) => i >= obs.length - seen.size);
    const b = brier(mine);
    if (b !== null) settledAt.push({ at: m.settlesAt, brier: b });
  }
  const summarize = (xs: Obs[]) => ({ n: xs.length, brier: brier(xs), logloss: logloss(xs), accuracy: bucketAccuracy(xs) });
  const bins = Array.from({ length: 10 }, (_, i) => ({ bin: `${i * 10}–${(i + 1) * 10}%`, n: 0, predicted: 0, actual: 0 }));
  for (const o of obs) {
    o.probs.forEach((p, i) => {
      const b = bins[Math.min(9, Math.floor(p * 10))];
      b.n++;
      b.predicted += p;
      if (i === o.actual) b.actual++;
    });
  }
  const group = <K extends string>(key: (o: Obs) => K) => {
    const out: Record<string, ReturnType<typeof summarize>> = {};
    const buckets = new Map<string, Obs[]>();
    for (const o of obs) (buckets.get(key(o)) ?? buckets.set(key(o), []).get(key(o))!).push(o);
    for (const [k, v] of buckets) out[k] = summarize(v);
    return out;
  };
  // Drift: Brier of markets settled in each of the last 4 weeks.
  const now = ctx.now();
  const drift = [3, 2, 1, 0].map((w) => {
    const xs = settledAt.filter((s) => s.at >= now - (w + 1) * 7 * DAY && s.at < now - w * 7 * DAY);
    return { weeksAgo: w, markets: xs.length, brier: xs.length ? xs.reduce((s, x) => s + x.brier, 0) / xs.length : null };
  });
  const recentInvalid = (ctx.state.alerts ?? []).filter((a) => a.message.startsWith("Model produced an invalid")).length;
  return {
    overall: summarize(obs),
    naiveBaseline: summarize(obs.map((o) => ({ ...o, probs: o.naive }))),
    calibration: bins.map((b) => ({ bin: b.bin, n: b.n, predicted: b.n ? b.predicted / b.n : null, actual: b.n ? b.actual / b.n : null })),
    byVideoAge: group((o) => (o.ageMin < 120 ? "< 2h" : o.ageMin < 360 ? "2–6h" : o.ageMin < 720 ? "6–12h" : "12h+")),
    byCreatorSize: group((o) => (o.followers === null ? "unknown" : o.followers < 50_000 ? "< 50K followers" : o.followers < 500_000 ? "50K–500K" : "500K+")),
    byMomentum: group((o) => (o.momentum < 0.4 ? "cooling/stable" : o.momentum < 0.6 ? "rising" : "surging+")),
    duringSpikes: summarize(obs.filter((o) => o.spike)),
    byVersion: group((o) => o.version as string),
    drift,
    dataQualityAlerts: recentInvalid + ctx.state.riskFlags.filter((f) => f.entityType === "market" && /metric|like/i.test(f.reason) && (f.status ?? "open") === "open").length,
    liveMarkets: Object.values(ctx.state.markets).filter((m) => !isFinal(m.status)).length,
  };
}
