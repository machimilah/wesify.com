import type { NextRequest } from "next/server";
import { z } from "zod";
import { SESSION_MAX_AGE_MS } from "@/lib/shared/constants";
import { assertHuman } from "@/server/auth/botcheck";
import { clerkEnabled } from "@/server/auth/clerk";
import { registerUser } from "@/server/auth/signup";
import { handle, readJson } from "@/server/http";
import { Errors } from "@/server/world/errors";
import { meDTO } from "@/server/world/queries";
import { createSession } from "@/server/world/users";

const Body = z.object({
  email: z.string().trim().min(3, "Enter your email.").max(254),
  password: z.string().min(1, "Choose a password.").max(200),
  username: z.string().min(1, "Pick a username.").max(40),
  ageConfirmed: z.boolean(),
  acceptTerms: z.boolean(),
  inviteCode: z.string().max(40).optional().nullable(),
  referralCode: z.string().max(40).optional().nullable(),
  website: z.string().max(200).optional().nullable(),
  renderedAt: z.number().optional().nullable(),
  turnstileToken: z.string().max(4000).optional().nullable(),
});

/** Built-in sign-up (§4). With Clerk configured, sign-up happens in Clerk's UI instead. */
export async function POST(req: NextRequest) {
  return handle(req, { rateLimit: { name: "signup", limit: 10, windowMs: 60 * 60_000 }, tick: false }, async (rc) => {
    const body = await readJson(req, Body);
    if (clerkEnabled() && !rc.isDemo) throw Errors.clerkManaged();
    await assertHuman({ honeypot: body.website, renderedAt: body.renderedAt, turnstileToken: body.turnstileToken, ip: rc.ip });
    const user = registerUser(rc, {
      username: body.username,
      email: body.email,
      password: body.password,
      ageConfirmed: body.ageConfirmed,
      acceptTerms: body.acceptTerms,
      inviteCode: body.inviteCode,
      referralCode: body.referralCode ?? req.cookies.get("wesify_ref")?.value ?? null,
    });
    const token = createSession(rc.ctx, user.id, { deviceId: rc.deviceId, ipHash: rc.ipHash, userAgent: req.headers.get("user-agent") });
    rc.response.cookies.push({ name: rc.sessionCookie, value: token, maxAge: SESSION_MAX_AGE_MS / 1000 });
    return meDTO(rc.ctx, user, rc.authProvider);
  });
}
