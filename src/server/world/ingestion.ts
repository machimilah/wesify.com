import { MAX_VIDEO_AGE_AT_CREATION_MS, SNAPSHOT_INTERVAL_MS } from "@/lib/shared/constants";
import { mulberry32 } from "@/lib/shared/random";
import type { MetricSnapshot, VideoRow } from "@/lib/shared/types";
import { SCENARIO_NAMES, simulatedLikes } from "@/lib/simulation/trajectories";
import {
  VideoResolveError,
  fetchTikTokOEmbed,
  ingestionProvider,
  parseVideoUrl,
  resolveShortLink,
  seedFromVideoId,
  type VideoMetadata,
} from "@/lib/social-providers";
import { audit, track, type Ctx } from "./context";
import { Errors } from "./errors";
import { flagEnabled } from "./flags";
import { isFinal } from "./lifecycle";
import { approveDraft, cancelMarket, createMarket, getMarket, recordSnapshot } from "./markets";
import { simulatedCreatorBaseline } from "./seed";

const THUMBNAIL_TTL_MS = 6 * 3_600_000;

function mapResolveError(err: unknown): never {
  if (err instanceof VideoResolveError) {
    if (err.kind === "invalid") throw Errors.invalidUrl();
    if (err.kind === "unsupported") throw Errors.unsupportedPlatform(err.platformName);
    if (err.kind === "private") throw Errors.videoPrivate();
    if (err.kind === "deleted") throw Errors.videoDeleted();
    throw Errors.videoUnavailable();
  }
  throw err;
}

/** Validates, normalizes and identifies a pasted link (§14). Follows TikTok short links. */
export async function parseLink(url: string): Promise<VideoMetadata> {
  try {
    return parseVideoUrl(url);
  } catch (err) {
    if (err instanceof VideoResolveError && err.kind === "shortlink") {
      try {
        return parseVideoUrl(await resolveShortLink(url));
      } catch (inner) {
        mapResolveError(inner);
      }
    }
    mapResolveError(err);
  }
}

export async function resolveVideo(ctx: Ctx, url: string) {
  const meta = await parseLink(url);
  try {
    await ingestionProvider().resolveVideo(meta.canonicalUrl);
  } catch (err) {
    mapResolveError(err);
  }
  const videoId = ctx.state.videoKeys[`${meta.platform}:${meta.platformVideoId}`];
  const existing = videoId ? Object.values(ctx.state.markets).find((m) => m.videoId === videoId) : undefined;
  const now = ctx.now();
  return {
    meta,
    existingMarketId: existing && !existing.hidden ? existing.id : null,
    existingStatus: existing?.status ?? null,
    eligible: meta.publishedAt !== null && now - meta.publishedAt < MAX_VIDEO_AGE_AT_CREATION_MS && meta.publishedAt <= now,
  };
}

/** Deterministic simulated trajectory for a pasted link until real metrics exist (§16 mock provider). */
function simulatedVideo(meta: VideoMetadata, publishedAt: number, now: number) {
  const seed = seedFromVideoId(meta.platformVideoId);
  const rnd = mulberry32(seed);
  const scenario = SCENARIO_NAMES[Math.floor(rnd() * SCENARIO_NAMES.length)];
  const scale = 0.5 + rnd() * 1.2;
  return { seed, scenario, scale, thumbnailHue: 205 + Math.floor(rnd() * 80), baseline: simulatedCreatorBaseline(seed, scale), params: { scenario, seed, scale, openedAt: now, publishedAt } };
}

function historyFor(video: Pick<VideoRow, "scenario" | "seed" | "scale" | "publishedAt">, openedAt: number, until: number): MetricSnapshot[] {
  if (!video.scenario) return [];
  const params = { scenario: video.scenario, seed: video.seed, scale: video.scale, openedAt, publishedAt: video.publishedAt };
  const history: MetricSnapshot[] = [];
  for (let t = video.publishedAt + SNAPSHOT_INTERVAL_MS; t < until; t += SNAPSHOT_INTERVAL_MS) history.push({ capturedAt: t, likes: simulatedLikes(params, t) });
  history.push({ capturedAt: until, likes: simulatedLikes(params, until) });
  return history;
}

/**
 * Path A (paste link) / Path B (share target). Opens the existing market when there is one;
 * otherwise creates a submission request. With `marketApproval` on (the default in the main world),
 * the submission waits as a DRAFT for an admin; demo worlds open it immediately.
 */
export async function createMarketFromUrl(ctx: Ctx, url: string, actor: string | null, source: "paste" | "share" = "paste") {
  const { meta, existingMarketId, eligible } = await resolveVideo(ctx, url);
  if (existingMarketId) {
    track(ctx, "video_submitted", actor, { platform: meta.platform, source, duplicate: true, market_id: existingMarketId });
    return { marketId: existingMarketId, created: false, status: ctx.state.markets[existingMarketId].status };
  }
  if (!flagEnabled(ctx, "marketCreation")) throw Errors.marketCreationDisabled();
  if (meta.publishedAt === null) throw Errors.videoUnavailable();
  if (!eligible) throw Errors.videoTooOld();

  // Platform-permitted metadata (§17). "gone" means TikTok itself says the video is private or deleted.
  const oembed = meta.platform === "tiktok" ? await fetchTikTokOEmbed(meta.canonicalUrl) : null;
  if (oembed === "gone") throw Errors.videoPrivate();

  const now = ctx.now();
  const sim = simulatedVideo(meta, meta.publishedAt, now);
  const needsReview = ctx.state.kind === "main" && flagEnabled(ctx, "marketApproval");
  const video = {
    platform: meta.platform,
    platformVideoId: meta.platformVideoId,
    canonicalUrl: meta.canonicalUrl,
    creatorHandle: meta.creatorHandle,
    publishedAt: meta.publishedAt,
    caption: oembed?.title?.slice(0, 300) ?? "",
    thumbnailHue: sim.thumbnailHue,
    provider: "mock" as const,
    scenario: sim.scenario,
    seed: sim.seed,
    scale: sim.scale,
    thumbnailUrl: oembed?.thumbnailUrl ?? null,
    thumbnailSource: oembed?.thumbnailUrl ? "tiktok-oembed" : null,
    thumbnailFetchedAt: oembed?.thumbnailUrl ? now : null,
    thumbnailExpiresAt: oembed?.thumbnailUrl ? now + THUMBNAIL_TTL_MS : null,
    authorName: oembed?.authorName ?? null,
  };
  const { market, created } = createMarket(ctx, {
    video,
    openedAt: now,
    initialHistory: historyFor({ ...video }, now, now),
    actor,
    source,
    baseline: sim.baseline,
    status: needsReview ? "DRAFT" : "OPEN",
  });
  audit(ctx, { actor, action: needsReview ? "market.submit" : "market.open_from_link", entityType: "market", entityId: market.id, metadata: { source, url: meta.canonicalUrl } });
  track(ctx, "video_submitted", actor, { market_id: market.id, platform: meta.platform, source, needs_review: needsReview });
  return { marketId: market.id, created, status: market.status };
}

/** Admin approval of a submission: backfills likes to now and opens the 24-hour window. */
export function approveSubmission(ctx: Ctx, marketId: string, opts: { actor: string; note?: string | null; force?: boolean }) {
  const { market, video } = getMarket(ctx, marketId);
  if (market.status !== "DRAFT") throw Errors.invalid("Only markets waiting for review can be approved.");
  const now = ctx.now();
  if (!opts.force && now - video.publishedAt >= MAX_VIDEO_AGE_AT_CREATION_MS) throw Errors.videoTooOld();
  const history = video.provider === "mock" ? historyFor(video, now, now) : (ctx.state.snapshots[video.id] ?? []).map((s) => ({ capturedAt: s.capturedAt, likes: s.likes }));
  video.createdAt = now; // simulated trajectories are anchored to the opening time
  return approveDraft(ctx, marketId, { actor: opts.actor, note: opts.note, history, force: opts.force });
}

/** Admin-managed market whose metrics are entered by hand (§26 manual provider, §14 admin override). */
export async function createManualMarket(
  ctx: Ctx,
  input: { url: string; initialLikes: number; ageMinutes?: number; actor: string; followers?: number; avgLikes?: number },
) {
  const { meta, existingMarketId } = await resolveVideo(ctx, input.url);
  if (existingMarketId) return { marketId: existingMarketId, created: false };
  const now = ctx.now();
  const publishedAt = input.ageMinutes !== undefined ? now - input.ageMinutes * 60_000 : meta.publishedAt;
  if (publishedAt === null) throw Errors.invalid("Provide the video's age in minutes.");
  if (!Number.isInteger(input.initialLikes) || input.initialLikes < 0) throw Errors.invalid("Initial likes must be a whole number.");

  const { market, created } = createMarket(ctx, {
    video: { ...meta, publishedAt, caption: "", thumbnailHue: 240, provider: "manual", scenario: null, seed: 0, scale: 1 },
    openedAt: now,
    initialHistory: [
      { capturedAt: publishedAt, likes: 0 },
      { capturedAt: now, likes: input.initialLikes },
    ],
    actor: input.actor,
    source: "admin",
    baseline: { followers: input.followers ?? null, avgLikes: input.avgLikes ?? null },
    skipEligibility: true,
  });
  return { marketId: market.id, created };
}

export function setManualLikes(ctx: Ctx, input: { marketId: string; likes: number; actor: string }) {
  const { market } = getMarket(ctx, input.marketId);
  if (!Number.isInteger(input.likes) || input.likes < 0) throw Errors.invalid("Likes must be a whole number.");
  if (market.status !== "OPEN" && market.status !== "PAUSED" && market.status !== "LOCKED") throw Errors.invalid("Market is not active.");
  const before = market.currentLikes;
  const recorded = recordSnapshot(ctx, input.marketId, { likes: input.likes, capturedAt: ctx.now(), source: "manual" });
  if (!recorded) throw Errors.invalid("A snapshot already exists for this moment.");
  audit(ctx, { actor: input.actor, action: "metric.set_current_likes", entityType: "market", entityId: input.marketId, metadata: { before, after: input.likes } });
}

/**
 * Content takedown (§17, §33): hides the video everywhere, drops its thumbnail link, and cancels a
 * live market with refunds. The video row stays (anonymized content) so settled history is intact.
 */
export function takedownVideo(ctx: Ctx, input: { marketId: string; reason: string; actor: string }) {
  const { market, video } = getMarket(ctx, input.marketId);
  video.thumbnailUrl = null;
  video.thumbnailSource = null;
  video.caption = "";
  video.takenDownAt = ctx.now();
  market.hidden = true;
  if (!isFinal(market.status)) cancelMarket(ctx, market.id, { reason: input.reason, actor: input.actor, code: "CONTENT_REMOVED" });
  audit(ctx, { actor: input.actor, action: "video.takedown", entityType: "video", entityId: video.id, metadata: { marketId: market.id, reason: input.reason } });
}

/** Staging tool (§53): make a simulated video look deleted, private or available again. */
export function setSimulatedAvailability(ctx: Ctx, input: { marketId: string; availability: "available" | "deleted" | "private"; actor: string }) {
  const { video } = getMarket(ctx, input.marketId);
  if (video.provider !== "mock") throw Errors.invalid("Only simulated videos can be changed this way.");
  video.simulatedAvailability = input.availability;
  audit(ctx, { actor: input.actor, action: "video.simulate_availability", entityType: "video", entityId: video.id, metadata: { availability: input.availability } });
}

/**
 * Thumbnail URLs from platforms expire (§17). Refresh the ones about to expire for live markets;
 * a failed refresh marks the thumbnail broken so the UI shows the placeholder instead.
 */
export async function refreshThumbnails(ctx: Ctx, force?: string) {
  const now = ctx.now();
  let refreshed = 0;
  for (const m of Object.values(ctx.state.markets)) {
    if (isFinal(m.status) && m.id !== force) continue;
    const v = ctx.state.videos[m.videoId];
    if (!v || v.takenDownAt || v.platform !== "tiktok") continue;
    if (m.id !== force && (!v.thumbnailExpiresAt || v.thumbnailExpiresAt > now + 30 * 60_000)) continue;
    const o = await fetchTikTokOEmbed(v.canonicalUrl);
    if (o === null) continue;
    if (o === "gone" || !o.thumbnailUrl) {
      v.thumbnailBroken = true;
      v.thumbnailUrl = null;
      continue;
    }
    v.thumbnailUrl = o.thumbnailUrl;
    v.thumbnailSource = "tiktok-oembed";
    v.thumbnailFetchedAt = now;
    v.thumbnailExpiresAt = now + THUMBNAIL_TTL_MS;
    v.thumbnailBroken = false;
    refreshed++;
  }
  return refreshed;
}
