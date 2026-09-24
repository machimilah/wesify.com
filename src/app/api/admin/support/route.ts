import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { CANNED_RESPONSES, SUPPORT_CATEGORIES, replyToTicket } from "@/server/world/support";

/** Internal support desk (§48): tickets, feedback and canned responses. */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "active";
  return handle(req, { auth: "support", mainOnly: true, tick: false }, (rc) => {
    const { state } = rc.ctx;
    const tickets = Object.values(state.supportTickets)
      .filter((t) => (status === "active" ? t.status !== "resolved" : status === "all" ? true : t.status === status))
      .sort((a, b) => (a.priority === b.priority ? b.createdAt - a.createdAt : a.priority === "high" ? -1 : 1))
      .slice(0, 200)
      .map((t) => ({ ...t, username: t.userId ? state.users[t.userId]?.username ?? null : null, categoryLabel: SUPPORT_CATEGORIES[t.category].label }));
    return { tickets, canned: CANNED_RESPONSES, feedback: state.feedback.slice(-100).reverse() };
  });
}

const Body = z.object({ ticketId: z.string().max(100), body: z.string().max(5000).default(""), internal: z.boolean().default(false), status: z.enum(["open", "pending", "resolved"]).optional() });

export async function POST(req: NextRequest) {
  return handle(req, { auth: "support", mainOnly: true, tick: false }, async (rc) => {
    const body = await readJson(req, Body);
    const t = replyToTicket(rc.ctx, { ticketId: body.ticketId, by: rc.admin!.id, body: body.body, internal: body.internal, status: body.status });
    return { id: t.id, status: t.status };
  });
}
