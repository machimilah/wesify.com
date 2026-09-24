import type {
  AlertRow,
  AnalyticsEventRow,
  AuditLogRow,
  CreatorApplicationRow,
  CreatorVideoRow,
  ErrorRow,
  FeedbackRow,
  ForecastRow,
  InviteRow,
  JobStatusRow,
  LedgerRow,
  MarketRow,
  NotificationRow,
  OutboxEmailRow,
  OutcomeRow,
  Platform,
  PositionRow,
  PricePointRow,
  ProviderStatusRow,
  ReferralRow,
  RiskFlagRow,
  SessionRow,
  SettlementRow,
  SnapshotRow,
  SocialAccountRow,
  SupportTicketRow,
  TradeRow,
  UserRow,
  VideoRow,
} from "@/lib/shared/types";

export type PositionEvent = {
  id: string;
  userId: string;
  marketId: string;
  outcomeId: string;
  kind: "SELL" | "SETTLE" | "REFUND";
  pnl: number;
  won: boolean | null;
  entryPrice: number;
  exitPrice: number;
  createdAt: number;
};

export type WorldKind = "main" | "demo";

/** Feature flag (§57). `rollout` (0–100) releases a flag to a stable share of users. */
export type FlagRow = { enabled: boolean; rollout: number; value: number | null; updatedAt: number; updatedBy: string | null };

/** Stored result of an idempotent request (§8), keyed `${userId}:${key}`. */
export type IdempotencyRow = { createdAt: number; route: string; status: number; body: unknown };

/** One visit (a burst of activity with < 30 minutes between requests), for session analytics (§39). */
export type VisitRow = { id: string; userId: string | null; startedAt: number; lastAt: number; marketViews: number };

export const SCHEMA_VERSION = 3;

export type WorldState = {
  version: 1;
  /** Migration level of this state (see `migrate`). */
  schemaVersion?: number;
  kind: WorldKind;
  /** world time = epochWorld + (realNow − epochReal) × scale */
  clock: { epochReal: number; epochWorld: number; scale: number };
  users: Record<string, UserRow>;
  usernames: Record<string, string>;
  /** lowercase email → userId (unique, §4 "prevent duplicate email accounts"). */
  emails: Record<string, string>;
  sessions: Record<string, SessionRow>;
  socialAccounts: SocialAccountRow[];
  videos: Record<string, VideoRow>;
  videoKeys: Record<string, string>; // `${platform}:${platformVideoId}` → videoId (unique)
  snapshots: Record<string, SnapshotRow[]>; // videoId → sorted by capturedAt
  markets: Record<string, MarketRow>;
  outcomes: Record<string, OutcomeRow[]>; // marketId → sorted by sortOrder
  trades: TradeRow[];
  positions: Record<string, PositionRow>; // `${userId}|${marketId}|${outcomeId}` (unique)
  positionEvents: PositionEvent[];
  priceHistory: Record<string, PricePointRow[]>; // marketId → sorted by recordedAt
  settlements: Record<string, SettlementRow>; // marketId → row (unique per market)
  ledger: LedgerRow[];
  auditLogs: AuditLogRow[];
  notifications: NotificationRow[];
  riskFlags: RiskFlagRow[];
  events: AnalyticsEventRow[];
  /** Per-market bookkeeping that is not part of the public schema. */
  marketFlags: Record<string, { closingNotified?: boolean; lastSpikeNotifiedAt?: number; pruned?: boolean; openedNotified?: boolean }>;
  /** Creator uploads being watched for eligibility (creator mode). */
  creatorVideos: Record<string, CreatorVideoRow>;
  /** Creator program applications, one row per application (a user may reapply after a rejection). */
  creatorApplications: Record<string, CreatorApplicationRow>;
  /** Pending OAuth connects, keyed by the random `state` parameter. Single use, short-lived. */
  oauthStates: Record<string, { userId: string; platform: Platform; createdAt: number }>;
  // ---- V1 launch readiness ----
  /** Single-use email tokens (verification, password reset), keyed by sha256(token). */
  emailTokens: Record<string, { userId: string; kind: "verify" | "reset"; expiresAt: number; usedAt: number | null }>;
  idempotency: Record<string, IdempotencyRow>;
  featureFlags: Record<string, FlagRow>;
  forecasts: Record<string, ForecastRow[]>;
  supportTickets: Record<string, SupportTicketRow>;
  feedback: FeedbackRow[];
  referrals: ReferralRow[];
  invites: Record<string, InviteRow>;
  errors: Record<string, ErrorRow>;
  alerts: AlertRow[];
  jobs: Record<string, JobStatusRow>;
  providers: Record<string, ProviderStatusRow>;
  outbox: OutboxEmailRow[];
  /** deviceId → users and hashed IPs seen with it (related-account detection, §27). */
  devices: Record<string, { userIds: string[]; ipHashes: string[]; firstSeenAt: number; lastSeenAt: number }>;
  /** Recent signups for farm detection (§28): hashed IP + device, pruned after a day. */
  signups: { at: number; ipHash: string | null; deviceId: string | null; userId: string }[];
  /** userId → YYYY-MM-DD days with activity (DAU/WAU/MAU and retention, §40). */
  activity: Record<string, string[]>;
  visits: Record<string, VisitRow>;
};

type Migration = { to: number; up: (s: WorldState) => void };

/**
 * Versioned migrations (§34). Each runs once, in order, on a state file older than its version.
 * Add a new entry (never edit an old one) when the stored shape changes.
 */
const MIGRATIONS: Migration[] = [
  {
    // v2: creator mode tables.
    to: 2,
    up: (s) => {
      s.creatorVideos ??= {};
      s.creatorApplications ??= {};
      s.oauthStates ??= {};
      s.socialAccounts ??= [];
    },
  },
  {
    // v3: V1 launch readiness — PAUSED status, identity fields, and the new operational tables.
    to: 3,
    up: (s) => {
      s.emails ??= {};
      s.emailTokens ??= {};
      s.idempotency ??= {};
      s.featureFlags ??= {};
      s.forecasts ??= {};
      s.supportTickets ??= {};
      s.feedback ??= [];
      s.referrals ??= [];
      s.invites ??= {};
      s.errors ??= {};
      s.alerts ??= [];
      s.jobs ??= {};
      s.providers ??= {};
      s.outbox ??= [];
      s.devices ??= {};
      s.signups ??= [];
      s.activity ??= {};
      s.visits ??= {};
      for (const m of Object.values(s.markets) as (MarketRow & { tradingPaused?: boolean })[]) {
        // tradingPaused was a flag on OPEN markets; it's now a real lifecycle state.
        if (m.tradingPaused && m.status === "OPEN") m.status = "PAUSED";
        delete m.tradingPaused;
        m.source ??= m.creatorUserId ? "creator" : m.createdByUserId ? "paste" : "system";
      }
      for (const u of Object.values(s.users)) {
        u.role ??= "user";
        u.status ??= "active";
        if (u.email) s.emails[u.email.toLowerCase()] = u.id;
      }
      for (const f of s.riskFlags) f.status ??= "open";
    },
  },
];

/** Brings a loaded state up to SCHEMA_VERSION. Idempotent. */
export function migrate(state: WorldState): WorldState {
  let v = state.schemaVersion ?? 1;
  for (const m of MIGRATIONS) {
    if (v < m.to) {
      m.up(state);
      v = m.to;
    }
  }
  state.schemaVersion = SCHEMA_VERSION;
  return state;
}

/** @deprecated use migrate(); kept for callers that predate versioned migrations. */
export const upgradeState = migrate;

export function emptyState(kind: WorldKind, clock: WorldState["clock"]): WorldState {
  return {
    version: 1,
    schemaVersion: SCHEMA_VERSION,
    kind,
    clock,
    users: {},
    usernames: {},
    emails: {},
    sessions: {},
    socialAccounts: [],
    videos: {},
    videoKeys: {},
    snapshots: {},
    markets: {},
    outcomes: {},
    trades: [],
    positions: {},
    positionEvents: [],
    priceHistory: {},
    settlements: {},
    ledger: [],
    auditLogs: [],
    notifications: [],
    riskFlags: [],
    events: [],
    marketFlags: {},
    creatorVideos: {},
    creatorApplications: {},
    oauthStates: {},
    emailTokens: {},
    idempotency: {},
    featureFlags: {},
    forecasts: {},
    supportTickets: {},
    feedback: [],
    referrals: [],
    invites: {},
    errors: {},
    alerts: [],
    jobs: {},
    providers: {},
    outbox: [],
    devices: {},
    signups: [],
    activity: {},
    visits: {},
  };
}

export const positionKey = (userId: string, marketId: string, outcomeId: string) =>
  `${userId}|${marketId}|${outcomeId}`;
