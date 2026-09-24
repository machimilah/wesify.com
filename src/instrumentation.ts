import type { Instrumentation } from "next";

/**
 * Runs once when a server instance starts (§35 environment validation). Production refuses to start
 * with a missing secret or a half-configured integration; development only prints warnings.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateEnv, isProductionEnv } = await import("./server/env");
  const { log } = await import("./server/log");
  const report = validateEnv();
  for (const w of report.warnings) log.warn(`env: ${w}`);
  if (!report.ok) {
    for (const e of report.errors) log.error(`env: ${e}`);
    // A production build run locally with APP_ENV=development (e.g. E2E) only warns.
    if (isProductionEnv()) throw new Error(`Invalid environment: ${report.errors.join("; ")}`);
  }
}

/** Server errors outside our route handler (rendering, metadata, proxy) go to error tracking (§42). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ getMainWorld }, { captureError }] = await Promise.all([import("./server/store"), import("./server/world/context")]);
  try {
    const world = getMainWorld();
    world.mutate((ctx) => captureError(ctx, "server", err, { path: request.path, method: request.method, routeType: context.routeType, routePath: context.routePath }));
  } catch {
    console.error("[wesify] request error", err);
  }
};
