import type { NextRequest } from "next/server";

/**
 * The OAuth redirect URI must exactly match one registered in the TikTok/Meta developer console,
 * so production should set APP_URL rather than trusting the request's Host header.
 */
export function creatorRedirectUri(req: NextRequest, platform: string): string {
  const base = process.env.APP_URL?.replace(/\/$/, "") ?? req.nextUrl.origin;
  return `${base}/api/social/${platform}/callback`;
}
