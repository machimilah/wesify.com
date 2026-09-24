import type { NextRequest } from "next/server";
import { z } from "zod";
import { SESSION_MAX_AGE_MS } from "@/lib/shared/constants";
import { assertHuman } from "@/server/auth/botcheck";
import { clerkEnabled } from "@/server/auth/clerk";
import { handle, readJson } from "@/server/http";
import { Errors } from "@/server/world/errors";
import { meDTO } from "@/server/world/queries";
import { createSession, login } from "@/server/world/users";

const Body = z.object({
  login: z.string().trim().min(1, "Enter your email or username.").max(254),
  password: z.string().min(1, "Enter your password.").max(200),
  website: z.string().max(200).optional().nullable(),
  turnstileToken: z.string().max(4000).optional().nullable(),
});

/** Built-in login (§4). Rate limited per IP; accounts lock after repeated failures. */
export async function POST(req: NextRequest) {
  return handle(req, { rateLimit: { name: "login", limit: 20, windowMs: 15 * 60_000 }, tick: false }, async (rc) => {
    const body = await readJson(req, Body);
    if (clerkEnabled()) throw Errors.clerkManaged();
    await assertHuman({ honeypot: body.website, turnstileToken: body.turnstileToken, ip: rc.ip });
    const user = login(rc.ctx, { login: body.login, password: body.password });
    const token = createSession(rc.ctx, user.id, { deviceId: rc.deviceId, ipHash: rc.ipHash, userAgent: req.headers.get("user-agent") });
    rc.response.cookies.push({ name: rc.sessionCookie, value: token, maxAge: SESSION_MAX_AGE_MS / 1000 });
    return meDTO(rc.ctx, user, rc.authProvider);
  });
}
