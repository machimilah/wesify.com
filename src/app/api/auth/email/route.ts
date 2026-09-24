import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { Errors } from "@/server/world/errors";
import { meDTO } from "@/server/world/queries";
import { requestPasswordReset, resetPassword, sendVerification, verifyEmail } from "@/server/world/users";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), token: z.string().min(10).max(200) }),
  z.object({ action: z.literal("resend-verification") }),
  z.object({ action: z.literal("forgot-password"), email: z.string().trim().min(3).max(254) }),
  z.object({ action: z.literal("reset-password"), token: z.string().min(10).max(200), password: z.string().min(1).max(200) }),
]);

/**
 * Email flows (§4): verification, resend, forgot password and reset. Forgot-password always
 * answers the same way so it can't be used to find out which emails have accounts.
 */
export async function POST(req: NextRequest) {
  return handle(req, { tick: false, mainOnly: true, rateLimit: { name: "auth-email", limit: 10, windowMs: 15 * 60_000 } }, async (rc) => {
    const body = await readJson(req, Body);
    switch (body.action) {
      case "verify": {
        const user = verifyEmail(rc.ctx, body.token);
        return { verified: true, username: user.username };
      }
      case "resend-verification":
        if (!rc.user) throw Errors.unauthorized();
        sendVerification(rc.ctx, rc.user);
        return { sent: Boolean(rc.user.email && !rc.user.emailVerifiedAt) };
      case "forgot-password":
        requestPasswordReset(rc.ctx, body.email);
        return { sent: true };
      case "reset-password": {
        const user = resetPassword(rc.ctx, body.token, body.password);
        return meDTO(rc.ctx, user, rc.authProvider);
      }
    }
  });
}
