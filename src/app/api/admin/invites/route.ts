import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { audit } from "@/server/world/context";

/** Beta invite codes with cohort tags (§58). */
export async function GET(req: NextRequest) {
  return handle(req, { auth: "support", mainOnly: true, tick: false }, (rc) => {
    const users = Object.values(rc.ctx.state.users).filter((u) => !u.isBot);
    return Object.values(rc.ctx.state.invites)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((i) => ({ ...i, members: users.filter((u) => u.cohort === i.cohort).length }));
  });
}

const Body = z.object({
  cohort: z.string().trim().min(2).max(40),
  maxUses: z.number().int().min(1).max(10_000),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  code: z.string().regex(/^[A-Z0-9]{4,16}$/).optional(),
});

export async function POST(req: NextRequest) {
  return handle(req, { auth: "admin", mainOnly: true, tick: false }, async (rc) => {
    const body = await readJson(req, Body);
    const code = body.code ?? randomBytes(4).toString("hex").toUpperCase();
    const now = rc.ctx.now();
    rc.ctx.state.invites[code] = { code, cohort: body.cohort, maxUses: body.maxUses, uses: 0, createdAt: now, createdBy: rc.admin!.id, expiresAt: body.expiresInDays ? Date.now() + body.expiresInDays * 86_400_000 : null };
    audit(rc.ctx, { actor: rc.admin!.id, action: "invite.create", entityType: "invite", entityId: code, metadata: { cohort: body.cohort, maxUses: body.maxUses } });
    return rc.ctx.state.invites[code];
  });
}
