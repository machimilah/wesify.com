import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertHuman } from "@/server/auth/botcheck";
import { handle, readJson } from "@/server/http";
import { RESPONSE_TIME, SUPPORT_CATEGORIES, createTicket } from "@/server/world/support";
import type { SupportCategory } from "@/lib/shared/types";

const CATEGORY = z.enum(Object.keys(SUPPORT_CATEGORIES) as [SupportCategory, ...SupportCategory[]]);

const Body = z.object({
  category: CATEGORY,
  subject: z.string().trim().min(3, "Add a short subject.").max(200),
  body: z.string().trim().min(10, "Tell us a bit more (at least 10 characters).").max(5000),
  email: z.string().trim().email("Enter a valid email.").max(254).optional().nullable(),
  entityType: z.enum(["market", "user", "video"]).optional().nullable(),
  entityId: z.string().max(100).optional().nullable(),
  website: z.string().max(200).optional().nullable(),
  renderedAt: z.number().optional().nullable(),
  turnstileToken: z.string().max(4000).optional().nullable(),
});

/** Contact form, reports and appeals (§48, §49). Works signed out too (with an email). */
export async function POST(req: NextRequest) {
  return handle(req, { tick: false, mainOnly: true, rateLimit: { name: "support", limit: 8, windowMs: 60 * 60_000 } }, async (rc) => {
    const body = await readJson(req, Body);
    await assertHuman({ honeypot: body.website, renderedAt: body.renderedAt, turnstileToken: rc.user ? null : body.turnstileToken, ip: rc.ip }, 1000);
    const t = createTicket(rc.ctx, { userId: rc.user?.id ?? null, email: body.email ?? null, category: body.category, subject: body.subject, body: body.body, entityType: body.entityType ?? null, entityId: body.entityId ?? null });
    return { id: t.id, responseTime: RESPONSE_TIME[t.priority] };
  });
}

/** The signed-in user's own tickets and our public replies. */
export async function GET(req: NextRequest) {
  return handle(req, { auth: "user", tick: false, mainOnly: true }, (rc) =>
    Object.values(rc.ctx.state.supportTickets)
      .filter((t) => t.userId === rc.user!.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((t) => ({ id: t.id, category: t.category, subject: t.subject, status: t.status, createdAt: t.createdAt, replies: t.replies.filter((r) => !r.internal).map((r) => ({ at: r.at, body: r.body })) })),
  );
}
