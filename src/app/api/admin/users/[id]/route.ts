import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { clerkEnabled, revokeClerkSessions } from "@/server/auth/clerk";
import { handle, readJson } from "@/server/http";
import { userAdminDetail } from "@/server/admin/readModels";
import { audit } from "@/server/world/context";
import { Errors } from "@/server/world/errors";
import { adjustBalance, deleteAccount, renameUser, sendVerification, setUserStatus } from "@/server/world/users";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/admin/users/[id]">) {
  const { id } = await ctx.params;
  return handle(req, { auth: "support", mainOnly: true, tick: false }, (rc) => {
    const d = userAdminDetail(rc.ctx, id);
    if (!d) throw Errors.notFound("User");
    return d;
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("adjust"), amount: z.number().refine((v) => v !== 0, "Amount must be non-zero."), reason: z.string().trim().min(3).max(200), confirm: z.string().optional() }),
  z.object({ action: z.literal("refund"), amount: z.number().positive(), tradeId: z.string().max(100).optional(), reason: z.string().trim().min(3).max(200), confirm: z.string().optional() }),
  // Freeze = can't trade while under review; suspend = can't sign in. Neither is automatic (§27).
  z.object({ action: z.literal("freeze"), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("suspend"), reason: z.string().trim().min(3).max(300), confirm: z.literal("SUSPEND") }),
  z.object({ action: z.literal("reinstate"), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("rename"), username: z.string().min(3).max(20) }),
  z.object({ action: z.literal("role"), role: z.enum(["user", "support", "admin"]), confirm: z.literal("ROLE") }),
  z.object({ action: z.literal("resend-verification") }),
  z.object({ action: z.literal("delete"), reason: z.string().trim().min(3).max(300), confirm: z.literal("DELETE") }),
]);

/** User actions (§33): adjustments and refunds, freeze/suspend/reinstate, moderation, deletion requests. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/users/[id]">) {
  const { id } = await ctx.params;
  return handle(req, { auth: "admin", mainOnly: true, tick: false }, async (rc) => {
    const body = await readJson(req, Body);
    const actor = rc.admin!.id;
    const user = rc.ctx.state.users[id];
    if (!user) throw Errors.notFound("User");
    switch (body.action) {
      case "adjust":
      case "refund": {
        // Large adjustments need the amount typed again.
        if (Math.abs(body.amount) >= 1000 && body.confirm !== String(body.amount)) throw Errors.invalid(`Type ${body.amount} to confirm an adjustment this large.`);
        const row = adjustBalance(rc.ctx, { userId: id, amount: body.amount, reason: body.reason, actor, refund: body.action === "refund" ? { tradeId: body.tradeId } : undefined });
        return { balance: row.balanceAfter };
      }
      case "freeze":
      case "suspend":
      case "reinstate": {
        const status = body.action === "freeze" ? "frozen" : body.action === "suspend" ? "suspended" : "active";
        setUserStatus(rc.ctx, { userId: id, status, reason: body.reason, actor });
        if (status === "suspended" && user.clerkUserId && clerkEnabled()) after(() => revokeClerkSessions(user.clerkUserId!).catch(() => undefined));
        return { status };
      }
      case "rename":
        renameUser(rc.ctx, { userId: id, username: body.username, actor });
        return { username: body.username };
      case "role":
        if (rc.admin!.via !== "token" && rc.admin!.id === id) throw Errors.invalid("You can't change your own role.");
        user.role = body.role;
        audit(rc.ctx, { actor, action: "user.role", entityType: "user", entityId: id, metadata: { role: body.role } });
        return { role: body.role };
      case "resend-verification":
        sendVerification(rc.ctx, user);
        return { ok: true };
      case "delete":
        deleteAccount(rc.ctx, user, actor, body.reason);
        return { deleted: true };
    }
  });
}
