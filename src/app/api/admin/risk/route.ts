import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { audit } from "@/server/world/context";
import { Errors } from "@/server/world/errors";

/** Flagged users and markets queue (§27, §33). */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "open";
  return handle(req, { auth: "support", mainOnly: true, tick: false }, (rc) => {
    const { state } = rc.ctx;
    return state.riskFlags
      .filter((f) => status === "all" || (f.status ?? "open") === status)
      .slice(-300)
      .reverse()
      .map((f) => ({
        ...f,
        status: f.status ?? "open",
        label: f.entityType === "user" ? state.users[f.entityId]?.username : state.videos[state.markets[f.entityId]?.videoId]?.creatorHandle,
      }));
  });
}

const Body = z.object({ id: z.string().max(100), status: z.enum(["resolved", "dismissed", "open"]), resolution: z.string().trim().max(500).default("") });

export async function POST(req: NextRequest) {
  return handle(req, { auth: "support", mainOnly: true, tick: false }, async (rc) => {
    const body = await readJson(req, Body);
    const { state } = rc.ctx;
    const flag = state.riskFlags.find((f) => f.id === body.id);
    if (!flag) throw Errors.notFound("Flag");
    if (body.status !== "open" && !body.resolution) throw Errors.invalid("Write what you found.");
    flag.status = body.status;
    flag.resolvedAt = body.status === "open" ? null : rc.ctx.now();
    flag.resolvedBy = body.status === "open" ? null : rc.admin!.id;
    flag.resolution = body.resolution || null;
    // Risk scores follow the flags still open, so resolving a false alarm clears the score.
    const open = state.riskFlags.filter((f) => f.entityType === flag.entityType && f.entityId === flag.entityId && (f.status ?? "open") === "open");
    const score = open.reduce((m, f) => Math.max(m, f.severity), 0);
    if (flag.entityType === "market" && state.markets[flag.entityId]) state.markets[flag.entityId].riskScore = score;
    if (flag.entityType === "user" && state.users[flag.entityId]) state.users[flag.entityId].riskScore = score;
    audit(rc.ctx, { actor: rc.admin!.id, action: `risk.${body.status}`, entityType: "risk_flag", entityId: flag.id, metadata: { resolution: body.resolution, entity: `${flag.entityType}:${flag.entityId}` } });
    return { ok: true };
  });
}
