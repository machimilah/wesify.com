import { hashString } from "../shared/random";
import type { Platform, VideoRow } from "../shared/types";
import { simulatedLikes } from "../simulation/trajectories";

/**
 * Social-platform data layer (checklist §16). Market code only talks to `SocialProvider`; which
 * implementation serves a video is decided by `providerFor`, so providers can be swapped without
 * touching markets. Standardized shapes: `VideoMetadata` (what a video is) and `VideoMetrics`
 * (one like-count observation with its source and freshness).
 */

export type VideoMetadata = {
  platform: Platform;
  platformVideoId: string;
  canonicalUrl: string;
  creatorHandle: string;
  publishedAt: number | null;
  caption?: string;
  authorName?: string | null;
  /** Platform-permitted thumbnail (e.g. TikTok oEmbed). Linked, never re-hosted (§17). */
  thumbnailUrl?: string | null;
  thumbnailSource?: string | null;
};

export type VideoMetrics = {
  likes: number;
  /** When the platform's number applies (world time). */
  capturedAt: number;
  /** Which provider produced it, stored on every snapshot (§16 "data source field"). */
  source: string;
};

export interface SocialProvider {
  readonly name: string;
  resolveVideo(url: string): Promise<VideoMetadata>;
  getMetrics(video: VideoRow, at: number): Promise<VideoMetrics>;
}

export type ResolveErrorKind = "invalid" | "unsupported" | "private" | "deleted" | "unavailable" | "shortlink";

export class VideoResolveError extends Error {
  constructor(
    message: string,
    public readonly kind: ResolveErrorKind = "unavailable",
    public readonly platformName?: string,
  ) {
    super(message);
  }
}
/** The provider can't answer right now (outage, rate limit, missing credentials). Retry later. */
export class ProviderUnavailableError extends Error {}
/** The video itself is gone or hidden. Markets pause, then cancel after the grace period (§1). */
export class VideoGoneError extends Error {
  constructor(public readonly reason: "deleted" | "private") {
    super(reason === "deleted" ? "Video deleted" : "Video is private");
  }
}

export const SUPPORTED_PLATFORMS: Platform[] = ["tiktok"];

const PLATFORM_NAMES: Record<Platform, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };
export const platformDisplayName = (p: Platform) => PLATFORM_NAMES[p];

/**
 * TikTok video IDs embed the post time: the top 32 bits of the 64-bit ID are a Unix timestamp.
 */
export function tiktokIdTimestamp(id: string): number | null {
  if (!/^\d{15,20}$/.test(id)) return null;
  const seconds = Number(BigInt(id) >> BigInt(32));
  const ms = seconds * 1000;
  // Sanity bounds: TikTok launched 2016; reject obviously invalid IDs.
  if (ms < Date.UTC(2016, 0, 1) || ms > Date.now() + 86_400_000 * 365 * 5) return null;
  return ms;
}

function toUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 500) throw new VideoResolveError("Invalid URL", "invalid");
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url;
  } catch {
    throw new VideoResolveError("Invalid URL", "invalid");
  }
}

/**
 * Parses and normalizes a video link from any platform we recognize (§14): lowercases the host,
 * drops tracking query strings and fragments, and extracts the platform and content ID. Only
 * TikTok is supported for markets today; other platforms are recognized so the error can say so.
 */
export function parseVideoUrl(raw: string): VideoMetadata {
  const url = toUrl(raw);
  const host = url.hostname.toLowerCase().replace(/^(www|m|vm|vt)\./, "");
  const path = url.pathname.replace(/\/+$/, "");

  if (host === "tiktok.com") {
    const match = path.match(/^\/@([A-Za-z0-9._]{2,24})\/video\/(\d{15,20})$/);
    if (!match) {
      // vm.tiktok.com/ZM… short links need a network redirect; resolveShortLink handles them.
      if (/^\/[A-Za-z0-9]{6,12}$/.test(path) || url.hostname.startsWith("vm.") || url.hostname.startsWith("vt.")) {
        throw new VideoResolveError("Short link", "shortlink");
      }
      throw new VideoResolveError("Unrecognized TikTok video URL", "invalid");
    }
    const [, handle, id] = match;
    return {
      platform: "tiktok",
      platformVideoId: id,
      canonicalUrl: `https://www.tiktok.com/@${handle}/video/${id}`,
      creatorHandle: handle,
      publishedAt: tiktokIdTimestamp(id),
    };
  }
  if (host === "instagram.com") {
    if (/^\/(reel|reels|p)\/[A-Za-z0-9_-]+$/.test(path)) throw new VideoResolveError("Instagram not supported yet", "unsupported", "Instagram");
    throw new VideoResolveError("Unrecognized Instagram URL", "invalid");
  }
  if (host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com") {
    throw new VideoResolveError("YouTube not supported yet", "unsupported", "YouTube");
  }
  if (host === "x.com" || host === "twitter.com" || host === "facebook.com" || host === "snapchat.com") {
    throw new VideoResolveError("Platform not supported", "unsupported", host.split(".")[0].replace(/^./, (c) => c.toUpperCase()));
  }
  throw new VideoResolveError("Unsupported platform", "unsupported");
}

/** @deprecated kept for existing imports; use parseVideoUrl. */
export const parseTikTokUrl = parseVideoUrl;

const networkAllowed = () => !process.env.VITEST && process.env.WESIFY_OFFLINE !== "1";

/** Follows a vm.tiktok.com / vt.tiktok.com short link to the canonical video URL. */
export async function resolveShortLink(raw: string): Promise<string> {
  if (!networkAllowed()) throw new VideoResolveError("Short links need network access", "unavailable");
  const res = await withRetry(() => fetch(toUrl(raw), { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5_000) }), { retries: 1 });
  const location = res.headers.get("location");
  if (!location) throw new VideoResolveError("Short link did not redirect", "invalid");
  return new URL(location, raw).toString();
}

/**
 * TikTok's public oEmbed endpoint: the platform-sanctioned way to embed a video's thumbnail and
 * author name (§17). It fails for private and deleted videos, which doubles as an availability
 * check at ingestion. Returns null when the network is off (dev/tests) or TikTok can't be reached.
 */
export async function fetchTikTokOEmbed(canonicalUrl: string): Promise<{ thumbnailUrl: string | null; authorName: string | null; title: string | null } | "gone" | null> {
  if (!networkAllowed() || process.env.TIKTOK_OEMBED === "0") return null;
  try {
    const res = await withRetry(
      () => fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(canonicalUrl)}`, { signal: AbortSignal.timeout(5_000), cache: "no-store" }),
      { retries: 1 },
    );
    if (res.status === 400 || res.status === 404) return "gone";
    if (!res.ok) return null;
    const body = (await res.json()) as { thumbnail_url?: string; author_name?: string; author_unique_id?: string; title?: string };
    return { thumbnailUrl: body.thumbnail_url ?? null, authorName: body.author_name ?? null, title: body.title ?? null };
  } catch {
    return null;
  }
}

/**
 * Retry with exponential backoff and jitter (§16). Honors a 429's Retry-After (capped), and never
 * retries 4xx other than 408/429 since those won't change on their own.
 */
export async function withRetry(fn: () => Promise<Response>, opts: { retries?: number; baseMs?: number } = {}): Promise<Response> {
  const retries = opts.retries ?? 2;
  const base = opts.baseMs ?? 250;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fn();
      if (res.status !== 429 && res.status !== 408 && res.status < 500) return res;
      if (attempt === retries) return res;
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5_000) : backoff(base, attempt));
    } catch (err) {
      lastErr = err;
      if (attempt === retries) throw err;
      await sleep(backoff(base, attempt));
    }
  }
  throw lastErr;
}

const backoff = (base: number, attempt: number) => base * 2 ** attempt * (0.75 + Math.random() * 0.5);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * MockProvider: resolves real TikTok URLs but serves deterministic simulated metrics. Used until
 * official API access for arbitrary videos exists. The rest of the app does not know the difference.
 */
export class MockProvider implements SocialProvider {
  readonly name = "mock";
  async resolveVideo(url: string): Promise<VideoMetadata> {
    const meta = parseVideoUrl(url);
    if (!SUPPORTED_PLATFORMS.includes(meta.platform)) throw new VideoResolveError("Platform disabled", "unsupported", platformDisplayName(meta.platform));
    return meta;
  }

  async getMetrics(video: VideoRow, at: number): Promise<VideoMetrics> {
    if (video.simulatedAvailability === "deleted" || video.simulatedAvailability === "private") throw new VideoGoneError(video.simulatedAvailability);
    if (!video.scenario) throw new ProviderUnavailableError("No simulated trajectory");
    return {
      likes: simulatedLikes(
        {
          scenario: video.scenario,
          seed: video.seed,
          scale: video.scale,
          openedAt: video.createdAt,
          publishedAt: video.publishedAt,
        },
        at,
      ),
      capturedAt: at,
      source: "mock",
    };
  }
}

/** ManualSettlementProvider: metrics are only set by admins (audit logged elsewhere). */
export class ManualProvider implements SocialProvider {
  readonly name = "manual";
  async resolveVideo(url: string): Promise<VideoMetadata> {
    return parseVideoUrl(url);
  }
  async getMetrics(): Promise<VideoMetrics> {
    throw new ProviderUnavailableError("Manual provider has no automatic metrics");
  }
}

const REGISTRY: Record<string, SocialProvider> = { mock: new MockProvider(), manual: new ManualProvider() };

/** Registers another implementation (e.g. a licensed data vendor) under a name. */
export function registerProvider(provider: SocialProvider) {
  REGISTRY[provider.name] = provider;
}

/** The provider for a stored video. Creator-connected videos are served by server/world/creators. */
export function providerFor(video: Pick<VideoRow, "provider">): SocialProvider {
  return REGISTRY[video.provider] ?? REGISTRY.mock;
}

/**
 * Which provider new pasted-link markets use (§16 "switch providers without changing market code").
 * Set METRICS_PROVIDER to a registered name; defaults to the simulated provider.
 */
export function ingestionProvider(): SocialProvider {
  return REGISTRY[process.env.METRICS_PROVIDER ?? "mock"] ?? REGISTRY.mock;
}

export function seedFromVideoId(platformVideoId: string): number {
  return hashString(platformVideoId);
}
