import type { NextRequest } from "next/server";
import { clerkEnabled } from "@/server/auth/clerk";
import { handle } from "@/server/http";
import { clientFlags } from "@/server/world/flags";
import type { AuthConfigDTO } from "@/lib/shared/dto";

/** What the sign-in UI needs: which auth provider, bot-protection key, and feature flags. */
export async function GET(req: NextRequest) {
  return handle(req, { tick: false }, (rc): AuthConfigDTO => ({
    provider: clerkEnabled() && !rc.isDemo ? "clerk" : "local",
    turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null,
    flags: clientFlags(rc.ctx, rc.user?.id ?? null),
  }));
}
