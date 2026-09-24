# Social providers (§16, §17, §46)

## Interface

`SocialProvider` (`src/lib/social-providers/index.ts`) exposes `resolveVideo(url)` and `getMetrics(video, at)`. It returns standardized `VideoMetadata` and `VideoMetrics` objects, which carry the source and capture time. Each snapshot stores its source.

| Provider | Used for |
|---|---|
| `mock` | Pasted links during testing: real URL parsing, deterministic simulated likes. Can simulate deleted/private videos for staging |
| `manual` | Admin-entered likes (manual markets) |
| creator connectors (`server/creator/providers.ts`) | A connected creator's own videos via the official APIs: TikTok Display API, Instagram API with Instagram Login, YouTube Data API v3 |
| TikTok oEmbed | Platform-sanctioned thumbnail + author name + availability check at submission |

**Switching providers** needs no market code changes. `registerProvider(p)` adds one, `METRICS_PROVIDER` picks the one used for new pasted-link markets, and the world polls any provider except `manual`.

**Future Instagram provider** for arbitrary public reels: register a provider that implements the interface once a licensed data source exists. Instagram and YouTube links are already recognized and rejected with a clear "not supported yet" message.

## Reliability

| Concern | How it's handled |
|---|---|
| Retries and backoff | `withRetry`: exponential backoff with jitter, honours `Retry-After` on 429, doesn't retry other 4xx |
| Provider health | `state.providers[name]`: calls, failures, consecutive failures, last error. Three consecutive failures raise a critical alert (webhook) and appear in `/admin` → Overview and Health |
| Unreliable data | Trading pauses on its own (metrics delayed) and resumes when data returns. The `providers` flag stops all provider traffic |
| Freshness | Last snapshot time is shown on every market ("Likes updated N min ago") |
| Tokens | AES-256-GCM encrypted at rest, refreshed 5 minutes before expiry. On disconnect they're deleted immediately and revoked with the platform (TikTok and Google revoke endpoints; Instagram Login has none) |

## Media rights (§17)

- Thumbnails are linked from the platform (oEmbed / API), never downloaded or re-hosted. Wesify stores only the URL, its source (provenance) and its expiry. An hourly job refreshes URLs about to expire, and broken ones fall back to a neutral placeholder.
- Every market credits the creator ("Video by @handle on TikTok") and links to the original.
- The footer carries a "not affiliated" statement.
- Takedown: `/support?category=creator_takedown` → admin "Takedown". This hides the market, removes the thumbnail link and caption, and cancels a live market with refunds.
- Simulated markets use generic stand-in photos and are labelled "Simulated video".

## Compliance checklist before enabling each live API

See `docs/legal-review.md` → Platform compliance.
