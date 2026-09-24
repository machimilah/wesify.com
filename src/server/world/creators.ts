import { randomBytes } from "node:crypto";
import {
  CREATOR_LIKE_RATIO,
  CREATOR_LOOKBACK_MS,
  CREATOR_MARKETS_PER_WINDOW,
  CREATOR_MIN_FOLLOWERS,
  CREATOR_MIN_LIKES,
  CREATOR_SYNC_INTERVAL_MS,
  CREATOR_WINDOW_MS,
  MAX_VIDEO_AGE_AT_CREATION_MS,
  creatorLikeThreshold,
} from "@/lib/shared/constants";
import { compactNumber, duration } from "@/lib/shared/format";
import { hashString, newId } from "@/lib/shared/random";
import type { CreatorOverviewDTO } from "@/lib/shared/dto";
import type { CreatorVideoRow, MetricSnapshot, SocialAccountRow, VideoRow } from "@/lib/shared/types";
import { ProviderUnavailableError, type VideoMetrics } from "@/lib/social-providers";
import { decryptToken, encryptToken } from "../crypto";
import {
  CREATOR_PLATFORMS,
  CreatorApiError,
  liveConnector,
  simulatedCreatorLikes,
  simulatedProfile,
  simulatedUploads,
  simulatedVideoParams,
  type CreatorPlatform,
  type RemoteVideo,
  type TokenSet,
} from "../creator/providers";
import { audit, notify, track, type Ctx } from "./context";
import { assertActiveCreator, programDTO, programState } from "./creatorProgram";
import { Errors, WesifyError } from "./errors";
import { createMarket } from "./markets";
import { isLive } from "./lifecycle";

const OAUTH_STATE_TTL_MS = 10 * 60_000;
const LIKE_HISTORY_CAP = 150;

export const activeAccounts = (ctx: Ctx, userId: string) =>
  ctx.state.socialAccounts.filter((a) => a.userId === userId && a.status !== "revoked" && a.mode);

// ---------------------------------------------------------------------------
// Daily limit (rolling window, per Wesify user, across all connected accounts)
// ---------------------------------------------------------------------------

export function creatorLimit(ctx: Ctx, userId: string) {
  const now = ctx.now();
  const recent = Object.values(ctx.state.markets)
    .filter((m) => m.creatorUserId === userId && m.createdAt > now - CREATOR_WINDOW_MS)
    .sort((a, b) => a.createdAt - b.createdAt);
  const remaining = Math.max(0, CREATOR_MARKETS_PER_WINDOW - recent.length);
  return {
    remaining,
    nextAvailableAt: remaining > 0 ? null : recent[recent.length - CREATOR_MARKETS_PER_WINDOW].createdAt + CREATOR_WINDOW_MS,
  };
}

// ---------------------------------------------------------------------------
// Connect / disconnect
// ---------------------------------------------------------------------------

/**
 * Any user can connect their accounts from their profile (§5): it proves which videos are theirs,
 * which enforces the self-trading ban (§27). Opening markets still requires the creator program.
 */
export function startConnect(ctx: Ctx, userId: string, platform: CreatorPlatform, redirectUri: string) {
  const now = ctx.now();
  for (const [key, s] of Object.entries(ctx.state.oauthStates)) {
    if (now - s.createdAt > OAUTH_STATE_TTL_MS) delete ctx.state.oauthStates[key];
  }
  if (activeAccounts(ctx, userId).some((a) => a.platform === platform)) {
    throw Errors.invalid(`Your ${platformName(platform)} account is already connected.`);
  }
  const state = randomBytes(24).toString("base64url");
  ctx.state.oauthStates[state] = { userId, platform, createdAt: now };
  const live = liveConnector(platform);
  const url = live ? live.authorizeUrl(state, redirectUri) : `${redirectUri}?state=${state}&code=simulated`;
  return { url, mode: live ? "live" : "simulated" } as const;
}

/**
 * Finishes the OAuth round trip. Network calls happen first; all state changes are then applied
 * synchronously so a half-finished connect never leaves a partial account behind.
 */
export async function completeConnect(ctx: Ctx, input: { state: string; code: string | null; redirectUri: string; wesifyUserId: string }) {
  const pending = ctx.state.oauthStates[input.state];
  delete ctx.state.oauthStates[input.state]; // single use
  if (!pending || ctx.now() - pending.createdAt > OAUTH_STATE_TTL_MS) throw Errors.invalid("That connection link expired. Try connecting again.");
  if (pending.userId !== input.wesifyUserId) throw Errors.forbidden();
  if (!input.code) throw Errors.invalid("Connection was cancelled.");

  const platform = pending.platform as CreatorPlatform;
  const user = ctx.state.users[pending.userId];
  if (!user) throw Errors.unauthorized();
  const live = liveConnector(platform);

  let tokens: TokenSet | null = null;
  let profile;
  let simSeed: number | undefined;
  if (live) {
    try {
      tokens = await live.exchangeCode(input.code, input.redirectUri);
      profile = await live.getProfile(tokens.accessToken);
    } catch (err) {
      throw Errors.invalid(err instanceof CreatorApiError ? err.message : "Could not connect the account.");
    }
    if (!profile.platformUserId) throw Errors.invalid(`${platformName(platform)} didn't return an account id.`);
  } else {
    simSeed = hashString(`${user.id}:${platform}`);
    profile = simulatedProfile(simSeed, user.username, platform);
  }

  const takenByOther = ctx.state.socialAccounts.find(
    (a) => a.platform === platform && a.platformUserId === profile.platformUserId && a.userId !== user.id && a.status !== "revoked",
  );
  if (takenByOther) throw Errors.invalid(`That ${platformName(platform)} account is already linked to another Wesify account.`);

  const now = ctx.now();
  let account = ctx.state.socialAccounts.find((a) => a.userId === user.id && a.platform === platform);
  if (!account) {
    account = { id: newId("soc"), userId: user.id, platform, platformUserId: profile.platformUserId, handle: profile.handle, createdAt: now };
    ctx.state.socialAccounts.push(account);
  }
  Object.assign(account, {
    platformUserId: profile.platformUserId,
    handle: profile.handle,
    mode: live ? "live" : "simulated",
    status: "active",
    statusMessage: null,
    followerCount: profile.followerCount,
    accessTokenEncrypted: tokens ? encryptToken(tokens.accessToken) : null,
    refreshTokenEncrypted: tokens?.refreshToken ? encryptToken(tokens.refreshToken) : null,
    expiresAt: tokens?.expiresAt ?? null,
    lastSyncedAt: null,
    simSeed,
    lastSimUploadAt: null,
  } satisfies Partial<SocialAccountRow>);
  audit(ctx, { actor: user.id, action: "creator.connect", entityType: "social_account", entityId: account.id, metadata: { platform, mode: account.mode, handle: account.handle } });
  track(ctx, "creator_connected", user.id, { platform, mode: account.mode });
  return account;
}

/**
 * Disconnects an account (§31): tokens are wiped immediately and returned once so the caller can
 * revoke them with the platform after the response. `purge` also deletes the watched-upload data.
 */
export function disconnectAccount(ctx: Ctx, userId: string, accountId: string, opts: { purge?: boolean } = {}) {
  const account = ownedAccount(ctx, userId, accountId);
  if (hasRunningMarket(ctx, account.id)) throw Errors.invalid("This account has a market that's still running. Disconnect after it settles.");
  const revoke = account.mode === "live" && account.accessTokenEncrypted ? { platform: account.platform as CreatorPlatform, token: decryptToken(account.accessTokenEncrypted) } : null;
  account.status = "revoked";
  account.accessTokenEncrypted = null;
  account.refreshTokenEncrypted = null;
  for (const cv of Object.values(ctx.state.creatorVideos)) {
    if (cv.socialAccountId === account.id && (cv.status === "tracking" || cv.status === "eligible")) cv.status = "dismissed";
  }
  if (opts.purge) {
    for (const [id, cv] of Object.entries(ctx.state.creatorVideos)) if (cv.socialAccountId === account.id && cv.status !== "market_created") delete ctx.state.creatorVideos[id];
    account.followerCount = 0;
    account.avgLikes = null;
  }
  audit(ctx, { actor: userId, action: "creator.disconnect", entityType: "social_account", entityId: account.id, metadata: { platform: account.platform, purge: Boolean(opts.purge) } });
  return revoke;
}

function ownedAccount(ctx: Ctx, userId: string, accountId: string): SocialAccountRow {
  const account = ctx.state.socialAccounts.find((a) => a.id === accountId && a.userId === userId && a.mode);
  if (!account || account.status === "revoked") throw Errors.notFound("Account");
  return account;
}

// ---------------------------------------------------------------------------
// Sync: detect uploads, refresh likes, decide eligibility
// ---------------------------------------------------------------------------

/** Returns a usable access token, refreshing (and re-encrypting) it first if it's about to expire. */
async function accessToken(account: SocialAccountRow): Promise<string> {
  const live = liveConnector(account.platform as CreatorPlatform);
  if (!live || !account.accessTokenEncrypted) throw new CreatorApiError("Account is not connected to the live API.", true);
  const tokens: TokenSet = {
    accessToken: decryptToken(account.accessTokenEncrypted),
    refreshToken: account.refreshTokenEncrypted ? decryptToken(account.refreshTokenEncrypted) : null,
    expiresAt: account.expiresAt ?? null,
  };
  if (tokens.expiresAt && tokens.expiresAt - Date.now() < 5 * 60_000) {
    const next = await live.refresh(tokens);
    account.accessTokenEncrypted = encryptToken(next.accessToken);
    if (next.refreshToken) account.refreshTokenEncrypted = encryptToken(next.refreshToken);
    account.expiresAt = next.expiresAt;
    return next.accessToken;
  }
  return tokens.accessToken;
}

export function isSyncDue(account: SocialAccountRow, now: number) {
  return account.mode !== undefined && account.status !== "revoked" && (!account.lastSyncedAt || now - account.lastSyncedAt >= CREATOR_SYNC_INTERVAL_MS);
}

export async function syncAccount(ctx: Ctx, accountId: string) {
  const account = ctx.state.socialAccounts.find((a) => a.id === accountId);
  if (!account || account.status === "revoked" || !account.mode) return;
  const now = ctx.now();
  const since = now - CREATOR_LOOKBACK_MS;
  const tracked = Object.values(ctx.state.creatorVideos).filter((cv) => cv.socialAccountId === account.id);

  let followerCount: number;
  let remote: (RemoteVideo & { sim?: ReturnType<typeof simulatedVideoParams> })[] = [];
  try {
    if (account.mode === "live") {
      const live = liveConnector(account.platform as CreatorPlatform);
      if (!live) throw new CreatorApiError(`${platformName(account.platform)} API credentials are not configured on this server.`);
      const token = await accessToken(account);
      const profile = await live.getProfile(token);
      followerCount = profile.followerCount;
      account.handle = profile.handle;
      remote = await live.listRecentVideos(token, since);
      const all = await live.listRecentVideos(token, 0);
      const older = all.filter((v) => now - v.publishedAt > 24 * 3_600_000).map((v) => v.likes);
      account.avgLikes = median(older.length ? older : all.map((v) => v.likes));
      // Videos still being watched that dropped out of the "recent" page: fetch their likes directly.
      const listed = new Set(remote.map((v) => v.platformVideoId));
      const missing = tracked.filter((cv) => (cv.status === "tracking" || cv.status === "eligible") && !listed.has(cv.platformVideoId));
      if (missing.length) {
        const likes = await live.getLikes(token, missing.map((cv) => cv.platformVideoId));
        for (const cv of missing) if (likes[cv.platformVideoId] !== undefined) remote.push({ ...cv, likes: likes[cv.platformVideoId] });
      }
    } else {
      const seed = account.simSeed ?? hashString(account.id);
      followerCount = account.followerCount ?? simulatedProfile(seed, account.handle, account.platform as CreatorPlatform).followerCount;
      account.avgLikes ??= Math.round(followerCount * (0.02 + (seed % 60) / 1000));
      const byId = new Map(tracked.map((cv) => [cv.platformVideoId, cv]));
      for (const u of simulatedUploads(seed, since, now)) {
        const id = `sim_${account.platform}_${seed}_${u.slot}`;
        const sim = byId.get(id) ? paramsOf(byId.get(id)!) : simulatedVideoParams(hashString(id), followerCount, u.publishedAt);
        remote.push({ platformVideoId: id, canonicalUrl: simUrl(account, id), caption: SIM_CAPTIONS[u.slot % SIM_CAPTIONS.length], publishedAt: u.publishedAt, likes: simulatedCreatorLikes(sim, now), sim });
      }
      // Uploads added with "Simulate a new upload" aren't on the schedule; keep refreshing them.
      for (const cv of tracked) {
        if (cv.scenario && !remote.some((r) => r.platformVideoId === cv.platformVideoId) && now - cv.publishedAt < CREATOR_LOOKBACK_MS) {
          remote.push({ ...cv, likes: simulatedCreatorLikes(paramsOf(cv), now), sim: paramsOf(cv) });
        }
      }
    }
  } catch (err) {
    const message = err instanceof CreatorApiError ? err.message : "Sync failed.";
    account.status = "error";
    account.statusMessage = message;
    account.lastSyncedAt = now;
    if (!(err instanceof CreatorApiError)) console.error("[wesify] creator sync failed", err);
    return;
  }

  account.followerCount = followerCount;
  account.status = "active";
  account.statusMessage = null;
  account.lastSyncedAt = now;
  const threshold = creatorLikeThreshold(followerCount);

  for (const v of remote) {
    let cv = tracked.find((t) => t.platformVideoId === v.platformVideoId);
    if (!cv) {
      if (now - v.publishedAt >= MAX_VIDEO_AGE_AT_CREATION_MS) continue;
      cv = {
        id: newId("cvid"),
        userId: account.userId,
        socialAccountId: account.id,
        platform: account.platform,
        platformVideoId: v.platformVideoId,
        canonicalUrl: v.canonicalUrl,
        caption: v.caption,
        publishedAt: v.publishedAt,
        firstSeenAt: now,
        lastCheckedAt: now,
        likes: 0,
        followerCount,
        threshold,
        status: "tracking",
        eligibleAt: null,
        marketId: null,
        likeHistory: [],
        scenario: v.sim?.scenario ?? null,
        seed: v.sim?.seed ?? 0,
        scale: v.sim?.scale ?? 1,
      };
      ctx.state.creatorVideos[cv.id] = cv;
      tracked.push(cv);
    }
    if (cv.status !== "tracking" && cv.status !== "eligible") continue;
    cv.likes = v.likes;
    cv.followerCount = followerCount;
    cv.threshold = threshold;
    cv.lastCheckedAt = now;
    const last = cv.likeHistory[cv.likeHistory.length - 1];
    if (!last || now > last.capturedAt) cv.likeHistory.push({ capturedAt: now, likes: v.likes });
    if (cv.likeHistory.length > LIKE_HISTORY_CAP) cv.likeHistory.splice(0, cv.likeHistory.length - LIKE_HISTORY_CAP);
  }

  for (const cv of tracked) evaluate(ctx, account, cv);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function evaluate(ctx: Ctx, account: SocialAccountRow, cv: CreatorVideoRow) {
  if (cv.status !== "tracking" && cv.status !== "eligible") return;
  const now = ctx.now();
  const left = cv.publishedAt + MAX_VIDEO_AGE_AT_CREATION_MS - now;
  if (left <= 0) {
    cv.status = "expired";
    return;
  }
  if (cv.status === "tracking" && cv.followerCount >= CREATOR_MIN_FOLLOWERS && cv.likes >= cv.threshold && programState(ctx, cv.userId) === "active") {
    cv.status = "eligible";
    cv.eligibleAt = now;
    const limit = creatorLimit(ctx, cv.userId);
    notify(ctx, {
      userId: cv.userId,
      kind: "CREATOR_ELIGIBLE",
      title: `Your ${platformName(account.platform)} video can open a market.`,
      body:
        limit.remaining > 0
          ? `${compactNumber(cv.likes)} likes already. Open it within ${duration(left)}.`
          : `${compactNumber(cv.likes)} likes already. Your next market unlocks in ${duration(limit.nextAvailableAt! - now)}.`,
      marketId: null,
    });
    track(ctx, "creator_video_eligible", cv.userId, { platform: cv.platform, likes: cv.likes, followers: cv.followerCount });
  }
}

/** Simulated accounts only: adds an upload posted ~45 minutes ago that has already cleared the bar. */
export function simulateUpload(ctx: Ctx, userId: string, accountId: string) {
  const account = ownedAccount(ctx, userId, accountId);
  if (account.mode !== "simulated") throw Errors.invalid("Only simulated accounts can fake an upload.");
  const now = ctx.now();
  const followers = account.followerCount ?? 10_000;
  const id = `sim_${account.platform}_${account.simSeed ?? 0}_manual_${now}`;
  const publishedAt = now - 45 * 60_000;
  const params = simulatedVideoParams(hashString(id), followers, publishedAt);
  // Scale up just enough that it clears 1% of followers now, so the whole flow can be tried at once.
  const target = creatorLikeThreshold(followers) * 1.4;
  const likesNow = simulatedCreatorLikes(params, now);
  if (likesNow < target) params.scale *= target / Math.max(1, likesNow);
  const cv: CreatorVideoRow = {
    id: newId("cvid"),
    userId,
    socialAccountId: account.id,
    platform: account.platform,
    platformVideoId: id,
    canonicalUrl: simUrl(account, id),
    caption: "just posted this 👀",
    publishedAt,
    firstSeenAt: now,
    lastCheckedAt: 0,
    likes: 0,
    followerCount: followers,
    threshold: creatorLikeThreshold(followers),
    status: "tracking",
    eligibleAt: null,
    marketId: null,
    likeHistory: [5, 15, 30, 45].map((min) => {
      const t = publishedAt + min * 60_000;
      return { capturedAt: t, likes: simulatedCreatorLikes(params, t) };
    }),
    scenario: params.scenario,
    seed: params.seed,
    scale: params.scale,
  };
  ctx.state.creatorVideos[cv.id] = cv;
  account.lastSimUploadAt = now;
  account.lastSyncedAt = null; // make the next tick sync immediately
  return cv;
}

export function dismissVideo(ctx: Ctx, userId: string, creatorVideoId: string) {
  const cv = ctx.state.creatorVideos[creatorVideoId];
  if (!cv || cv.userId !== userId) throw Errors.notFound("Video");
  if (cv.status === "tracking" || cv.status === "eligible") cv.status = "dismissed";
}

// ---------------------------------------------------------------------------
// Opening the market
// ---------------------------------------------------------------------------

export function openCreatorMarket(ctx: Ctx, userId: string, creatorVideoId: string) {
  assertActiveCreator(ctx, userId);
  const cv = ctx.state.creatorVideos[creatorVideoId];
  if (!cv || cv.userId !== userId) throw Errors.notFound("Video");
  if (cv.status === "market_created" && cv.marketId) return { marketId: cv.marketId, created: false };
  const account = ctx.state.socialAccounts.find((a) => a.id === cv.socialAccountId);
  if (!account || account.status === "revoked") throw Errors.invalid("Reconnect this account to open its market.");
  if (cv.status !== "eligible") {
    throw Errors.invalid(cv.status === "expired" ? "This video is past its 6-hour window." : "This video hasn't reached 1% of your followers yet.");
  }
  const now = ctx.now();
  if (now - cv.publishedAt >= MAX_VIDEO_AGE_AT_CREATION_MS) {
    cv.status = "expired";
    throw Errors.videoTooOld();
  }
  const limit = creatorLimit(ctx, userId);
  if (limit.remaining <= 0) {
    throw new WesifyError("CREATOR_LIMIT", `You can open ${CREATOR_MARKETS_PER_WINDOW} market every 24 hours. Next one unlocks in ${duration(limit.nextAvailableAt! - now)}.`, 429);
  }

  const history: MetricSnapshot[] = [...cv.likeHistory];
  if (!history.length || history[history.length - 1].capturedAt < now) history.push({ capturedAt: now, likes: cv.likes });
  if (history.length < 2) history.unshift({ capturedAt: cv.publishedAt, likes: 0 });

  const video: Omit<VideoRow, "id" | "createdAt"> = {
    platform: cv.platform,
    platformVideoId: cv.platformVideoId,
    canonicalUrl: cv.canonicalUrl,
    creatorHandle: account.handle,
    caption: cv.caption,
    thumbnailHue: 205 + (hashString(cv.platformVideoId) % 80),
    publishedAt: cv.publishedAt,
    provider: "creator",
    scenario: cv.scenario,
    seed: cv.seed,
    scale: cv.scale,
    socialAccountId: account.id,
  };
  const { market, created } = createMarket(ctx, {
    video,
    openedAt: now,
    initialHistory: history,
    actor: userId,
    source: "creator",
    baseline: { followers: account.followerCount ?? cv.followerCount, avgLikes: account.avgLikes ?? null },
  });
  if (created) market.creatorUserId = userId;
  cv.status = "market_created";
  cv.marketId = market.id;
  audit(ctx, { actor: userId, action: "creator.open_market", entityType: "market", entityId: market.id, metadata: { creatorVideoId: cv.id, likes: cv.likes, followers: cv.followerCount } });
  track(ctx, "creator_market_opened", userId, { market_id: market.id, platform: cv.platform });
  return { marketId: market.id, created };
}

// ---------------------------------------------------------------------------
// Market metrics for creator-opened markets (called from the world tick)
// ---------------------------------------------------------------------------

export function creatorAccountFor(ctx: Ctx, video: VideoRow) {
  return ctx.state.socialAccounts.find((a) => a.id === video.socialAccountId);
}

/**
 * Likes for a creator-opened market. Simulated accounts can be sampled at any time t (so the tick
 * can backfill 5-minute steps); live accounts can only report "now", so t is ignored.
 */
export async function creatorMetrics(ctx: Ctx, video: VideoRow, t: number): Promise<VideoMetrics> {
  const account = creatorAccountFor(ctx, video);
  if (!account || account.status === "revoked") throw new ProviderUnavailableError("Creator account disconnected");
  if (account.mode === "simulated") {
    if (!video.scenario) throw new ProviderUnavailableError("No simulated trajectory");
    return { likes: simulatedCreatorLikes({ scenario: video.scenario, seed: video.seed, scale: video.scale, publishedAt: video.publishedAt }, t), capturedAt: t, source: "creator-sim" };
  }
  const live = liveConnector(account.platform as CreatorPlatform);
  if (!live) throw new ProviderUnavailableError("Live API not configured");
  try {
    const token = await accessToken(account);
    const likes = await live.getLikes(token, [video.platformVideoId]);
    if (likes[video.platformVideoId] === undefined) throw new ProviderUnavailableError("Video not returned by the platform");
    return { likes: likes[video.platformVideoId], capturedAt: ctx.now(), source: `creator-${account.platform}` };
  } catch (err) {
    if (err instanceof CreatorApiError) {
      account.status = "error";
      account.statusMessage = err.message;
      throw new ProviderUnavailableError(err.message);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Read model for the creator page
// ---------------------------------------------------------------------------

export function hasRunningMarket(ctx: Ctx, accountId: string) {
  return Object.values(ctx.state.markets).some(
    (m) => isLive(m.status) && ctx.state.videos[m.videoId]?.socialAccountId === accountId,
  );
}

export function creatorOverview(ctx: Ctx, userId: string): CreatorOverviewDTO {
  const now = ctx.now();
  const accounts = activeAccounts(ctx, userId);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const limit = creatorLimit(ctx, userId);
  const videos = Object.values(ctx.state.creatorVideos)
    .filter((cv) => cv.userId === userId && byId.has(cv.socialAccountId) && cv.status !== "dismissed" && now - cv.publishedAt < 2 * CREATOR_WINDOW_MS)
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, 30)
    .map((cv) => ({
      id: cv.id,
      accountId: cv.socialAccountId,
      platform: cv.platform as CreatorPlatform,
      handle: byId.get(cv.socialAccountId)!.handle,
      caption: cv.caption,
      canonicalUrl: cv.canonicalUrl,
      publishedAt: cv.publishedAt,
      windowEndsAt: cv.publishedAt + MAX_VIDEO_AGE_AT_CREATION_MS,
      likes: cv.likes,
      threshold: cv.threshold,
      followerCount: cv.followerCount,
      status: cv.status,
      marketId: cv.marketId,
    }));
  return {
    program: programDTO(ctx, userId),
    platforms: CREATOR_PLATFORMS.map((p) => ({
      platform: p,
      name: platformName(p),
      mode: liveConnector(p) ? "live" : "simulated",
      connected: accounts.some((a) => a.platform === p),
    })),
    accounts: accounts.map((a) => ({
      id: a.id,
      platform: a.platform as CreatorPlatform,
      handle: a.handle,
      mode: a.mode!,
      status: a.status === "error" ? "error" : "active",
      statusMessage: a.statusMessage ?? null,
      followerCount: a.followerCount ?? 0,
      threshold: creatorLikeThreshold(a.followerCount ?? 0),
      lastSyncedAt: a.lastSyncedAt ?? null,
      hasRunningMarket: hasRunningMarket(ctx, a.id),
    })),
    videos,
    markets: Object.values(ctx.state.markets)
      .filter((m) => m.creatorUserId === userId || (m.videoId && accounts.some((a) => ctx.state.videos[m.videoId]?.socialAccountId === a.id)))
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, 20)
      .map((m) => {
        const trades = ctx.state.trades.filter((t) => t.marketId === m.id);
        return {
          marketId: m.id,
          handle: ctx.state.videos[m.videoId]?.creatorHandle ?? "",
          status: m.status,
          openedAt: m.openedAt,
          volume: trades.reduce((s, t) => s + t.credits, 0),
          traders: new Set(trades.map((t) => t.userId)).size,
          trades: trades.length,
          originalOpens: ctx.state.events.filter((e) => e.name === "original_video_opened" && e.properties.market_id === m.id).length,
        };
      }),
    limit: { remaining: limit.remaining, perWindow: CREATOR_MARKETS_PER_WINDOW, windowHours: CREATOR_WINDOW_MS / 3_600_000, nextAvailableAt: limit.nextAvailableAt },
    rules: {
      likePercent: CREATOR_LIKE_RATIO * 100,
      minFollowers: CREATOR_MIN_FOLLOWERS,
      minLikes: CREATOR_MIN_LIKES,
      maxAgeHours: MAX_VIDEO_AGE_AT_CREATION_MS / 3_600_000,
      syncMinutes: CREATOR_SYNC_INTERVAL_MS / 60_000,
    },
  };
}

// ---------------------------------------------------------------------------

export function platformName(p: string) {
  return p === "tiktok" ? "TikTok" : p === "instagram" ? "Instagram" : p === "youtube" ? "YouTube" : p;
}

const paramsOf = (cv: CreatorVideoRow) => ({ scenario: cv.scenario!, seed: cv.seed, scale: cv.scale, publishedAt: cv.publishedAt });

const simUrl = (account: SocialAccountRow, id: string) =>
  account.platform === "tiktok"
    ? `https://www.tiktok.com/@${account.handle}/video/${id}`
    : account.platform === "youtube"
      ? `https://www.youtube.com/shorts/${id}`
      : `https://www.instagram.com/reel/${id}/`;

const SIM_CAPTIONS = ["new drop, tell me what you think", "had to post this", "part 2 is coming", "we tried it", "this took 40 takes"];
