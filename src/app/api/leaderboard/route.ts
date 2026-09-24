import type { NextRequest } from "next/server";
import type { LeaderboardPeriod } from "@/lib/shared/dto";
import { handle } from "@/server/http";
import { WesifyError } from "@/server/world/errors";
import { flagEnabled } from "@/server/world/flags";
import { leaderboard } from "@/server/world/queries";

const PERIODS: LeaderboardPeriod[] = ["today", "7d", "all"];

export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get("period");
  const period = PERIODS.find((p) => p === param) ?? "today";
  return handle(req, {}, (rc) => {
    if (!flagEnabled(rc.ctx, "leaderboard")) throw new WesifyError("LEADERBOARD_OFF", "The leaderboard is taking a break.", 503);
    return leaderboard(rc.ctx, period, rc.user);
  });
}
