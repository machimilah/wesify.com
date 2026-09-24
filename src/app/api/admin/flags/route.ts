import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { audit } from "@/server/world/context";
import { FLAG_NAMES, listFlags, setFlag, type FlagName } from "@/server/world/flags";

/** Feature flags (§57). */
export async function GET(req: NextRequest) {
  return handle(req, { auth: "support", mainOnly: true, tick: false }, (rc) => listFlags(rc.ctx));
}

const Body = z.object({
  name: z.enum(FLAG_NAMES as [FlagName, ...FlagName[]]),
  enabled: z.boolean().optional(),
  rollout: z.number().min(0).max(100).optional(),
  value: z.number().int().min(0).nullable().optional(),
});

export async function POST(req: NextRequest) {
  return handle(req, { auth: "admin", mainOnly: true, tick: false }, async (rc) => {
    const body = await readJson(req, Body);
    const next = setFlag(rc.ctx, body.name, { enabled: body.enabled, rollout: body.rollout, value: body.value }, rc.admin!.id);
    audit(rc.ctx, { actor: rc.admin!.id, action: "flag.set", entityType: "flag", entityId: body.name, metadata: { ...next } });
    return next;
  });
}
