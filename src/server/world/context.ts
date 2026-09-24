import { MAX_NOTIFICATIONS_PER_HOUR } from "@/lib/shared/constants";
import { hashString, newId } from "@/lib/shared/random";
import type { AlertRow, NotificationKind, NotificationPrefs } from "@/lib/shared/types";
import { errorFields, log } from "../log";
import { enqueueNotificationEmail } from "../email/outbox";
import { flagEnabled } from "./flags";
import type { WorldState } from "./state";

export type Ctx = {
  state: WorldState;
  /** Current world time in epoch ms (compressed in demo worlds). */
  now: () => number;
};

export function worldNow(state: WorldState, realNow: number): number {
  const { epochReal, epochWorld, scale } = state.clock;
  return epochWorld + (realNow - epochReal) * scale;
}

export function audit(
  ctx: Ctx,
  entry: { actor: string | null; action: string; entityType: string; entityId: string; metadata?: Record<string, unknown> },
) {
  const logs = ctx.state.auditLogs;
  logs.push({
    id: newId("aud"),
    actor: entry.actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata ?? {},
    createdAt: ctx.now(),
  });
  if (logs.length > 50_000) logs.splice(0, logs.length - 50_000);
}

const EVENT_CAP = 50_000;

/** First-party product analytics event (§39). Taxonomy: docs/analytics-taxonomy.md. */
export function track(ctx: Ctx, name: string, userId: string | null, properties: Record<string, unknown> = {}) {
  const events = ctx.state.events;
  events.push({ id: newId("evt"), name, userId, properties, createdAt: ctx.now() });
  if (events.length > EVENT_CAP) events.splice(0, events.length - EVENT_CAP);
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  priceMoves: true,
  closingSoon: true,
  marketOpened: true,
  emailSettlement: true,
  emailMarketOpened: false,
  emailProduct: false,
};

/** Kinds a user can turn off, and kinds that stop when the `notifications` flag is off. */
const OPTIONAL_KINDS: Partial<Record<NotificationKind, keyof NotificationPrefs>> = {
  PRICE_MOVE: "priceMoves",
  POSITION_DOWN: "priceMoves",
  SPIKE: "priceMoves",
  CLOSING: "closingSoon",
  MARKET_OPENED: "marketOpened",
};

/**
 * In-app notification (§29) with spam protection: optional kinds respect preferences, the global
 * flag and an hourly cap, and an identical notification within 10 minutes is dropped.
 */
export function notify(
  ctx: Ctx,
  n: { userId: string; kind: NotificationKind; title: string; body: string; marketId: string | null },
) {
  const user = ctx.state.users[n.userId];
  if (!user || user.isBot || user.status === "deleted") return;
  const now = ctx.now();
  const pref = OPTIONAL_KINDS[n.kind];
  if (pref) {
    const prefs = user.notificationPrefs ?? DEFAULT_NOTIFICATION_PREFS;
    if (!prefs[pref] || !flagEnabled(ctx, "notifications")) return;
  }
  const recent = ctx.state.notifications.filter((x) => x.userId === n.userId && x.createdAt > now - 3_600_000);
  if (recent.some((x) => x.kind === n.kind && x.marketId === n.marketId && x.title === n.title && x.createdAt > now - 600_000)) return;
  if (pref && recent.length >= MAX_NOTIFICATIONS_PER_HOUR) return;
  ctx.state.notifications.push({ id: newId("ntf"), read: false, createdAt: now, ...n });
  const list = ctx.state.notifications;
  if (list.length > 100_000) list.splice(0, list.length - 100_000);
  enqueueNotificationEmail(ctx, user, n);
}

export function flagRisk(
  ctx: Ctx,
  f: { entityType: "market" | "user"; entityId: string; reason: string; severity: number; metadata?: Record<string, unknown> },
) {
  const now = ctx.now();
  // Don't stack identical open flags: the queue should show one row per problem.
  const dup = ctx.state.riskFlags.find(
    (r) => r.entityType === f.entityType && r.entityId === f.entityId && r.reason === f.reason && (r.status ?? "open") === "open" && now - r.createdAt < 6 * 3_600_000,
  );
  if (dup) {
    dup.severity = Math.max(dup.severity, f.severity);
  } else {
    ctx.state.riskFlags.push({
      id: newId("risk"),
      entityType: f.entityType,
      entityId: f.entityId,
      reason: f.reason,
      severity: f.severity,
      metadata: f.metadata ?? {},
      createdAt: now,
      status: "open",
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
    });
  }
  if (f.entityType === "market") {
    const m = ctx.state.markets[f.entityId];
    if (m) m.riskScore = Math.max(m.riskScore, f.severity);
  } else {
    const u = ctx.state.users[f.entityId];
    if (u) u.riskScore = Math.max(u.riskScore ?? 0, f.severity);
  }
}

// ---------------------------------------------------------------------------
// Observability (§42): errors, alerts, jobs, providers
// ---------------------------------------------------------------------------

type PendingAlert = Pick<AlertRow, "severity" | "message" | "context">;
const g = globalThis as unknown as { __wesifyAlerts?: PendingAlert[] };
/** Alerts waiting to be sent to ALERT_WEBHOOK_URL (flushed after the response, see http.ts). */
export const pendingAlerts: PendingAlert[] = (g.__wesifyAlerts ??= []);

/** Records an alert for the founders (§42 "alerting to founders"). Same message is sent at most hourly. */
export function raiseAlert(ctx: Ctx, severity: AlertRow["severity"], message: string, context: Record<string, unknown> = {}) {
  const now = ctx.now();
  const alerts = ctx.state.alerts;
  const recent = alerts.find((a) => a.message === message && now - a.createdAt < 3_600_000);
  if (recent) return recent;
  const row: AlertRow = { id: newId("alr"), severity, message, context, createdAt: now, acknowledgedAt: null };
  alerts.push(row);
  if (alerts.length > 2000) alerts.splice(0, alerts.length - 2000);
  if (ctx.state.kind === "main") pendingAlerts.push({ severity, message, context });
  log[severity === "critical" ? "error" : severity === "warning" ? "warn" : "info"](`alert: ${message}`, context);
  return row;
}

/** Error tracking (§42): grouped by fingerprint with counts, so a repeating error is one row. */
export function captureError(ctx: Ctx, source: "server" | "client" | "job" | "provider", err: unknown, context: Record<string, unknown> = {}) {
  const { error, stack } = errorFields(err);
  const message = error.slice(0, 500);
  const fingerprint = `${source}:${hashString(`${source}|${message.replace(/\d+/g, "#")}`)}`;
  const now = ctx.now();
  const errors = (ctx.state.errors ??= {});
  const existing = errors[fingerprint];
  if (existing) {
    existing.count++;
    existing.lastSeenAt = now;
    existing.context = context;
  } else {
    errors[fingerprint] = { fingerprint, source, message, stack: stack ?? null, context, count: 1, firstSeenAt: now, lastSeenAt: now };
    if (source !== "client") raiseAlert(ctx, "warning", `New ${source} error: ${message}`, { fingerprint });
  }
  const keys = Object.keys(errors);
  if (keys.length > 500) {
    const oldest = keys.sort((a, b) => errors[a].lastSeenAt - errors[b].lastSeenAt).slice(0, keys.length - 500);
    for (const k of oldest) delete errors[k];
  }
  if (source !== "client") log.error(`${source} error`, { message, ...context });
}

/** Wraps a background job so its runs, failures and duration show in admin health (§42). */
export async function runJob<T>(ctx: Ctx, name: string, fn: () => Promise<T> | T): Promise<T | undefined> {
  const jobs = (ctx.state.jobs ??= {});
  const row = (jobs[name] ??= { lastRunAt: null, lastSuccessAt: null, lastError: null, lastErrorAt: null, runs: 0, failures: 0, lastDurationMs: null });
  const started = Date.now();
  row.lastRunAt = ctx.now();
  row.runs++;
  try {
    const out = await fn();
    row.lastSuccessAt = ctx.now();
    return out;
  } catch (err) {
    row.failures++;
    row.lastError = errorFields(err).error;
    row.lastErrorAt = ctx.now();
    captureError(ctx, "job", err, { job: name });
    return undefined;
  } finally {
    row.lastDurationMs = Date.now() - started;
  }
}

/** Provider health (§16): consecutive failures raise an alert and appear in admin. */
export function recordProviderCall(ctx: Ctx, provider: string, ok: boolean, error?: string) {
  const providers = (ctx.state.providers ??= {});
  const row = (providers[provider] ??= { lastSuccessAt: null, lastFailureAt: null, lastError: null, consecutiveFailures: 0, calls: 0, failures: 0 });
  row.calls++;
  if (ok) {
    row.lastSuccessAt = ctx.now();
    row.consecutiveFailures = 0;
    return;
  }
  row.failures++;
  row.consecutiveFailures++;
  row.lastFailureAt = ctx.now();
  row.lastError = error ?? null;
  if (row.consecutiveFailures === 3 || row.consecutiveFailures % 50 === 0) {
    raiseAlert(ctx, "critical", `Provider ${provider} is failing (${row.consecutiveFailures} in a row)`, { error });
  }
}
