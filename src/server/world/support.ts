import { newId } from "@/lib/shared/random";
import type { SupportCategory, SupportTicketRow } from "@/lib/shared/types";
import { enqueueEmail } from "../email/outbox";
import { audit, flagRisk, raiseAlert, track, type Ctx } from "./context";
import { Errors } from "./errors";

/**
 * Support desk (checklist §48) and reports (§49). Tickets carry a category, an optional entity (the
 * market, user or video being reported), a status and a reply thread. Security reports and reports
 * of market manipulation are high priority and alert the founders.
 */

export const SUPPORT_CATEGORIES: Record<SupportCategory, { label: string; public: boolean }> = {
  missing_credits: { label: "Missing W$", public: true },
  incorrect_trade: { label: "A trade looks wrong", public: true },
  market_dispute: { label: "Problem with a market", public: true },
  settlement_dispute: { label: "I disagree with a settlement", public: true },
  account_deletion: { label: "Delete my account", public: true },
  password_reset: { label: "Can't sign in / password", public: true },
  privacy_request: { label: "Privacy or data request", public: true },
  creator_takedown: { label: "Remove my video (creators)", public: true },
  abuse_report: { label: "Report abuse", public: true },
  report_user: { label: "Report a user", public: false },
  report_market: { label: "Report a market", public: false },
  appeal: { label: "Appeal a suspension or decision", public: true },
  security: { label: "Security issue", public: true },
  feedback: { label: "Feedback", public: true },
  other: { label: "Something else", public: true },
};

/** Stated response times (§48 "response-time expectation"), shown on the support page. */
export const RESPONSE_TIME = { normal: "within 2 business days", high: "within 24 hours" };

const HIGH_PRIORITY: SupportCategory[] = ["security", "settlement_dispute", "creator_takedown", "report_market", "missing_credits"];

export function createTicket(
  ctx: Ctx,
  input: { userId: string | null; email: string | null; category: SupportCategory; subject: string; body: string; entityType?: SupportTicketRow["entityType"]; entityId?: string | null },
) {
  const email = input.email?.trim().toLowerCase() || (input.userId ? ctx.state.users[input.userId]?.email : null) || null;
  if (!input.userId && !email) throw Errors.invalid("Add an email so we can reply.");
  const now = ctx.now();
  const priority = HIGH_PRIORITY.includes(input.category) ? "high" : "normal";
  const ticket: SupportTicketRow = {
    id: newId("tkt"),
    userId: input.userId,
    email,
    category: input.category,
    subject: input.subject.trim().slice(0, 200),
    body: input.body.trim().slice(0, 5000),
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    status: "open",
    priority,
    createdAt: now,
    updatedAt: now,
    replies: [],
  };
  ctx.state.supportTickets[ticket.id] = ticket;
  if (input.category === "report_user" && input.entityId && ctx.state.users[input.entityId]) {
    flagRisk(ctx, { entityType: "user", entityId: input.entityId, reason: "Reported by a user", severity: 0.3, metadata: { ticketId: ticket.id } });
  }
  if (input.category === "report_market" && input.entityId && ctx.state.markets[input.entityId]) {
    flagRisk(ctx, { entityType: "market", entityId: input.entityId, reason: "Reported by a user", severity: 0.4, metadata: { ticketId: ticket.id } });
  }
  if (input.category === "security") raiseAlert(ctx, "critical", "Security report received", { ticketId: ticket.id });
  else if (priority === "high") raiseAlert(ctx, "warning", `High-priority support ticket: ${SUPPORT_CATEGORIES[input.category].label}`, { ticketId: ticket.id });
  track(ctx, "support_ticket_created", input.userId, { category: input.category });
  return ticket;
}

export function replyToTicket(ctx: Ctx, input: { ticketId: string; by: string; body: string; internal: boolean; status?: SupportTicketRow["status"] }) {
  const t = ctx.state.supportTickets[input.ticketId];
  if (!t) throw Errors.notFound("Ticket");
  const now = ctx.now();
  if (input.body.trim()) {
    t.replies.push({ at: now, by: input.by, body: input.body.trim().slice(0, 5000), internal: input.internal });
    if (!input.internal && t.email) {
      const user = t.userId ? ctx.state.users[t.userId] : null;
      enqueueEmail(ctx, { id: user?.id ?? "support", username: user?.username ?? "there", email: t.email }, { template: "support-reply", subject: `Re: ${t.subject}`, body: input.body.trim() });
    }
  }
  if (input.status) t.status = input.status;
  else if (!input.internal && input.body.trim()) t.status = "pending";
  t.updatedAt = now;
  audit(ctx, { actor: input.by, action: "support.reply", entityType: "ticket", entityId: t.id, metadata: { internal: input.internal, status: t.status } });
  return t;
}

/** Canned responses for the common cases (§48). Admins insert and edit them before sending. */
export const CANNED_RESPONSES: { id: string; title: string; body: string }[] = [
  {
    id: "missing-credits",
    title: "Missing W$",
    body: "Thanks for reaching out. I checked your wallet history against our ledger. Every change to your balance is listed on your Wallet page with the market it came from. [Explain what you found.] If you still think something's missing, reply with the market and roughly when it happened.",
  },
  {
    id: "settlement",
    title: "Settlement explanation",
    body: "Thanks for asking about this market. It settled on the like count recorded 24 hours after it opened, which a reviewer checked before paying out. The final count was [N] likes, which falls in the [RANGE] range (a count exactly on a boundary goes to the higher range). The market page shows the data source and the full rules.",
  },
  {
    id: "cancelled",
    title: "Cancelled market",
    body: "This market was cancelled because [reason]. When a market is cancelled, every open position is refunded at what you paid for the shares you still held. Shares you sold earlier stay sold. You can see the refund on your Wallet page.",
  },
  {
    id: "password",
    title: "Password reset",
    body: "You can reset your password from the sign-in page with 'Forgot password?'. The link works for 1 hour. If the email doesn't arrive, check spam and make sure you're using the address you signed up with.",
  },
  {
    id: "deletion",
    title: "Account deletion",
    body: "You can delete your account any time from Settings → Delete account. We remove your email, password, sessions and connected accounts right away. Trade records stay in anonymized form so other people's market results remain correct.",
  },
  {
    id: "takedown",
    title: "Creator takedown",
    body: "Thanks for letting us know. We've removed your video from Wesify: it no longer appears anywhere, its thumbnail link is gone, and any open market on it was cancelled with refunds. We never host copies of your video.",
  },
  {
    id: "play-money",
    title: "W$ is play money",
    body: "W$ (Wesify Credits) are play money. They have no monetary value and can't be bought, withdrawn, transferred or exchanged for prizes.",
  },
];
