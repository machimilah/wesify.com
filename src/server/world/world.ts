import { METRIC_STALE_AFTER_MS, MIN_ACTIVE_MARKETS, SNAPSHOT_INTERVAL_MS, IDEMPOTENCY_TTL_MS } from "@/lib/shared/constants";
import { SETTLEMENT_METRIC_DEADLINE_HOURS, UNAVAILABLE_GRACE_HOURS } from "@/lib/shared/rules";
import { SCENARIO_NAMES } from "@/lib/simulation/trajectories";
import { ProviderUnavailableError, VideoGoneError, providerFor, type VideoMetrics } from "@/lib/social-providers";
import type { MarketRow, VideoRow } from "@/lib/shared/types";
import { captureError, raiseAlert, recordProviderCall, runJob, worldNow, type Ctx } from "./context";
import { maybeBotTrade } from "./bots";
import { flagEnabled } from "./flags";
import { checkIntegrity } from "./integrity";
import { isFinal, transition } from "./lifecycle";
import {
  METRICS_DELAYED,
  cancelMarket,
  getMarket,
  lockMarket,
  notifyClosingSoon,
  proposeSettlement,
  recordSnapshot,
} from "./markets";
import { createSimulatedMarket, nextSeed, pickFreshHandle } from "./seed";
import type { WorldState } from "./state";
import { creatorAccountFor, creatorMetrics, isSyncDue, syncAccount } from "./creators";
import { refreshThumbnails } from "./ingestion";

const HOUR = 3_600_000;
const MAX_CREATOR_SYNCS_PER_TICK = 10;
/** High-momentum markets are sampled twice as often (§18 faster interval when needed). */
const HOT_INTERVAL_MS = SNAPSHOT_INTERVAL_MS / 2;
const UNAVAILABLE_PREFIX = "The video is no longer available";

export type WorldOptions = {
  realNow?: () => number;
  onChange?: () => void;
  /** Keep at least this many OPEN markets by creating simulated ones (main world). */
  minActiveMarkets?: number;
  bots?: boolean;
  botChance?: number;
  /** Poll connected creator accounts during ticks (main world only). */
  creators?: boolean;
  /** Settlements wait for a reviewer when the `settlementReview` flag is on (main world). */
  reviewSettlements?: boolean;
  /** Called at most hourly from a tick with real time (backups, main world). */
  onHourly?: (world: World) => void;
};

/**
 * A world owns one consistent state (main or a demo sandbox). All mutations are synchronous
 * functions over the state, so each one is atomic with respect to other requests; `tick` is
 * serialized with a promise mutex because providers are async.
 */
export class World {
  private ticking: Promise<void> | null = null;
  readonly realNow: () => number;
  lastTickAt = 0;

  constructor(
    public state: WorldState,
    private readonly opts: WorldOptions = {},
  ) {
    this.realNow = opts.realNow ?? Date.now;
  }

  now = () => worldNow(this.state, this.realNow());

  get ctx(): Ctx {
    return { state: this.state, now: this.now };
  }

  /** Runs a synchronous mutation and schedules persistence. */
  mutate<T>(fn: (ctx: Ctx) => T): T {
    try {
      return fn(this.ctx);
    } finally {
      this.opts.onChange?.();
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = this.advance().finally(() => {
      this.ticking = null;
      this.lastTickAt = this.realNow();
      this.opts.onChange?.();
    });
    return this.ticking;
  }

  private async advance() {
    const now = this.now();
    for (const market of Object.values(this.state.markets)) {
      if (isFinal(market.status) || market.status === "DRAFT") continue;
      try {
        await this.advanceMarket(market.id, now);
      } catch (err) {
        captureError(this.ctx, "job", err, { job: "advance-market", marketId: market.id });
      }
    }
    if (this.opts.creators) await runJob(this.ctx, "creator-sync", () => this.syncCreators(now));
    this.topUpMarkets(now);
    const real = this.realNow();
    if (real - this.lastHourlyAt > HOUR) {
      this.lastHourlyAt = real;
      await runJob(this.ctx, "prune", () => this.prune(now));
      if (this.state.kind === "main") {
        await runJob(this.ctx, "integrity", () => {
          const report = checkIntegrity(this.state);
          if (!report.ok) raiseAlert(this.ctx, "critical", `Integrity check found ${report.issues.length} issue(s)`, { first: report.issues.slice(0, 5) });
          return report.ok;
        });
        await runJob(this.ctx, "thumbnails", () => refreshThumbnails(this.ctx));
        this.opts.onHourly?.(this);
      }
    }
  }

  private lastHourlyAt = 0;

  /**
   * Polls connected creator accounts that are due (every 5 minutes each). Requests trigger ticks,
   * so this is capped per tick; production also calls /api/internal/cron so accounts keep syncing
   * when nobody is browsing.
   */
  private async syncCreators(now: number) {
    const due = this.state.socialAccounts.filter((a) => isSyncDue(a, now)).slice(0, MAX_CREATOR_SYNCS_PER_TICK);
    for (const account of due) await syncAccount(this.ctx, account.id);
  }

  /** Retention (§18): thins finished markets to hourly points; drops expired operational rows. */
  private prune(now: number) {
    const s = this.state;
    for (const market of Object.values(s.markets)) {
      if (!isFinal(market.status) || market.settlesAt > now - 24 * HOUR) continue;
      const flags = (s.marketFlags[market.id] ??= {});
      if (flags.pruned) continue;
      flags.pruned = true;
      const snaps = s.snapshots[market.videoId] ?? [];
      s.snapshots[market.videoId] = snaps.filter((snap, i) => i === snaps.length - 1 || i % 12 === 0 || snap.suspicious);
      s.priceHistory[market.id] = thinHourly(s.priceHistory[market.id] ?? [], (h) => h.recordedAt);
      if (s.forecasts?.[market.id]) s.forecasts[market.id] = thinHourly(s.forecasts[market.id], (f) => f.at);
    }
    const real = this.realNow();
    for (const [k, v] of Object.entries(s.idempotency ?? {})) if (real - v.createdAt > IDEMPOTENCY_TTL_MS) delete s.idempotency[k];
    for (const [k, t] of Object.entries(s.emailTokens ?? {})) if (t.expiresAt < real - 7 * 24 * HOUR) delete s.emailTokens[k];
    for (const [k, sess] of Object.entries(s.sessions)) if (sess.expiresAt && sess.expiresAt < real) delete s.sessions[k];
    s.signups = (s.signups ?? []).filter((x) => real - x.at < 24 * HOUR);
    for (const [k, v] of Object.entries(s.visits ?? {})) if (now - v.lastAt > 30 * 24 * HOUR) delete s.visits[k];
    const eventCutoff = now - 180 * 24 * HOUR;
    if (s.events.length && s.events[0].createdAt < eventCutoff) s.events = s.events.filter((e) => e.createdAt >= eventCutoff);
  }

  private settlementReviewRequired() {
    return Boolean(this.opts.reviewSettlements) && flagEnabled(this.ctx, "settlementReview");
  }

  private async fetchMetrics(video: VideoRow, t: number): Promise<VideoMetrics> {
    if (!flagEnabled(this.ctx, "providers")) throw new ProviderUnavailableError("Providers switched off");
    const provider = video.provider === "creator" ? `creator-${creatorAccountFor(this.ctx, video)?.mode ?? "missing"}` : video.provider;
    try {
      const m = video.provider === "creator" ? await creatorMetrics(this.ctx, video, t) : await providerFor(video).getMetrics(video, t);
      recordProviderCall(this.ctx, provider, true);
      return m;
    } catch (err) {
      if (err instanceof ProviderUnavailableError) recordProviderCall(this.ctx, provider, false, err.message);
      throw err;
    }
  }

  private async advanceMarket(marketId: string, now: number) {
    const { market, video } = getMarket(this.ctx, marketId);
    const at = (t: number): Ctx => ({ state: this.state, now: () => t });
    // Creator markets read likes from the creator's account. Simulated accounts can be sampled at
    // past times like mock markets; live accounts only report "now", so they take one sample per
    // due interval instead of backfilling.
    const creatorAccount = video.provider === "creator" ? creatorAccountFor(this.ctx, video) : undefined;
    const liveCreator = video.provider === "creator" && creatorAccount?.mode === "live";

    // Every provider except manual entry is polled; which one serves a video is the registry's call.
    if (video.provider !== "manual" && market.status !== "SETTLING") {
      const until = Math.min(now, market.settlesAt);
      for (;;) {
        const step = market.momentumScore >= 0.6 ? HOT_INTERVAL_MS : SNAPSHOT_INTERVAL_MS;
        const due = market.lastPricedAt + step;
        // Regular steps, plus one final partial step landing exactly on settlement.
        let t = due <= until ? due : until === market.settlesAt && market.lastPricedAt < until ? until : null;
        if (t === null) break;
        if (liveCreator) t = until;
        try {
          const metrics = await this.fetchMetrics(video, t);
          if (!recordSnapshot(at(t), marketId, { ...metrics, capturedAt: t })) market.lastPricedAt = t;
          this.markAvailable(market);
        } catch (err) {
          if (err instanceof VideoGoneError) {
            this.markUnavailable(market, err.reason, t);
            if (isFinal(market.status)) return;
            market.lastPricedAt = t; // keep time moving so the grace period can expire
          } else if (err instanceof ProviderUnavailableError) {
            if (market.status === "OPEN") transition(this.ctx, market, "PAUSED", { actor: "system", reason: METRICS_DELAYED });
            break;
          } else throw err;
        }
        if (this.opts.bots !== false && market.status === "OPEN" && t < market.locksAt && now - t < 6 * HOUR) {
          maybeBotTrade(at(t), marketId, Math.random, this.opts.botChance ?? 0.3);
        }
        if (t >= market.settlesAt || liveCreator) break;
      }
    }

    // Freshness (§16): an open market whose newest reading is too old stops trading.
    if (market.status === "OPEN" && video.provider !== "manual" && now < market.locksAt && now - market.lastPricedAt > METRIC_STALE_AFTER_MS) {
      transition(this.ctx, market, "PAUSED", { actor: "system", reason: METRICS_DELAYED });
    }

    if (market.status === "OPEN" && now >= market.settlesAt - 30 * 60_000) notifyClosingSoon(this.ctx, marketId);
    if ((market.status === "OPEN" || market.status === "PAUSED") && now >= market.locksAt) lockMarket(at(market.locksAt), marketId, "system");

    if ((market.status === "LOCKED" || market.status === "SETTLING") && now >= market.settlesAt && !this.state.settlements[marketId]) {
      await this.settle(market, video, now);
    }
  }

  /** Settlement engine (§25): fetch the final metric (retrying on later ticks), then propose. */
  private async settle(market: MarketRow, video: VideoRow, now: number) {
    if (market.proposedSettlement) return; // waiting for a reviewer
    if (market.status === "LOCKED") transition(this.ctx, market, "SETTLING", { actor: "system", reason: "settlement time reached" });
    const deadline = market.settlesAt + SETTLEMENT_METRIC_DEADLINE_HOURS * HOUR;
    if (video.provider === "manual") {
      market.pausedReason = "Awaiting final metric";
      if (now > deadline) cancelMarket(this.ctx, market.id, { reason: "no final metric entered", actor: "system", code: "PLATFORM_OUTAGE" });
      return;
    }
    if (market.unavailableSince) {
      if (now - market.unavailableSince >= UNAVAILABLE_GRACE_HOURS * HOUR) this.cancelUnavailable(market);
      return;
    }
    market.settlementAttempts = (market.settlementAttempts ?? 0) + 1;
    try {
      // Live creator accounts report likes at fetch time, which can be up to one tick after settlesAt.
      const final = await this.fetchMetrics(video, market.settlesAt);
      proposeSettlement({ state: this.state, now: this.now }, market.id, { likes: final.likes, source: final.source, capturedAt: final.capturedAt }, {
        actor: "system",
        requireReview: this.settlementReviewRequired(),
      });
    } catch (err) {
      if (err instanceof VideoGoneError) {
        this.markUnavailable(market, err.reason, now);
        return;
      }
      if (!(err instanceof ProviderUnavailableError)) throw err;
      market.pausedReason = "Waiting for the final like count";
      if (now > deadline) {
        cancelMarket(this.ctx, market.id, { reason: `final metric unavailable after ${market.settlementAttempts} attempts`, actor: "system", code: "PLATFORM_OUTAGE" });
      }
    }
  }

  private markUnavailable(market: MarketRow, reason: "deleted" | "private", t: number) {
    market.unavailableSince ??= t;
    market.unavailableReason = reason;
    const text = `${UNAVAILABLE_PREFIX} (${reason}).`;
    if (market.status === "OPEN") transition(this.ctx, market, "PAUSED", { actor: "system", reason: text });
    else if (market.status === "PAUSED") market.pausedReason = text;
    if (t - market.unavailableSince >= UNAVAILABLE_GRACE_HOURS * HOUR) this.cancelUnavailable(market);
  }

  private cancelUnavailable(market: MarketRow) {
    cancelMarket(this.ctx, market.id, {
      reason: `video ${market.unavailableReason ?? "unavailable"} for over ${UNAVAILABLE_GRACE_HOURS}h`,
      actor: "system",
      code: market.unavailableReason === "private" ? "PRIVATE_CONTENT" : "DELETED_CONTENT",
    });
  }

  /** Data is flowing again: lift pauses the system itself placed (never an admin's pause). */
  private markAvailable(market: MarketRow) {
    market.unavailableSince = null;
    market.unavailableReason = null;
    if (market.status === "PAUSED" && (market.pausedReason === METRICS_DELAYED || market.pausedReason?.startsWith(UNAVAILABLE_PREFIX))) {
      transition(this.ctx, market, this.now() >= market.locksAt ? "LOCKED" : "OPEN", { actor: "system", reason: "metrics recovered" });
    }
  }

  private topUpMarkets(now: number) {
    const target = this.opts.minActiveMarkets ?? 0;
    if (target <= 0) return;
    const open = Object.values(this.state.markets).filter((m) => m.status === "OPEN").length;
    for (let i = open; i < target; i++) {
      const scenario = SCENARIO_NAMES[Math.floor(Math.random() * SCENARIO_NAMES.length)];
      createSimulatedMarket(this.ctx, { scenario, openedAt: now - Math.random() * 10 * 60_000, seed: nextSeed(), handle: pickFreshHandle(this.ctx) });
    }
  }
}

function thinHourly<T>(rows: T[], time: (r: T) => number): T[] {
  let lastKept = -Infinity;
  const lastTime = rows.length ? time(rows[rows.length - 1]) : undefined;
  return rows.filter((r) => {
    const t = time(r);
    if (t === lastTime || t === lastKept) return true;
    if (t - lastKept >= HOUR) {
      lastKept = t;
      return true;
    }
    return false;
  });
}

export const MAIN_WORLD_DEFAULTS: WorldOptions = { minActiveMarkets: MIN_ACTIVE_MARKETS, bots: true, creators: true, reviewSettlements: true };
