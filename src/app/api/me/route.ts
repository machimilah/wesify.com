import type { NextRequest } from "next/server";
import { handle } from "@/server/http";
import { meDTO } from "@/server/world/queries";

/** The signed-in user, or null. `needsProfile` means Clerk signed them in but no Wesify profile exists yet. */
export async function GET(req: NextRequest) {
  return handle(req, {}, (rc) => {
    if (rc.user) return meDTO(rc.ctx, rc.user, rc.authProvider);
    return rc.clerkUserId ? { needsProfile: true } : null;
  });
}
