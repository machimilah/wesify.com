import fs from "node:fs";
import path from "node:path";
import { MIN_ACTIVE_MARKETS } from "@/lib/shared/constants";
import { CANCEL_REASONS } from "@/lib/shared/rules";
import { validateEnv, appEnv } from "../env";
import { latencySummary, processStartedAt } from "../http";
import { storeHealth, demoWorldCount } from "../store";
import type { Ctx } from "../world/context";
import { listFlags } from "../world/flags";
import { checkIntegrity } from "../world/integrity";
import { isFinal } from "../world/lifecycle";
import { marketStats } from "../world/queries";

const HOUR = 3_600_000;

export function marketsList(ctx: Ctx, opts: { q?: string; status?: string; limit?: number }) {
  const q = (opts.q ?? "").trim().toLowerCase().replace(/^@/, "");
  const { state } = ctx;
  return Object.values(state.markets)
    .filter((m) => {
      if (opts.status === "review") {
        if (!(m.status === "DRAFT" || (m.status === "SETTLING" && m.proposedSettlement))) return false;
      } else if (opts.status === "live") {
        if (isFinal(m.status) || m.status === "DRAFT") return false;
      } else if (opts.status && opts.status !== "all" && m.status !== opts.status) return false;
      if (!q) return true;
      const v = state.videos[m.videoId];
      return m.id.includes(q) || v.creatorHandle.toLowerCase().includes(q) || v.platformVideoId.includes(q) || v.canonicalUrl.toLowerCase().includes(q);
    })
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, Math.min(opts.limit ?? 150, 500))
    .map((m) => {
      const v = state.videos[m.videoId];
      const outcomes = state.outcomes[m.id];
      const stats = marketStats(ctx, m.id);
      return {
        id: m.id,
        videoId: v.id,
        creatorHandle: v.creatorHandle,
        canonicalUrl: v.canonicalUrl,
        provider: v.provider,
        scenario: v.scenario,
        source: m.source ?? "system",
        status: m.status,
        pausedReason: m.pausedReason,
        currentLikes: m.currentLikes,
        momentumLabel: m.momentumLabel,
        riskScore: m.riskScore,
        openedAt: m.openedAt,
        settlesAt: m.settlesAt,
        liquidity: m.liquidityParameter,
        finalMetric: m.finalMetric,
        featured: Boolean(m.featured),
        hidden: Boolean(m.hidden),
        prices: outcomes.map((o) => ({ label: o.label, price: o.currentPrice })),
        trades: stats.trades,
        traders: stats.traders,
        volume: stats.volume,
        proposal: m.proposedSettlement
          ? { ...m.proposedSettlement, winningLabel: outcomes.find((o) => o.id === m.proposedSettlement!.winningOutcomeId)?.label ?? null }
          : null,
        review: m.review ?? null,
        cancellation: m.cancellation ? { ...m.cancellation, label: CANCEL_REASONS[m.cancellation.reason].label } : null,
        submittedBy: m.createdByUserId ? state.users[m.createdByUserId]?.username ?? null : null,
        thumbnail: { url: v.thumbnailUrl ?? null, source: v.thumbnailSource ?? null, broken: Boolean(v.thumbnailBroken), expiresAt: v.thumbnailExpiresAt ?? null },
        simulatedAvailability: v.simulatedAvailability ?? "available",
      };
    });
}

/** Everything about one market for review: repricing log with large moves explained (§21). */
export function marketAdminDetail(ctx: Ctx, id: string) {
  const { state } = ctx;
  const m = state.markets[id];
  if (!m) return null;
  const outcomes = state.outcomes[m.id];
  const forecasts = state.forecasts?.[m.id] ?? [];
  const largeRepricings = forecasts
    .map((f) => ({ ...f, move: Math.max(...f.pricesAfter.map((p, i) => Math.abs(p - (f.pricesBefore[i] ?? p)))) }))
    .filter((f) => f.move >= 0.08 || f.capped)
    .slice(-30)
    .reverse()
    .map((f) => ({
      at: f.at,
      move: f.move,
      capped: f.capped,
      momentum: f.momentum,
      expectedFinalLikes: f.expectedFinalLikes,
      explanation: `${f.capped ? "Capped: " : ""}model expected ~${f.expectedFinalLikes.toLocaleString("en-US")} final likes (momentum ${f.momentum.toFixed(2)}); ${outcomes
        .map((o, i) => `${o.label} ${Math.round((f.pricesBefore[i] ?? 0) * 100)}→${Math.round((f.pricesAfter[i] ?? 0) * 100)}%`)
        .join(", ")}`,
    }));
  const snapshots = (state.snapshots[m.videoId] ?? []).slice(-40).map((s) => ({ t: s.capturedAt, likes: s.likes, source: s.source, suspicious: Boolean(s.suspicious) }));
  const positions = Object.values(state.positions)
    .filter((p) => p.marketId === id && (p.shares > 1e-9 || p.settlement))
    .map((p) => ({ user: state.users[p.userId]?.username, isBot: state.users[p.userId]?.isBot, outcome: outcomes.find((o) => o.id === p.outcomeId)?.label, shares: p.shares, avg: p.averageEntryPrice, settlement: p.settlement }));
  return {
    list: marketsList(ctx, { q: id, status: "all", limit: 1 })[0],
    outcomes: outcomes.map((o) => ({ id: o.id, label: o.label, min: o.minValue, max: o.maxValue, price: o.currentPrice, model: o.modelProbability, quantity: o.quantity })),
    rangeBasis: m.rangeBasis ?? null,
    rulesVersion: m.rulesVersion ?? null,
    snapshots,
    largeRepricings,
    positions,
    flags: state.riskFlags.filter((f) => f.entityType === "market" && f.entityId === id).slice(-20).reverse(),
    audit: state.auditLogs.filter((a) => a.entityId === id).slice(-50).reverse(),
    settlement: state.settlements[id] ?? null,
  };
}

export function usersList(ctx: Ctx, opts: { q?: string; filter?: string }) {
  const q = (opts.q ?? "").trim().toLowerCase();
  return Object.values(ctx.state.users)
    .filter((u) => !u.isBot)
    .filter((u) => !q || u.username.includes(q) || (u.email ?? "").includes(q) || u.id === q)
    .filter((u) => (opts.filter === "flagged" ? (u.riskScore ?? 0) >= 0.3 : opts.filter === "restricted" ? u.status === "frozen" || u.status === "suspended" : true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 200)
    .map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email ?? null,
      emailVerified: Boolean(u.emailVerifiedAt),
      balance: u.creditsBalance,
      role: u.role ?? "user",
      status: u.status ?? "active",
      riskScore: u.riskScore ?? 0,
      cohort: u.cohort ?? null,
      createdAt: u.createdAt,
      lastActiveAt: u.lastActiveAt ?? null,
      trades: ctx.state.trades.filter((t) => t.userId === u.id).length,
    }));
}

export function userAdminDetail(ctx: Ctx, id: string) {
  const { state } = ctx;
  const u = state.users[id];
  if (!u) return null;
  const devices = Object.entries(state.devices ?? {}).filter(([, d]) => d.userIds.includes(id));
  const related = new Set<string>();
  for (const [, d] of devices) for (const other of d.userIds) if (other !== id) related.add(other);
  return {
    user: { ...u, passwordHash: u.passwordHash ? "(set)" : null },
    ledger: state.ledger.filter((l) => l.userId === id).slice(-200).reverse(),
    trades: state.trades
      .filter((t) => t.userId === id)
      .slice(-200)
      .reverse()
      .map((t) => ({ ...t, handle: state.videos[state.markets[t.marketId]?.videoId]?.creatorHandle, outcome: state.outcomes[t.marketId]?.find((o) => o.id === t.outcomeId)?.label })),
    positions: Object.values(state.positions).filter((p) => p.userId === id && p.shares > 1e-9),
    flags: state.riskFlags.filter((f) => f.entityType === "user" && f.entityId === id).reverse(),
    sessions: Object.values(state.sessions).filter((s) => s.userId === id).map((s) => ({ createdAt: s.createdAt, lastSeenAt: s.lastSeenAt ?? null, userAgent: s.userAgent ?? null })),
    relatedAccounts: [...related].map((r) => ({ id: r, username: state.users[r]?.username ?? "(gone)" })),
    tickets: Object.values(state.supportTickets).filter((t) => t.userId === id),
    connectedAccounts: state.socialAccounts.filter((a) => a.userId === id).map((a) => ({ platform: a.platform, handle: a.handle, status: a.status, mode: a.mode })),
    referrals: state.referrals.filter((r) => r.referrerId === id || r.refereeId === id),
    audit: state.auditLogs.filter((a) => a.entityId === id || a.actor === id).slice(-50).reverse(),
  };
}

export function healthReport(ctx: Ctx) {
  const now = ctx.now();
  const store = storeHealth();
  const env = validateEnv();
  let dataFileBytes = 0;
  let diskFreeBytes: number | null = null;
  try {
    dataFileBytes = fs.statSync(store.dataFile).size;
    const st = fs.statfsSync(path.dirname(store.dataFile));
    diskFreeBytes = st.bavail * st.bsize;
  } catch {
    /* not created yet */
  }
  const providerCalls = Object.values(ctx.state.providers ?? {}).reduce((s, p) => s + p.calls, 0);
  const emailsThisMonth = (ctx.state.outbox ?? []).filter((e) => e.status === "sent" && now - (e.sentAt ?? 0) < 30 * 24 * HOUR).length;
  return {
    appEnv: appEnv(),
    uptimeSec: Math.round((Date.now() - processStartedAt) / 1000),
    memoryMb: Math.round(process.memoryUsage().rss / 1e6),
    store: { ...store, dataFileBytes, diskFreeBytes },
    env: { ok: env.ok, errors: env.errors, warnings: env.warnings },
    jobs: Object.entries(ctx.state.jobs ?? {}).map(([name, j]) => ({ name, ...j })),
    providers: Object.entries(ctx.state.providers ?? {}).map(([name, p]) => ({ name, ...p })),
    errors: Object.values(ctx.state.errors ?? {}).sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, 50),
    alerts: (ctx.state.alerts ?? []).slice(-100).reverse(),
    latency: latencySummary().slice(0, 40),
    demoWorlds: demoWorldCount(),
    // Cost monitoring (§42, §70): usage counters to compare against provider bills and budgets.
    costs: {
      providerCalls,
      emailsSentLast30d: emailsThisMonth,
      stateBytes: dataFileBytes,
      monthlyBudgetUsd: process.env.MONTHLY_BUDGET_USD ? Number(process.env.MONTHLY_BUDGET_USD) : null,
    },
    outbox: (ctx.state.outbox ?? []).slice(-30).reverse().map((e) => ({ ...e, text: appEnv() === "production" ? undefined : e.text })),
  };
}

type Check = { id: string; section: string; label: string; ok: boolean; detail: string; manual?: boolean };

/**
 * The launch gate (§75) as live checks. Everything that can be verified automatically is; the rest
 * is listed as a manual check so nothing is forgotten. Launch when every row is green.
 */
export function launchGate(ctx: Ctx): { ready: boolean; checks: Check[] } {
  const { state } = ctx;
  const now = ctx.now();
  const integrity = checkIntegrity(state);
  const live = Object.values(state.markets).filter((m) => m.status === "OPEN" || m.status === "PAUSED");
  const creators = new Set(live.map((m) => state.videos[m.videoId]?.creatorHandle));
  const store = storeHealth();
  const flags = Object.fromEntries(listFlags(ctx).map((f) => [f.name, f]));
  const fresh = live.filter((m) => now - m.lastPricedAt < 20 * 60_000);
  const recentEvents = state.events.filter((e) => now - e.createdAt < 24 * HOUR).length;
  const errorsTracked = Object.keys(state.errors ?? {}).length > 0 || (state.jobs?.integrity?.runs ?? 0) > 0;
  const lastBackup = store.backups[0];
  const env = validateEnv();
  const openFlagsHigh = state.riskFlags.filter((f) => (f.status ?? "open") === "open" && f.severity >= 0.9).length;
  const checks: Check[] = [
    { id: "balances", section: "Trust", label: "No known balance corruption", ok: !integrity.issues.some((i) => /balance|ledger/.test(i.check)), detail: `${integrity.issues.filter((i) => /balance|ledger/.test(i.check)).length} balance issues` },
    { id: "settlement-dup", section: "Trust", label: "No known settlement duplication", ok: !integrity.issues.some((i) => /duplicate|payout/.test(i.check)), detail: `${integrity.issues.filter((i) => /duplicate|payout/.test(i.check)).length} settlement issues` },
    { id: "market-state", section: "Trust", label: "Market state reconstructs from trades", ok: !integrity.issues.some((i) => i.check === "market_state"), detail: `${integrity.issues.filter((i) => i.check === "market_state").length} mismatches` },
    { id: "security", section: "Trust", label: "No severe open security or integrity flags", ok: openFlagsHigh === 0 && env.ok, detail: `${openFlagsHigh} critical flags; env ${env.ok ? "valid" : env.errors.join("; ")}` },
    { id: "refresh", section: "Markets", label: "Market data refresh is reliable", ok: live.length > 0 && fresh.length / Math.max(1, live.length) >= 0.9, detail: `${fresh.length}/${live.length} live markets updated in the last 20 minutes` },
    { id: "supply", section: "Markets", label: `At least ${MIN_ACTIVE_MARKETS} live markets`, ok: live.length >= MIN_ACTIVE_MARKETS, detail: `${live.length} live` },
    { id: "diversity", section: "Markets", label: "Mix of creators in the feed", ok: creators.size >= Math.min(10, live.length), detail: `${creators.size} different creators` },
    { id: "pause-all", section: "Operations", label: "Admin can pause everything", ok: Boolean(flags.globalPause), detail: "globalPause flag and bulk pause are available" },
    { id: "cancel", section: "Operations", label: "Admin can cancel a market", ok: true, detail: "Cancel with reason codes and refunds" },
    { id: "support", section: "Operations", label: "Support channel is monitored", ok: Boolean(process.env.SUPPORT_EMAIL), detail: process.env.SUPPORT_EMAIL ?? "SUPPORT_EMAIL not set", manual: true },
    { id: "terms", section: "Legal", label: "Terms, Privacy Policy and W$ disclaimer live", ok: true, detail: "/terms, /privacy, /rules and footer disclaimer" },
    { id: "legal-review", section: "Legal", label: "Terms reviewed by counsel", ok: false, detail: "Manual: see docs/legal-review.md", manual: true },
    { id: "analytics", section: "Monitoring", label: "Analytics functioning", ok: recentEvents > 0, detail: `${recentEvents} events in the last 24h` },
    { id: "errors", section: "Monitoring", label: "Error monitoring functioning", ok: errorsTracked, detail: "Server, client and job errors are captured in Health" },
    { id: "alerts", section: "Monitoring", label: "Alerts reach the founders", ok: Boolean(process.env.ALERT_WEBHOOK_URL), detail: process.env.ALERT_WEBHOOK_URL ? "Webhook configured" : "ALERT_WEBHOOK_URL not set" },
    { id: "backups", section: "Monitoring", label: "Database backups functioning", ok: Boolean(lastBackup && Date.now() - lastBackup.createdAt < 2 * HOUR), detail: lastBackup ? `Last backup ${Math.round((Date.now() - lastBackup.createdAt) / 60_000)} min ago` : "No backup yet" },
    { id: "email", section: "Monitoring", label: "Email delivery configured", ok: Boolean(process.env.RESEND_API_KEY), detail: process.env.RESEND_API_KEY ? "Resend configured" : "Emails are only logged" },
    { id: "mobile", section: "Product", label: "Core mobile UX tested", ok: false, detail: "Manual: run docs/qa-checklist.md on iPhone Safari and Android Chrome", manual: true },
    { id: "first-trade", section: "Product", label: "First trade tested on people who didn't build the app", ok: false, detail: "Manual: private alpha, see docs/beta-program.md", manual: true },
  ];
  return { ready: checks.every((c) => c.ok), checks };
}
