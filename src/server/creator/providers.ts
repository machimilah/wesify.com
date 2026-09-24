import { mulberry32 } from "@/lib/shared/random";
import type { Platform, ScenarioName } from "@/lib/shared/types";
import { SCENARIO_NAMES, simulatedLikes } from "@/lib/simulation/trajectories";

/**
 * Creator-side platform connectors (§24 Path C, §25). Each platform exposes the same four things
 * Wesify needs: an OAuth consent URL, a token exchange, the account's follower count, and the
 * account's recent videos with like counts. Neither TikTok nor Instagram pushes "new upload" or
 * "new like" events to third-party apps, so detection is polling (see server/world/creators.ts).
 *
 * Live connectors are used when that platform's client credentials are set; otherwise the
 * simulated connector stands in so the full flow works locally. Endpoint shapes follow the
 * platforms' public docs at the time of writing — re-check them during app review, since both
 * gate these scopes behind review and change field names between API versions.
 */

export type CreatorPlatform = Extract<Platform, "tiktok" | "instagram" | "youtube">;
export const CREATOR_PLATFORMS: CreatorPlatform[] = ["tiktok", "instagram", "youtube"];

export type TokenSet = { accessToken: string; refreshToken: string | null; expiresAt: number | null };
export type CreatorProfile = { platformUserId: string; handle: string; followerCount: number };
export type RemoteVideo = { platformVideoId: string; canonicalUrl: string; caption: string; publishedAt: number; likes: number };

export class CreatorApiError extends Error {
  constructor(
    message: string,
    /** True when the creator must reconnect (revoked/expired consent). */
    public readonly needsReconnect = false,
  ) {
    super(message);
  }
}

export interface LiveCreatorConnector {
  platform: CreatorPlatform;
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;
  refresh(tokens: TokenSet): Promise<TokenSet>;
  getProfile(accessToken: string): Promise<CreatorProfile>;
  listRecentVideos(accessToken: string, since: number): Promise<RemoteVideo[]>;
  getLikes(accessToken: string, platformVideoIds: string[]): Promise<Record<string, number>>;
  /** Tells the platform to invalidate the token (§31 token revocation). Best effort. */
  revoke?(accessToken: string): Promise<void>;
}

async function getJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  } catch {
    throw new CreatorApiError("Could not reach the platform. Try again shortly.");
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 || res.status === 403) throw new CreatorApiError("The platform rejected Wesify's access. Reconnect the account.", true);
  if (!res.ok) throw new CreatorApiError(`Platform request failed (${res.status}).`);
  return body;
}

// ---------------------------------------------------------------------------
// TikTok — Login Kit (web) + Display API v2
// Scopes: user.info.basic, user.info.profile (username), user.info.stats (follower_count), video.list
// ---------------------------------------------------------------------------

const tiktok: LiveCreatorConnector = {
  platform: "tiktok",
  authorizeUrl(state, redirectUri) {
    const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
    u.searchParams.set("client_key", process.env.TIKTOK_CLIENT_KEY!);
    u.searchParams.set("scope", "user.info.basic,user.info.profile,user.info.stats,video.list");
    u.searchParams.set("response_type", "code");
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    return u.toString();
  },
  async exchangeCode(code, redirectUri) {
    return tiktokToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  },
  async refresh(tokens) {
    if (!tokens.refreshToken) throw new CreatorApiError("TikTok session expired. Reconnect the account.", true);
    return tiktokToken({ grant_type: "refresh_token", refresh_token: tokens.refreshToken });
  },
  async getProfile(accessToken) {
    const body = await getJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,username,display_name,follower_count", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = (body.data as { user?: Record<string, unknown> })?.user ?? {};
    return {
      platformUserId: String(user.open_id ?? ""),
      handle: String(user.username ?? user.display_name ?? "tiktok user"),
      followerCount: Number(user.follower_count ?? 0),
    };
  },
  async listRecentVideos(accessToken, since) {
    const body = await getJson("https://open.tiktokapis.com/v2/video/list/?fields=id,create_time,share_url,video_description,like_count", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ max_count: 20 }),
    });
    const videos = ((body.data as { videos?: Record<string, unknown>[] })?.videos ?? []).map((v) => ({
      platformVideoId: String(v.id),
      canonicalUrl: String(v.share_url ?? ""),
      caption: String(v.video_description ?? ""),
      publishedAt: Number(v.create_time ?? 0) * 1000,
      likes: Number(v.like_count ?? 0),
    }));
    return videos.filter((v) => v.publishedAt >= since);
  },
  async getLikes(accessToken, ids) {
    const out: Record<string, number> = {};
    for (let i = 0; i < ids.length; i += 20) {
      const body = await getJson("https://open.tiktokapis.com/v2/video/query/?fields=id,like_count", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ filters: { video_ids: ids.slice(i, i + 20) } }),
      });
      for (const v of (body.data as { videos?: Record<string, unknown>[] })?.videos ?? []) out[String(v.id)] = Number(v.like_count ?? 0);
    }
    return out;
  },
  async revoke(accessToken) {
    await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY!, client_secret: process.env.TIKTOK_CLIENT_SECRET!, token: accessToken }),
      signal: AbortSignal.timeout(10_000),
    });
  },
};

async function tiktokToken(params: Record<string, string>): Promise<TokenSet> {
  const body = await getJson("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY!, client_secret: process.env.TIKTOK_CLIENT_SECRET!, ...params }),
  });
  if (!body.access_token) throw new CreatorApiError("TikTok did not return an access token.", true);
  return {
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : null,
    expiresAt: body.expires_in ? Date.now() + Number(body.expires_in) * 1000 : null,
  };
}

// ---------------------------------------------------------------------------
// Instagram — "Instagram API with Instagram Login" (Business/Creator accounts only)
// Scope: instagram_business_basic. Personal accounts can't grant this; the UI says so.
// ---------------------------------------------------------------------------

const IG_GRAPH = `https://graph.instagram.com/${process.env.INSTAGRAM_GRAPH_VERSION ?? "v21.0"}`;

const instagram: LiveCreatorConnector = {
  platform: "instagram",
  authorizeUrl(state, redirectUri) {
    const u = new URL("https://www.instagram.com/oauth/authorize");
    u.searchParams.set("client_id", process.env.INSTAGRAM_CLIENT_ID!);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "instagram_business_basic");
    u.searchParams.set("state", state);
    return u.toString();
  },
  async exchangeCode(code, redirectUri) {
    const short = await getJson("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.INSTAGRAM_CLIENT_ID!,
        client_secret: process.env.INSTAGRAM_CLIENT_SECRET!,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
    });
    if (!short.access_token) throw new CreatorApiError("Instagram did not return an access token.", true);
    // Short-lived tokens last about an hour; swap for a long-lived (~60 day) token right away.
    const u = new URL("https://graph.instagram.com/access_token");
    u.searchParams.set("grant_type", "ig_exchange_token");
    u.searchParams.set("client_secret", process.env.INSTAGRAM_CLIENT_SECRET!);
    u.searchParams.set("access_token", String(short.access_token));
    const long = await getJson(u.toString());
    return { accessToken: String(long.access_token), refreshToken: null, expiresAt: Date.now() + Number(long.expires_in ?? 0) * 1000 };
  },
  async refresh(tokens) {
    const u = new URL("https://graph.instagram.com/refresh_access_token");
    u.searchParams.set("grant_type", "ig_refresh_token");
    u.searchParams.set("access_token", tokens.accessToken);
    const body = await getJson(u.toString());
    return { accessToken: String(body.access_token), refreshToken: null, expiresAt: Date.now() + Number(body.expires_in ?? 0) * 1000 };
  },
  async getProfile(accessToken) {
    const body = await getJson(`${IG_GRAPH}/me?fields=user_id,username,followers_count&access_token=${encodeURIComponent(accessToken)}`);
    return { platformUserId: String(body.user_id ?? body.id ?? ""), handle: String(body.username ?? "instagram user"), followerCount: Number(body.followers_count ?? 0) };
  },
  async listRecentVideos(accessToken, since) {
    const body = await getJson(
      `${IG_GRAPH}/me/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count&limit=25&access_token=${encodeURIComponent(accessToken)}`,
    );
    return ((body.data as Record<string, unknown>[]) ?? [])
      .filter((m) => m.media_type === "VIDEO" || m.media_product_type === "REELS")
      .map((m) => ({
        platformVideoId: String(m.id),
        canonicalUrl: String(m.permalink ?? ""),
        caption: String(m.caption ?? ""),
        publishedAt: Date.parse(String(m.timestamp)),
        likes: Number(m.like_count ?? 0),
      }))
      .filter((v) => v.publishedAt >= since);
  },
  async getLikes(accessToken, ids) {
    const out: Record<string, number> = {};
    for (const id of ids) {
      const body = await getJson(`${IG_GRAPH}/${id}?fields=like_count&access_token=${encodeURIComponent(accessToken)}`);
      out[id] = Number(body.like_count ?? 0);
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// YouTube — Google OAuth + YouTube Data API v3. Scope: youtube.readonly (channel stats, uploads).
// ---------------------------------------------------------------------------

const YT = "https://www.googleapis.com/youtube/v3";

async function googleToken(params: Record<string, string>): Promise<TokenSet> {
  const body = await getJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.YOUTUBE_CLIENT_ID!, client_secret: process.env.YOUTUBE_CLIENT_SECRET!, ...params }),
  });
  if (!body.access_token) throw new CreatorApiError("Google did not return an access token.", true);
  return {
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : (params.refresh_token ?? null),
    expiresAt: body.expires_in ? Date.now() + Number(body.expires_in) * 1000 : null,
  };
}

const youtube: LiveCreatorConnector = {
  platform: "youtube",
  authorizeUrl(state, redirectUri) {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", process.env.YOUTUBE_CLIENT_ID!);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.readonly");
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    u.searchParams.set("state", state);
    return u.toString();
  },
  exchangeCode: (code, redirectUri) => googleToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  async refresh(tokens) {
    if (!tokens.refreshToken) throw new CreatorApiError("YouTube session expired. Reconnect the account.", true);
    return googleToken({ grant_type: "refresh_token", refresh_token: tokens.refreshToken });
  },
  async getProfile(accessToken) {
    const body = await getJson(`${YT}/channels?part=snippet,statistics&mine=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const ch = ((body.items as Record<string, unknown>[]) ?? [])[0] ?? {};
    const snippet = (ch.snippet ?? {}) as Record<string, unknown>;
    const stats = (ch.statistics ?? {}) as Record<string, unknown>;
    return { platformUserId: String(ch.id ?? ""), handle: String(snippet.customUrl ?? snippet.title ?? "youtube channel").replace(/^@/, ""), followerCount: Number(stats.subscriberCount ?? 0) };
  },
  async listRecentVideos(accessToken, since) {
    const auth = { headers: { Authorization: `Bearer ${accessToken}` } };
    const ch = await getJson(`${YT}/channels?part=contentDetails&mine=true`, auth);
    const uploads = (((ch.items as Record<string, unknown>[]) ?? [])[0]?.contentDetails as { relatedPlaylists?: { uploads?: string } } | undefined)?.relatedPlaylists?.uploads;
    if (!uploads) return [];
    const list = await getJson(`${YT}/playlistItems?part=contentDetails&maxResults=25&playlistId=${encodeURIComponent(uploads)}`, auth);
    const ids = ((list.items as { contentDetails?: { videoId?: string } }[]) ?? []).map((i) => i.contentDetails?.videoId).filter(Boolean) as string[];
    if (!ids.length) return [];
    const vids = await getJson(`${YT}/videos?part=snippet,statistics&id=${ids.join(",")}`, auth);
    return ((vids.items as Record<string, unknown>[]) ?? [])
      .map((v) => {
        const sn = (v.snippet ?? {}) as Record<string, unknown>;
        return {
          platformVideoId: String(v.id),
          canonicalUrl: `https://www.youtube.com/shorts/${v.id}`,
          caption: String(sn.title ?? ""),
          publishedAt: Date.parse(String(sn.publishedAt)),
          likes: Number(((v.statistics ?? {}) as Record<string, unknown>).likeCount ?? 0),
        };
      })
      .filter((v) => v.publishedAt >= since);
  },
  async getLikes(accessToken, ids) {
    const out: Record<string, number> = {};
    for (let i = 0; i < ids.length; i += 50) {
      const body = await getJson(`${YT}/videos?part=statistics&id=${ids.slice(i, i + 50).join(",")}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      for (const v of (body.items as Record<string, unknown>[]) ?? []) out[String(v.id)] = Number(((v.statistics ?? {}) as Record<string, unknown>).likeCount ?? 0);
    }
    return out;
  },
  async revoke(accessToken) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, { method: "POST", signal: AbortSignal.timeout(10_000) });
  },
};

const LIVE: Record<CreatorPlatform, { connector: LiveCreatorConnector; configured: () => boolean }> = {
  tiktok: { connector: tiktok, configured: () => Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET) },
  instagram: { connector: instagram, configured: () => Boolean(process.env.INSTAGRAM_CLIENT_ID && process.env.INSTAGRAM_CLIENT_SECRET) },
  youtube: { connector: youtube, configured: () => Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET) },
};

/** Best-effort token revocation after a disconnect; Instagram Login has no revoke endpoint. */
export async function revokePlatformToken(platform: CreatorPlatform, token: string) {
  try {
    await LIVE[platform].connector.revoke?.(token);
  } catch {
    /* the token is already deleted on our side; the platform expires it on its own */
  }
}


export function liveConnector(platform: CreatorPlatform): LiveCreatorConnector | null {
  return LIVE[platform].configured() ? LIVE[platform].connector : null;
}

export function isCreatorPlatform(p: string): p is CreatorPlatform {
  return (CREATOR_PLATFORMS as string[]).includes(p);
}

// ---------------------------------------------------------------------------
// Simulated connector — deterministic stand-in with the same shape as the live data
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
/** Simulated creators post roughly every 8 hours. */
export const SIM_UPLOAD_EVERY_MS = 8 * HOUR;

export function simulatedProfile(seed: number, wesifyUsername: string, platform: CreatorPlatform): CreatorProfile {
  const rnd = mulberry32(seed);
  const followerCount = Math.round(5_000 + rnd() * rnd() * 400_000);
  const handle = `${wesifyUsername.replace(/[^a-z0-9_.]/g, "")}${platform === "tiktok" ? "" : platform === "youtube" ? ".yt" : ".ig"}`;
  return { platformUserId: `sim_${platform}_${seed}`, handle, followerCount };
}

export type SimVideoParams = { scenario: ScenarioName; seed: number; scale: number; publishedAt: number };

/** Deterministic trajectory parameters for a simulated upload, sized to the account's audience. */
export function simulatedVideoParams(videoSeed: number, followerCount: number, publishedAt: number): SimVideoParams {
  const rnd = mulberry32(videoSeed);
  const scenario = SCENARIO_NAMES[Math.floor(rnd() * SCENARIO_NAMES.length)];
  // Base curves are tuned around ~100K-follower accounts; stretch to this audience with spread
  // so some uploads clear 1% of followers quickly and some never do.
  const scale = (followerCount / 100_000) * (0.15 + rnd() * 1.6);
  return { scenario, seed: videoSeed, scale, publishedAt };
}

/** Likes for a simulated upload at time t (the curve's "hour 0" is 30 minutes after posting). */
export function simulatedCreatorLikes(p: SimVideoParams, t: number): number {
  return simulatedLikes({ scenario: p.scenario, seed: p.seed, scale: p.scale, publishedAt: p.publishedAt, openedAt: p.publishedAt + 30 * 60_000 }, t);
}

/** Scheduled simulated uploads within [since, now]: one per 8-hour slot, at a seeded offset. */
export function simulatedUploads(accountSeed: number, since: number, now: number): { slot: number; publishedAt: number }[] {
  const out: { slot: number; publishedAt: number }[] = [];
  for (let slot = Math.floor(since / SIM_UPLOAD_EVERY_MS); slot * SIM_UPLOAD_EVERY_MS <= now; slot++) {
    const publishedAt = slot * SIM_UPLOAD_EVERY_MS + Math.floor(mulberry32(accountSeed + slot)() * 6 * HOUR);
    if (publishedAt >= since && publishedAt <= now) out.push({ slot, publishedAt });
  }
  return out;
}
