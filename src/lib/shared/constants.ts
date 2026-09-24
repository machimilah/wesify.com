export const MARKET_QUESTION = "How many likes will this video have after 24 hours?";

export const WELCOME_CREDITS = 10_000;
export const MARKET_DURATION_MS = 24 * 60 * 60 * 1000;
export const LOCK_BEFORE_SETTLEMENT_MS = 60 * 1000;
export const MAX_VIDEO_AGE_AT_CREATION_MS = 6 * 60 * 60 * 1000;
export const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

/** Spec suggests b = 1000. With a W$10,000 bankroll and 20% trade caps, 1000 let one
 * trade move a 5% range to ~87%; 2500 keeps single trades meaningful but not decisive. */
export const DEFAULT_LIQUIDITY_B = 2500;

export const MAX_TRADE_FRACTION_OF_BALANCE = 0.2;
export const MAX_MARKET_FRACTION_OF_PORTFOLIO = 0.5;
export const MIN_TRADE_CREDITS = 1;

export const MIN_ACTIVE_MARKETS = 20;
/** Supply cap (§23): no new markets open while this many are live. */
export const MAX_ACTIVE_MARKETS = 100;
/** At most this many of one creator's markets among the first 20 feed slots (§23 diversity). */
export const MAX_FEED_MARKETS_PER_CREATOR = 2;

// ---- Market eligibility (§22) ----
export const MIN_VIDEO_AGE_AT_CREATION_MS = 5 * 60 * 1000;
export const MIN_LIKES_AT_CREATION = 100;
export const MIN_SNAPSHOTS_AT_CREATION = 2;
/** A creator whose baseline is below this can't attract enough traders to be worth a market. */
export const MIN_BASELINE_LIKES = 500;

// ---- Trading safety (§8, §20, §27) ----
/** A buy can't push an outcome's price above this (§20 price bounds). */
export const MAX_PRICE_AFTER_BUY = 0.99;
/** Default tolerance between the price the user saw and the fill price (absolute probability). */
export const DEFAULT_PRICE_TOLERANCE = 0.03;
/** Max W$ a single user can win on any one outcome of a market (per-market exposure). */
export const MAX_POTENTIAL_PAYOUT_PER_MARKET = 25_000;
/** Per-user trade cap across all markets (anti-bot). */
export const MAX_TRADES_PER_HOUR = 60;
/** Largest price move one model update may cause, outside a spike (§21). */
export const MAX_REPRICE_MOVE = 0.15;
export const MAX_REPRICE_MOVE_SPIKE = 0.3;
/** Metrics older than this pause trading (§16 freshness). */
export const METRIC_STALE_AFTER_MS = 20 * 60 * 1000;

// ---- Accounts (§4) ----
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_FAILED_LOGINS = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 10;
export const MIN_AGE = 18;
export const SIGNUPS_PER_DEVICE_PER_DAY = 3;
export const SIGNUPS_PER_IP_PER_DAY = 10;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

// ---- Referrals (§30) ----
export const REFERRAL_REWARD = 1_000;
/** A referral pays out only after the new user actually trades this much (§30). */
export const REFERRAL_MIN_TRADES = 3;
export const REFERRAL_MIN_MARKETS = 2;
export const REFERRAL_MAX_REWARDS_PER_USER = 20;

// ---- Notifications (§29) ----
export const MAX_NOTIFICATIONS_PER_HOUR = 12;
export const MAX_EMAILS_PER_DAY = 5;

// ---- Leaderboard (§13) ----
export const LEADERBOARD_MIN_TRADES = 5;
export const LEADERBOARD_MIN_MARKETS = 2;

export const DEMO_DURATION_REAL_MS = 3 * 60 * 1000;
export const DEMO_TIME_SCALE = MARKET_DURATION_MS / DEMO_DURATION_REAL_MS; // 480x

export const SMOOTHING_ALPHA = 0.2;
export const SMOOTHING_ALPHA_SPIKE = 0.35;
export const PROBABILITY_FLOOR = 0.003;

export type RangeDef = { label: string; min: number | null; max: number | null };

/** Legacy fixed ranges (five). New markets use the creator-sized four ranges in market-engine/ranges.ts. */
export const DEFAULT_RANGES: RangeDef[] = [
  { label: "< 10K", min: null, max: 10_000 },
  { label: "10K–100K", min: 10_000, max: 100_000 },
  { label: "100K–500K", min: 100_000, max: 500_000 },
  { label: "500K–1M", min: 500_000, max: 1_000_000 },
  { label: "1M+", min: 1_000_000, max: null },
];

// ---- Creator mode (connected accounts) ----

/** A video qualifies once likes reach this share of the creator's followers… */
export const CREATOR_LIKE_RATIO = 0.01;
/** …but never below these floors, so tiny accounts can't qualify on a handful of likes. */
export const CREATOR_MIN_FOLLOWERS = 1_000;
export const CREATOR_MIN_LIKES = 100;
/** One creator-opened market per Wesify user per rolling window, across all their accounts. */
export const CREATOR_MARKETS_PER_WINDOW = 1;
export const CREATOR_WINDOW_MS = 24 * 60 * 60 * 1000;
/** How often a connected account is polled for new uploads and like counts. */
export const CREATOR_SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** How far back an account sync looks for uploads (anything older can't open a market anyway). */
export const CREATOR_LOOKBACK_MS = MAX_VIDEO_AGE_AT_CREATION_MS;

/**
 * Creator program agreement. Bump the version when the terms change: creators are asked to sign
 * again before they can open another market, and old signatures stay on record at their version.
 */
export const CREATOR_CONTRACT_VERSION = "1.0";
export const CREATOR_CONTRACT_TERMS = [
  "The videos I submit are my own, posted from an account I control.",
  "I will keep the connected account linked while any of my markets is running, and I will not delete or hide a video that has an open market.",
  "I will not buy, sell, or ask anyone to trade on my behalf in markets about my own videos.",
  "I will not buy likes or use bots, engagement pods, or any artificial means to move a video's like count.",
  "I understand Wesify reads my follower count, my recent videos and their like counts, and that like counts decide how markets settle.",
  "I accept that Wesify may cancel a market, pause trading, or remove me from the program if data looks unreliable or these rules are broken.",
  "I understand Wesify Credits are play money with no monetary value, and that I am not paid for opening markets.",
] as const;
/** How long a rejected applicant waits before applying again. */
export const CREATOR_REAPPLY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function creatorLikeThreshold(followerCount: number): number {
  return Math.max(CREATOR_MIN_LIKES, Math.ceil(followerCount * CREATOR_LIKE_RATIO));
}

/** Broad prior used when a market has too little trajectory data (§56). */
export const BROAD_PRIOR = [0.15, 0.35, 0.3, 0.15, 0.05];
