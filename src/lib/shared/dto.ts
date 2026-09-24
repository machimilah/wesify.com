import type { CancelReason, LedgerType, MarketStatus, MomentumLabel, NotificationPrefs, NotificationRow, Platform, UserRole, UserStatus } from "./types";

export type WorldMeta = { kind: "main" | "demo"; worldNow: number; scale: number };

export type VideoDTO = {
  id: string;
  platform: Platform;
  platformName: string;
  creatorHandle: string;
  /** Display name reported by the platform, for attribution (§17). */
  authorName: string | null;
  caption: string;
  canonicalUrl: string;
  thumbnailHue: number;
  /** Platform-permitted thumbnail, linked not re-hosted; null → placeholder. */
  thumbnailUrl: string | null;
  publishedAt: number;
  simulated: boolean;
};

export type OutcomeDTO = {
  id: string;
  label: string;
  price: number;
  modelProbability: number;
  /** Change in probability over the last hour, as a fraction (0.09 = +9 points). */
  change1h: number | null;
  change3h: number | null;
  sparkline: number[];
};

export type MarketCardDTO = {
  id: string;
  status: MarketStatus;
  video: VideoDTO;
  currentLikes: number;
  /** Likes per minute over the last 30 minutes. */
  likesPerMinute: number;
  momentum: { label: MomentumLabel; score: number; change3h: number };
  openedAt: number;
  locksAt: number;
  settlesAt: number;
  topOutcomes: OutcomeDTO[];
  /** Largest absolute 1h probability move across outcomes (biggest movers sort). */
  biggestMove1h: number;
  volume: number;
  traders: number;
  feedScore: number;
  pausedReason: string | null;
  featured: boolean;
  /** World time of the newest like reading (§38 "timestamp last update"). */
  lastMetricAt: number;
};

export type PositionDTO = {
  id: string;
  marketId: string;
  outcomeId: string;
  outcomeLabel: string;
  shares: number;
  averageEntryPrice: number;
  currentPrice: number;
  value: number;
  costBasis: number;
  unrealizedPnl: number;
  realizedPnl: number;
  status: "OPEN" | "CLOSED" | "SETTLED" | "CANCELLED";
  settlement: { won: boolean; payout: number; costBasis: number; pnl: number } | null;
  closedAt: number | null;
  market: {
    id: string;
    status: MarketStatus;
    creatorHandle: string;
    caption: string;
    thumbnailHue: number;
    thumbnailUrl: string | null;
    videoId: string;
    settlesAt: number;
    locksAt: number;
    winningLabel: string | null;
    finalMetric: number | null;
  };
};

export type TradeDTO = {
  id: string;
  marketId: string;
  creatorHandle: string;
  outcomeLabel: string;
  side: "BUY" | "SELL";
  shares: number;
  price: number;
  credits: number;
  realizedPnl: number;
  createdAt: number;
};

export type MarketDetailDTO = MarketCardDTO & {
  question: string;
  /** LMSR b — lets the client quote exact fills from price alone. */
  liquidity: number;
  outcomes: OutcomeDTO[];
  finalMetric: number | null;
  winningOutcomeId: string | null;
  tradingPaused: boolean;
  positions: PositionDTO[];
  limits: { maxBuy: number; maxPerTrade: number; maxMoreInMarket: number } | null;
  /** The viewer created this market or it's on their own video, so they can't buy into it. */
  isOwnMarket: boolean;
  balance: number | null;
  likesHistory: { t: number; likes: number }[];
  recentTrades: { side: "BUY" | "SELL"; outcomeLabel: string; credits: number; username: string; isBot: boolean; createdAt: number }[];
  /** Plain-English settlement definition and where the number comes from (§7). */
  settlementDefinition: string;
  dataSource: string;
  rulesVersion: string;
  rangeExplanation: string | null;
  /** SETTLING stage shown to users: waiting for the number, or for a reviewer. */
  settlementStage: "awaiting_metric" | "awaiting_review" | null;
  cancellation: { reason: CancelReason; label: string; explanation: string; at: number } | null;
  /** DRAFT submissions: review state for the person who submitted it. */
  review: { submittedAt: number; decidedAt: number | null; note: string | null } | null;
  tradingEnabled: boolean;
  sellingEnabled: boolean;
};

export type HistoryDTO = { outcomes: { id: string; label: string }[]; points: { t: number; prices: number[] }[] };

export type ClientFlags = {
  trading: boolean;
  selling: boolean;
  registrations: boolean;
  marketCreation: boolean;
  leaderboard: boolean;
  referrals: boolean;
  inviteOnly: boolean;
  globalPause: boolean;
  firstTradeTutorial: boolean;
};

export type MeDTO = {
  id: string;
  username: string;
  balance: number;
  avatarHue: number;
  createdAt: number;
  referralCode: string;
  unreadNotifications: number;
  email: string | null;
  emailVerified: boolean;
  role: UserRole;
  status: UserStatus;
  onboardingCompleted: boolean;
  tutorialCompleted: boolean;
  hasPassword: boolean;
  authProvider: "local" | "clerk" | "demo";
  consent: { analytics: boolean; marketing: boolean } | null;
  /** True for accounts created before V1 identity (no email or accepted terms yet). */
  needsAccountUpgrade: boolean;
};

export type AuthConfigDTO = {
  provider: "local" | "clerk";
  /** Cloudflare Turnstile site key, when bot protection is configured. */
  turnstileSiteKey: string | null;
  flags: ClientFlags;
};

export type PortfolioDTO = {
  balance: number;
  openValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  accuracy: number | null;
  open: PositionDTO[];
  settled: PositionDTO[];
  closed: PositionDTO[];
  trades: TradeDTO[];
};

export type ProfileDTO = {
  username: string;
  avatarHue: number;
  joinedAt: number;
  balance: number;
  marketsTraded: number;
  totalTrades: number;
  winRate: number | null;
  accuracy: number | null;
  realizedPnl: number;
  bestTrade: { pnl: number; outcomeLabel: string; creatorHandle: string; marketId: string } | null;
  streak: number;
  referralCode: string;
  rank: number | null;
  connectedAccounts: { id: string; platform: Platform; handle: string; mode: "live" | "simulated"; status: "active" | "error" }[];
};

export type WalletEntryDTO = {
  id: string;
  type: LedgerType;
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: number;
  marketId: string | null;
};

export type WalletDTO = {
  balance: number;
  ledgerBalance: number;
  reconciled: boolean;
  totals: Partial<Record<LedgerType, number>>;
  entries: WalletEntryDTO[];
  nextCursor: number | null;
};

export type LeaderboardPeriod = "today" | "7d" | "all";

export type LeaderboardRowDTO = {
  rank: number;
  username: string;
  isBot: boolean;
  score: number;
  realizedProfit: number;
  accuracy: number;
  trades: number;
  markets: number;
  isMe: boolean;
  badges: string[];
};

export type LeaderboardDTO = {
  period: LeaderboardPeriod;
  rows: LeaderboardRowDTO[];
  me: (LeaderboardRowDTO & { eligible: boolean; tradesNeeded: number; marketsNeeded: number }) | null;
  methodology: string[];
  computedAt: number;
};

export type NotificationDTO = Omit<NotificationRow, "userId">;

export type ShareCardDTO = {
  username: string;
  creatorHandle: string;
  outcomeLabel: string;
  entryPrice: number;
  latestPrice: number;
  status: PositionDTO["status"];
  won: boolean | null;
  marketId: string;
};

export type CreatorPlatformDTO = "tiktok" | "instagram" | "youtube";

export type CreatorAccountDTO = {
  id: string;
  platform: CreatorPlatformDTO;
  handle: string;
  mode: "live" | "simulated";
  status: "active" | "error";
  statusMessage: string | null;
  followerCount: number;
  threshold: number;
  lastSyncedAt: number | null;
  hasRunningMarket: boolean;
};

export type CreatorVideoDTO = {
  id: string;
  accountId: string;
  platform: CreatorPlatformDTO;
  handle: string;
  caption: string;
  canonicalUrl: string;
  publishedAt: number;
  /** When the 6-hour window to open a market closes. */
  windowEndsAt: number;
  likes: number;
  threshold: number;
  followerCount: number;
  status: "tracking" | "eligible" | "market_created" | "expired" | "dismissed";
  marketId: string | null;
};

export type CreatorProgramDTO = {
  /** none: never applied · pending: waiting on review · rejected · unsigned: approved, agreement not signed · active · revoked */
  state: "none" | "pending" | "rejected" | "unsigned" | "active" | "revoked";
  /** When a rejected applicant may apply again. */
  canApplyAt: number | null;
  application: {
    id: string;
    /** As typed by the applicant, e.g. "TikTok", "YouTube Shorts", "Twitch". */
    platform: string;
    handle: string;
    followerCount: number;
    submittedAt: number;
    decidedAt: number | null;
    decisionNote: string | null;
  } | null;
  contract: { version: string; terms: string[]; signedAt: number | null; signedName: string | null; signedVersion: string | null };
};

export type CreatorMarketStatsDTO = {
  marketId: string;
  handle: string;
  status: MarketStatus;
  openedAt: number;
  volume: number;
  traders: number;
  trades: number;
  /** "Watch original" clicks: traffic Wesify sent back to the platform (§31). */
  originalOpens: number;
};

export type CreatorOverviewDTO = {
  program: CreatorProgramDTO;
  platforms: { platform: CreatorPlatformDTO; name: string; mode: "live" | "simulated"; connected: boolean }[];
  accounts: CreatorAccountDTO[];
  videos: CreatorVideoDTO[];
  markets: CreatorMarketStatsDTO[];
  limit: { remaining: number; perWindow: number; windowHours: number; nextAvailableAt: number | null };
  rules: { likePercent: number; minFollowers: number; minLikes: number; maxAgeHours: number; syncMinutes: number };
};

export type AccountSettingsDTO = {
  username: string;
  email: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  authProvider: "local" | "clerk" | "demo";
  notificationPrefs: NotificationPrefs;
  showOnLeaderboard: boolean;
  consent: { analytics: boolean; marketing: boolean } | null;
  termsAcceptedAt: number | null;
  termsVersion: string | null;
  ageConfirmedAt: number | null;
  sessions: { id: string; createdAt: number; lastSeenAt: number | null; userAgent: string | null; current: boolean }[];
  connectedAccounts: ProfileDTO["connectedAccounts"];
};

export type ApiError = { error: { code: string; message: string } };
