import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, adminToken, setCookie } from "@/server/http";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const expected = adminToken();
  const given = typeof body.token === "string" ? body.token : "";
  const ok =
    expected !== null &&
    timingSafeEqual(createHash("sha256").update(expected).digest(), createHash("sha256").update(given).digest());
  if (!ok) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Invalid admin token." } }, { status: 403 });
  const res = NextResponse.json({ data: { ok: true } });
  setCookie(res, ADMIN_COOKIE, given, 60 * 60 * 8);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ data: { ok: true } });
  setCookie(res, ADMIN_COOKIE, "", 0);
  return res;
}
