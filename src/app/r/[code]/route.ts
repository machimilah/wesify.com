import { NextResponse, type NextRequest } from "next/server";
import { setCookie } from "@/server/http";

/**
 * Referral link (§30): /r/CODE remembers the code for 30 days and sends the visitor to sign up.
 * The code is attached at sign-up; rewards only pay after real usage (server/world/referrals.ts).
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/r/[code]">) {
  const { code } = await ctx.params;
  const clean = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 16);
  const res = NextResponse.redirect(new URL(`/welcome?ref=${clean}`, req.url));
  if (clean) setCookie(res, "wesify_ref", clean, 60 * 60 * 24 * 30);
  return res;
}
