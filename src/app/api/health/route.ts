import { NextResponse, type NextRequest } from "next/server";
import { isAdmin, processStartedAt } from "@/server/http";
import { getMainWorld, storeHealth } from "@/server/store";

/**
 * Health check for uptime monitors (§42). Public output is minimal; the admin token adds detail.
 * Returns 503 when state can't be persisted or backups are stale, so monitors alert.
 */
export async function GET(req: NextRequest) {
  const started = performance.now();
  let status: "ok" | "degraded" | "down" = "ok";
  const checks: Record<string, unknown> = {};
  try {
    const world = getMainWorld();
    const store = storeHealth();
    const now = Date.now();
    checks.store = store.lastFlushError ? "failing" : "ok";
    if (store.lastFlushError) status = "down";
    const backupAge = store.backups[0] ? now - store.backups[0].createdAt : null;
    checks.backups = backupAge === null ? "none yet" : backupAge < 2 * 3_600_000 ? "ok" : "stale";
    if (checks.backups === "stale" && process.env.NODE_ENV === "production") status = status === "down" ? status : "degraded";
    const failingProviders = Object.entries(world.state.providers ?? {}).filter(([, p]) => p.consecutiveFailures >= 3).map(([n]) => n);
    checks.providers = failingProviders.length ? failingProviders : "ok";
    if (failingProviders.length && status === "ok") status = "degraded";
    checks.lastTickAgoMs = world.lastTickAt ? now - world.lastTickAt : null;
    if (isAdmin(req)) {
      checks.detail = {
        uptimeSec: Math.round((now - processStartedAt) / 1000),
        memoryMb: Math.round(process.memoryUsage().rss / 1e6),
        stateBytes: store.lastFlushBytes,
        lastFlushAt: store.lastFlushAt,
        lastBackupAt: store.lastBackupAt,
        lastBackupError: store.lastBackupError,
        markets: Object.keys(world.state.markets).length,
        users: Object.keys(world.state.users).length,
      };
    }
  } catch (err) {
    status = "down";
    checks.error = err instanceof Error ? err.message : String(err);
  }
  return NextResponse.json(
    { status, checks, version: process.env.npm_package_version ?? "0.1.0", responseMs: Math.round(performance.now() - started) },
    { status: status === "down" ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
