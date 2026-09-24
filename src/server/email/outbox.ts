import { MAX_EMAILS_PER_DAY } from "@/lib/shared/constants";
import { newId } from "@/lib/shared/random";
import type { NotificationKind, OutboxEmailRow, UserRow } from "@/lib/shared/types";
import { log } from "../log";
import { hmac } from "../secrets";
import type { Ctx } from "../world/context";
import { flagEnabled } from "../world/flags";

/**
 * Email (checklist §50). Emails are queued in world state first, then sent after the response by
 * `flushOutbox` (http.ts uses next/server `after`). Queuing inside the synchronous mutation means a
 * failed request never sends a half-finished email, and failed sends are retried.
 *
 * Transactional mail (verification, password reset, settlement results the user opted into) never
 * needs marketing consent. Marketing mail (product news) requires `consent.marketing` and always
 * carries a one-click unsubscribe link.
 */

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function unsubscribeUrl(userId: string, group: "marketing" | "notifications"): string {
  const payload = `${userId}.${group}`;
  return `${appUrl()}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&g=${group}&s=${hmac(`unsub:${payload}`)}`;
}

type Template =
  | { template: "verify"; token: string }
  | { template: "reset"; token: string }
  | { template: "welcome" }
  | { template: "password-changed" }
  | { template: "account-deleted" }
  | { template: "notification"; title: string; body: string; marketId: string | null }
  | { template: "support-reply"; subject: string; body: string };

function render(user: Pick<UserRow, "id" | "username">, t: Template): { subject: string; text: string; category: OutboxEmailRow["category"] } {
  const base = appUrl();
  const footer = "\n\n—\nWesify · Play money only. Wesify Credits have no monetary value.\nQuestions? Reply to this email or visit " + `${base}/support`;
  switch (t.template) {
    case "verify":
      return {
        subject: "Confirm your email for Wesify",
        text: `Hi ${user.username},\n\nConfirm your email address so you can recover your account and receive settlement results:\n\n${base}/verify-email?token=${encodeURIComponent(t.token)}\n\nThe link works for 48 hours. If you didn't sign up, ignore this email.${footer}`,
        category: "transactional",
      };
    case "reset":
      return {
        subject: "Reset your Wesify password",
        text: `Hi ${user.username},\n\nSomeone (hopefully you) asked to reset your password. Choose a new one here:\n\n${base}/reset-password?token=${encodeURIComponent(t.token)}\n\nThe link works for 1 hour and only once. If you didn't ask for this, you can ignore this email; your password hasn't changed.${footer}`,
        category: "transactional",
      };
    case "welcome":
      return {
        subject: "Welcome to Wesify",
        text: `Hi ${user.username},\n\nYou have W$10,000 in play money. Pick a video, choose where its likes will land after 24 hours, and sell any time before trading closes.\n\nStart here: ${base}/\n\nW$ is play money: it has no monetary value and can't be redeemed.${footer}`,
        category: "transactional",
      };
    case "password-changed":
      return {
        subject: "Your Wesify password was changed",
        text: `Hi ${user.username},\n\nYour password was just changed and your other sessions were signed out. If this wasn't you, reset your password now at ${base}/forgot-password and contact ${process.env.SUPPORT_EMAIL ?? "support"}.${footer}`,
        category: "transactional",
      };
    case "account-deleted":
      return {
        subject: "Your Wesify account was deleted",
        text: `Your Wesify account and its personal data have been deleted. Trade records are kept in anonymized form so market results stay correct.\n\nIf you didn't ask for this, contact ${process.env.SUPPORT_EMAIL ?? "support"} right away.${footer}`,
        category: "transactional",
      };
    case "notification":
      return {
        subject: t.title,
        text: `${t.title}\n\n${t.body}\n\n${t.marketId ? `${base}/markets/${t.marketId}` : base}\n\nChange which emails you get: ${base}/settings\nStop notification emails: ${unsubscribeUrl(user.id, "notifications")}${footer}`,
        category: "transactional",
      };
    case "support-reply":
      return { subject: t.subject, text: `${t.body}${footer}`, category: "transactional" };
  }
}

export function enqueueEmail(ctx: Ctx, user: Pick<UserRow, "id" | "username" | "email">, t: Template, opts: { toOverride?: string } = {}) {
  const to = opts.toOverride ?? user.email;
  if (!to || ctx.state.kind !== "main") return null;
  const { subject, text, category } = render(user, t);
  const now = ctx.now();
  const sentToday = ctx.state.outbox.filter((e) => e.to === to && e.template === "notification" && now - e.createdAt < 86_400_000).length;
  const row: OutboxEmailRow = {
    id: newId("eml"),
    to,
    subject,
    text,
    category,
    template: t.template,
    status: t.template === "notification" && sentToday >= MAX_EMAILS_PER_DAY ? "suppressed" : "queued",
    attempts: 0,
    createdAt: now,
    sentAt: null,
    error: null,
  };
  ctx.state.outbox.push(row);
  if (ctx.state.outbox.length > 5000) ctx.state.outbox.splice(0, ctx.state.outbox.length - 5000);
  return row;
}

const EMAIL_KINDS: Partial<Record<NotificationKind, "emailSettlement" | "emailMarketOpened">> = {
  SETTLEMENT: "emailSettlement",
  CANCELLED: "emailSettlement",
  MARKET_OPENED: "emailMarketOpened",
};

/** Mirrors selected notifications to email for verified users who opted in. */
export function enqueueNotificationEmail(ctx: Ctx, user: UserRow, n: { kind: NotificationKind; title: string; body: string; marketId: string | null }) {
  const pref = EMAIL_KINDS[n.kind];
  if (!pref || !user.email || !user.emailVerifiedAt) return;
  if (!(user.notificationPrefs?.[pref] ?? pref === "emailSettlement")) return;
  if (!flagEnabled(ctx, "emailNotifications")) return;
  enqueueEmail(ctx, user, { template: "notification", title: n.title, body: n.body, marketId: n.marketId });
}

/**
 * Sends queued email. With RESEND_API_KEY set it uses Resend's HTTP API; otherwise (development)
 * the message is logged and marked sent so links can be copied from the console or /admin.
 */
export async function flushOutbox(ctx: Ctx, limit = 20): Promise<{ sent: number; failed: number }> {
  const queued = ctx.state.outbox.filter((e) => e.status === "queued" && e.attempts < 5).slice(0, limit);
  let sent = 0;
  let failed = 0;
  for (const e of queued) {
    e.attempts++;
    try {
      await deliver(e);
      e.status = "sent";
      e.sentAt = ctx.now();
      e.error = null;
      sent++;
    } catch (err) {
      e.error = err instanceof Error ? err.message : String(err);
      if (e.attempts >= 5) e.status = "failed";
      failed++;
    }
  }
  return { sent, failed };
}

async function deliver(e: OutboxEmailRow) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    log.info("email (dev, not sent)", { to: e.to, subject: e.subject, text: e.text.split("\n").find((l) => l.startsWith("http")) ?? "" });
    return;
  }
  const from = e.category === "marketing" ? process.env.EMAIL_FROM_MARKETING ?? process.env.EMAIL_FROM : process.env.EMAIL_FROM;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [e.to], subject: e.subject, text: e.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Email provider returned ${res.status}`);
}
