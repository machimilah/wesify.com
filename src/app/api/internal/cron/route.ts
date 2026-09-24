import type { NextRequest } from "next/server";
import { flushOutbox } from "@/server/email/outbox";
import { handle } from "@/server/http";
import { runJob } from "@/server/world/context";
import { isSyncDue, syncAccount } from "@/server/world/creators";

/**
 * Scheduler entrypoint (§35 jobs, §42 job failures). Call every 1–5 minutes with
 * `Authorization: Bearer $CRON_SECRET`. The request itself ticks the world (metric refresh,
 * repricing, market locks, settlement, supply top-up, hourly integrity/backup/prune), then this
 * syncs every due creator account and sends queued email. Each job's runs and failures appear in
 * /admin → Health.
 */
async function run(req: NextRequest) {
  return handle(req, { auth: "cron", mainOnly: true }, async (rc) => {
    const now = rc.ctx.now();
    const due = rc.ctx.state.socialAccounts.filter((a) => isSyncDue(a, now));
    await runJob(rc.ctx, "creator-sync-cron", async () => {
      for (const a of due) await syncAccount(rc.ctx, a.id);
    });
    const email = await runJob(rc.ctx, "email", () => flushOutbox(rc.ctx, 100));
    return { synced: due.length, email, tickedAt: now };
  });
}

export const GET = run;
export const POST = run;
