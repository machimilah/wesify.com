export type Platform = "tiktok" | "instagram" | "youtube";

/**
 * Market lifecycle (checklist §24). Every change goes through `transition()` in
 * server/world/lifecycle.ts, which validates it against the allowed-transition table and audits it.
 */
export type MarketStatus = "DRAFT" | "OPEN" | "PAUSED" | "LOCKED" | "SETTLING" | "SETTLED" | "CANCELLED";

export type MomentumLabel = "COOLING" | "STABLE" | "RISING" | "SURGING" | "EXPLODING";

export type TradeSide = "BUY" | "SELL";

export type LedgerType =
  | "WELCOME_BONUS"
  | "BUY"
  | "SELL"
  | "SETTLEMENT"
  | "CANCELLATION_REFUND"
  | "ADMIN_ADJUSTMENT"
  | "ADMIN_REFUND"
  | "REFERRAL";

/** Why a market was cancelled (§26). Shown to users with a plain-English explanation. */
export type CancelReason =
  | "DELETED_CONTENT"
  | "PRIVATE_CONTENT"
  | "PLATFORM_OUTAGE"
  | "METRIC_CORRUPTION"
  | "MANIPULATION"
  | "INCORRECT_SETUP"
  | "CONTENT_REMOVED"
  | "ADMIN";

export type MetricSnapshot = {
  capturedAt: number; // epoch ms (world time)
  likes: number;
  views?: number;
  comments?: number;
  shares?: number;
};

export type ScenarioName =
  | "flat"
  | "slow-growth"
  | "viral-spike"
  | "spike-decay"
  | "late-spike"
  | "fake-spike"
  | "stable-mid"
  | "double-spike";

// ---- Persistent rows (mirror db/schema.sql) ----

export type UserRole = "user" | "support" | "admin";
/** frozen: can browse, can't trade (under review). suspended: can't sign in. deleted: anonymized. */
export type UserStatus = "active" | "frozen" | "suspended" | "deleted";

export type NotificationKind =
  | "PRICE_MOVE"
  | "POSITION_DOWN"
  | "SPIKE"
  | "SETTLEMENT"
  | "CLOSING"
  | "CANCELLED"
  | "TRADE"
  | "REWARD"
  | "MARKET_OPENED"
  | "SUBMISSION"
  | "CREATOR_ELIGIBLE"
  | "CREATOR_DECISION"
  | "SYSTEM";

export type NotificationPrefs = {
  /** In-app notifications per group. Trade confirmations and settlement results are always on. */
  priceMoves: boolean;
  closingSoon: boolean;
  marketOpened: boolean;
  /** Email per group (only sent to verified addresses). */
  emailSettlement: boolean;
  emailMarketOpened: boolean;
  emailProduct: boolean;
};

export type UserRow = {
  id: string;
  username: string;
  avatarHue: number;
  creditsBalance: number;
  isBot: boolean;
  referralCode: string;
  createdAt: number;
  updatedAt: number;
  // ---- Identity (added for V1; optional so older state files still load) ----
  email?: string | null;
  emailVerifiedAt?: number | null;
  /** scrypt `salt:hash` (hex) for the built-in login. Null when Clerk owns the credentials. */
  passwordHash?: string | null;
  clerkUserId?: string | null;
  role?: UserRole;
  status?: UserStatus;
  statusReason?: string | null;
  termsAcceptedAt?: number | null;
  termsVersion?: string | null;
  privacyAcceptedAt?: number | null;
  privacyVersion?: string | null;
  ageConfirmedAt?: number | null;
  onboardingCompletedAt?: number | null;
  tutorialCompletedAt?: number | null;
  lastActiveAt?: number | null;
  /** Beta cohort label (from the invite code used at signup). */
  cohort?: string | null;
  referredByUserId?: string | null;
  riskScore?: number;
  failedLogins?: number;
  lockedUntil?: number | null;
  notificationPrefs?: NotificationPrefs;
  showOnLeaderboard?: boolean;
  consent?: { analytics: boolean; marketing: boolean; updatedAt: number } | null;
  deletedAt?: number | null;
};

export type SessionRow = {
  tokenHash: string;
  userId: string;
  createdAt: number;
  /** Real epoch ms. Sessions expire at an absolute age and after idle time (§4). */
  expiresAt?: number;
  lastSeenAt?: number;
  deviceId?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
};

export type SocialAccountRow = {
  id: string;
  userId: string;
  platform: Platform;
  platformUserId: string;
  handle: string;
  createdAt: number;
  /** "live" uses the platform's official API with the creator's token; "simulated" is the local
   * stand-in used until developer credentials exist. Absent on rows saved before creator mode. */
  mode?: "live" | "simulated";
  status?: "active" | "error" | "revoked";
  statusMessage?: string | null;
  followerCount?: number;
  /** Median likes on the account's recent videos; feeds the range formula (§1). */
  avgLikes?: number | null;
  /** AES-256-GCM ciphertext (see server/crypto.ts); never sent to clients. */
  accessTokenEncrypted?: string | null;
  refreshTokenEncrypted?: string | null;
  expiresAt?: number | null;
  lastSyncedAt?: number | null;
  /** Simulated mode only: seeds the fake account's uploads. */
  simSeed?: number;
  lastSimUploadAt?: number | null;
};

export type CreatorApplicationStatus = "pending" | "approved" | "rejected" | "revoked";

/** An application to the creator program. Only an approved creator who signed the agreement can open markets. */
export type CreatorApplicationRow = {
  id: string;
  userId: string;
  status: CreatorApplicationStatus;
  /** What the applicant told us — unverified until their account is connected. Free text: they
   * name the platform they post on, which may be one Wesify can't track automatically yet. */
  platform: string;
  handle: string;
  profileUrl: string;
  followerCount: number;
  about: string;
  submittedAt: number;
  decidedAt: number | null;
  /** Shown to the applicant with the decision. */
  decisionNote: string | null;
  decidedBy: string | null;
  /** Agreement the creator signed after approval. */
  contractVersion: string | null;
  contractSignedAt: number | null;
  contractSignedName: string | null;
};

export type CreatorVideoStatus = "tracking" | "eligible" | "market_created" | "expired" | "dismissed";

/** A connected creator's recent upload that Wesify watches until it qualifies (or ages out). */
export type CreatorVideoRow = {
  id: string;
  userId: string;
  socialAccountId: string;
  platform: Platform;
  platformVideoId: string;
  canonicalUrl: string;
  caption: string;
  publishedAt: number;
  firstSeenAt: number;
  lastCheckedAt: number;
  likes: number;
  /** Follower count used for the threshold at the last check. */
  followerCount: number;
  threshold: number;
  status: CreatorVideoStatus;
  eligibleAt: number | null;
  marketId: string | null;
  /** Like samples collected while tracking; they seed the market's price history. */
  likeHistory: MetricSnapshot[];
  /** Simulated mode only. */
  scenario: ScenarioName | null;
  seed: number;
  scale: number;
};

export type VideoRow = {
  id: string;
  platform: Platform;
  platformVideoId: string;
  canonicalUrl: string;
  creatorHandle: string;
  caption: string;
  thumbnailHue: number;
  publishedAt: number;
  createdAt: number;
  /** "creator" = likes read live from the creator's connected account. */
  provider: "mock" | "manual" | "creator";
  scenario: ScenarioName | null;
  seed: number;
  /** Simulated trajectory scale (final-likes multiplier) for mock provider. */
  scale: number;
  /** Set when the market was opened by the creator from a connected account. */
  socialAccountId?: string | null;
  // ---- Media rights (§17) ----
  /** Platform-permitted thumbnail (oEmbed or the creator API). Never re-hosted by Wesify. */
  thumbnailUrl?: string | null;
  /** Where the thumbnail came from, e.g. "tiktok-oembed", "creator-api". */
  thumbnailSource?: string | null;
  thumbnailFetchedAt?: number | null;
  thumbnailExpiresAt?: number | null;
  thumbnailBroken?: boolean;
  /** Author name as the platform reports it, for attribution. */
  authorName?: string | null;
  // ---- Creator baseline used by the range formula (§1) ----
  creatorFollowers?: number | null;
  creatorAvgLikes?: number | null;
  /** Simulated-provider only: lets staging reproduce deleted/private videos (§53). */
  simulatedAvailability?: "available" | "deleted" | "private";
  takenDownAt?: number | null;
};

export type SnapshotRow = MetricSnapshot & {
  id: string;
  videoId: string;
  source: string;
  /** Excluded from pricing: an impossible jump or a drop that looks like a data error (§18). */
  suspicious?: boolean;
};

export type SettlementProposal = {
  finalMetric: number;
  source: string;
  capturedAt: number;
  winningOutcomeId: string;
  issues: string[];
  proposedAt: number;
};

export type MarketRow = {
  id: string;
  videoId: string;
  question: string;
  status: MarketStatus;
  openedAt: number;
  locksAt: number;
  settlesAt: number;
  finalMetric: number | null;
  winningOutcomeId: string | null;
  liquidityParameter: number;
  /** Why the market is PAUSED, or why its settlement is on hold. */
  pausedReason: string | null;
  momentumScore: number;
  momentumLabel: MomentumLabel;
  currentLikes: number;
  change3h: number;
  riskScore: number;
  createdAt: number;
  /** Tracks which snapshot time the market has been repriced through. */
  lastPricedAt: number;
  /** Wesify user who opened this market from their own connected account (creator flow). */
  creatorUserId?: string | null;
  /** Wesify user who created the market (creator studio or pasted link). Null for seeded/admin markets. */
  createdByUserId?: string | null;
  // ---- V1 additions ----
  /** How the market came to exist (tracked for §15 "markets originating from sharing"). */
  source?: "system" | "admin" | "paste" | "share" | "creator";
  /** Version of the plain-English rules the market runs under (see lib/shared/rules.ts). */
  rulesVersion?: string;
  /** Inputs to the range formula, stored so the ranges can be explained later. */
  rangeBasis?: { followers: number | null; avgLikes: number | null; baseline: number; center: number; formulaVersion: string } | null;
  /** DRAFT markets: user submissions waiting for admin approval (§22, §60). */
  review?: { submittedAt: number; decidedAt: number | null; decidedBy: string | null; note: string | null } | null;
  /** Settlement waits for a reviewer (§1 "settlement happens after review"). */
  proposedSettlement?: SettlementProposal | null;
  settlementAttempts?: number;
  cancellation?: { reason: CancelReason; explanation: string; at: number } | null;
  /** When the video first became unavailable (deleted/private); cleared when it comes back. */
  unavailableSince?: number | null;
  unavailableReason?: "deleted" | "private" | null;
  featured?: boolean;
  hidden?: boolean;
};

export type OutcomeRow = {
  id: string;
  marketId: string;
  label: string;
  minValue: number | null;
  maxValue: number | null;
  sortOrder: number;
  /** LMSR share quantity outstanding (q_i). */
  quantity: number;
  /** Smoothed model probability; model_logit = ln(modelProbability). */
  modelProbability: number;
  currentPrice: number;
  createdAt: number;
};

export type TradeRow = {
  id: string;
  userId: string;
  marketId: string;
  outcomeId: string;
  side: TradeSide;
  shares: number;
  price: number; // average fill price
  credits: number;
  realizedPnl: number;
  priceBefore: number;
  priceAfter: number;
  createdAt: number;
};

export type PositionRow = {
  id: string;
  userId: string;
  marketId: string;
  outcomeId: string;
  shares: number;
  averageEntryPrice: number;
  realizedPnl: number;
  totalBought: number;
  closedAt: number | null;
  settlement: null | { won: boolean; payout: number; costBasis: number; pnl: number; kind: "SETTLED" | "CANCELLED" };
  /** Highest gain threshold already notified (0.5 = +50%). */
  notifiedGainLevel: number;
  /** Lowest loss threshold already notified (−0.5 = −50%). */
  notifiedLossLevel?: number;
  createdAt: number;
  updatedAt: number;
};

export type PricePointRow = {
  marketId: string;
  outcomeId: string;
  price: number;
  modelProbability: number;
  recordedAt: number;
};

export type SettlementRow = {
  id: string;
  marketId: string;
  kind: "SETTLED" | "CANCELLED";
  finalMetric: number | null;
  winningOutcomeId: string | null;
  source: string;
  settledAt: number;
  metadata: Record<string, unknown>;
};

export type LedgerRow = {
  id: string;
  userId: string;
  type: LedgerType;
  amount: number;
  referenceType: string | null;
  referenceId: string | null;
  balanceAfter: number;
  createdAt: number;
  /** Human-readable line for the wallet (§10). */
  description?: string;
};

export type AuditLogRow = {
  id: string;
  actor: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: number;
};

export type NotificationRow = {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  marketId: string | null;
  read: boolean;
  createdAt: number;
};

export type RiskFlagRow = {
  id: string;
  entityType: "market" | "user";
  entityId: string;
  reason: string;
  severity: number; // 0..1
  metadata: Record<string, unknown>;
  createdAt: number;
  /** Review queue (§27): open until an admin resolves or dismisses it. */
  status?: "open" | "resolved" | "dismissed";
  resolvedAt?: number | null;
  resolvedBy?: string | null;
  resolution?: string | null;
};

export type AnalyticsEventRow = {
  id: string;
  name: string;
  userId: string | null;
  properties: Record<string, unknown>;
  createdAt: number;
};

/** One model run, stored for backtesting and model analytics (§19, §41). */
export type ForecastRow = {
  marketId: string;
  at: number;
  modelVersion: string;
  expectedFinalLikes: number;
  uncertainty: number;
  momentum: number;
  probabilities: number[];
  /** Market prices before/after this repricing (§21 "log each repricing event"). */
  pricesBefore: number[];
  pricesAfter: number[];
  /** True when the per-update movement cap held the prior back. */
  capped: boolean;
  videoAgeMin: number;
};

export type SupportCategory =
  | "missing_credits"
  | "incorrect_trade"
  | "market_dispute"
  | "settlement_dispute"
  | "account_deletion"
  | "password_reset"
  | "abuse_report"
  | "report_user"
  | "report_market"
  | "creator_takedown"
  | "appeal"
  | "privacy_request"
  | "security"
  | "feedback"
  | "other";

export type SupportTicketRow = {
  id: string;
  userId: string | null;
  email: string | null;
  category: SupportCategory;
  subject: string;
  body: string;
  /** What the ticket is about (a market, user, video), for reports and disputes. */
  entityType: "market" | "user" | "video" | null;
  entityId: string | null;
  status: "open" | "pending" | "resolved";
  priority: "normal" | "high";
  createdAt: number;
  updatedAt: number;
  replies: { at: number; by: string; body: string; internal: boolean }[];
};

export type FeedbackRow = {
  id: string;
  userId: string | null;
  rating: number | null;
  kind: "general" | "bug" | "idea" | "churn";
  body: string;
  page: string | null;
  createdAt: number;
};

export type ReferralRow = {
  id: string;
  referrerId: string;
  refereeId: string;
  status: "pending" | "rewarded" | "rejected";
  reason: string | null;
  createdAt: number;
  decidedAt: number | null;
};

export type InviteRow = {
  code: string;
  cohort: string;
  maxUses: number;
  uses: number;
  createdAt: number;
  createdBy: string;
  expiresAt: number | null;
};

export type ErrorRow = {
  fingerprint: string;
  source: "server" | "client" | "job" | "provider";
  message: string;
  stack: string | null;
  context: Record<string, unknown>;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
};

export type AlertRow = {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
  context: Record<string, unknown>;
  createdAt: number;
  acknowledgedAt: number | null;
};

export type JobStatusRow = {
  lastRunAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  runs: number;
  failures: number;
  lastDurationMs: number | null;
};

export type ProviderStatusRow = {
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  calls: number;
  failures: number;
};

export type OutboxEmailRow = {
  id: string;
  to: string;
  subject: string;
  text: string;
  category: "transactional" | "marketing";
  template: string;
  status: "queued" | "sent" | "failed" | "suppressed";
  attempts: number;
  createdAt: number;
  sentAt: number | null;
  error: string | null;
};
