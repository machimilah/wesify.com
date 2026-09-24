import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import type { UserRow } from "@/lib/shared/types";
import type { WorldMeta } from "@/lib/shared/dto";
import { clerkEnabled, clerkUserId } from "./auth/clerk";
import { flushOutbox } from "./email/outbox";
import { errorFields, log } from "./log";
import { hashIp } from "./secrets";
import { getDemoWorld, getMainWorld } from "./store";
import { captureError, pendingAlerts, track, type Ctx } from "./world/context";
import { Errors, WesifyError } from "./world/errors";
import { recordActivity } from "./world/metrics";
import { hashToken, userForToken } from "./world/users";
import type { World } from "./world/world";

export const SESSION_COOKIE = "wesify_session";
export const DEMO_COOKIE = "wesify_demo";
export const DEMO_SESSION_COOKIE = "wesify_demo_session";
export const ADMIN_COOKIE = "wesify_admin";
export const DEVICE_COOKIE = "wesify_device";
export const VISIT_COOKIE = "wesify_visit";
export const CONSENT_COOKIE = "wesify_consent";

export type AdminPrincipal = { id: string; role: "admin" | "support"; via: "token" | "session" };

export type RequestContext = {
  req: NextRequest;
  world: World;
  ctx: Ctx;
  user: UserRow | null;
  isDemo: boolean;
  sessionCookie: string;
  /** sha256 of the session token, for "this device" in session lists. */
  sessionHash: string | undefined;
  admin: AdminPrincipal | null;
  deviceId: string;
  ip: string | null;
  ipHash: string | null;
  authProvider: "local" | "clerk" | "demo";
  /** Clerk user signed in but without a Wesify profile yet (needs username/terms). */
  clerkUserId: string | null;
  response: { cookies: { name: string; value: string; maxAge: number; httpOnly?: boolean }[]; headers: Record<string, string> };
};

type Options = {
  auth?: "optional" | "user" | "admin" | "support" | "cron";
  rateLimit?: { name: string; limit: number; windowMs: number; key?: "ip" | "user" };
  /** Skip the world tick (e.g. pure writes where freshness is irrelevant). */
  tick?: boolean;
  /** Admin/internal routes always operate on the main world. */
  mainOnly?: boolean;
  /** Honour an Idempotency-Key header (§8, §28): a retried request returns the first result. */
  idempotent?: boolean;
};

// ---- Rate limiting (§28): in-memory fixed window per instance. Swap for Redis when scaling out.
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return;
  }
  if (++b.count > limit) throw Errors.rateLimited();
}

// ---- Latency and error-rate monitoring (§37, §42), per route pattern, last 500 samples each.
type RouteStat = { count: number; errors: number; samples: number[] };
const g = globalThis as unknown as { __wesifyRoutes?: Map<string, RouteStat>; __wesifyStarted?: number };
export const routeStats: Map<string, RouteStat> = (g.__wesifyRoutes ??= new Map());
export const processStartedAt: number = (g.__wesifyStarted ??= Date.now());

function routeKey(req: NextRequest) {
  return `${req.method} ${req.nextUrl.pathname.replace(/\/(mkt|usr|vid|trd|pos|out|app|soc|cvid|tkt|stl|risk)_[a-f0-9]+/g, "/:id")}`;
}

function recordRoute(key: string, ms: number, error: boolean) {
  const s = routeStats.get(key) ?? { count: 0, errors: 0, samples: [] };
  s.count++;
  if (error) s.errors++;
  s.samples.push(ms);
  if (s.samples.length > 500) s.samples.shift();
  routeStats.set(key, s);
  if (ms > 1500) log.warn("slow request", { route: key, ms: Math.round(ms) });
}

export function latencySummary() {
  return [...routeStats.entries()]
    .map(([route, s]) => {
      const sorted = [...s.samples].sort((a, b) => a - b);
      const q = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0);
      return { route, count: s.count, errorRate: s.count ? s.errors / s.count : 0, p50: q(0.5), p95: q(0.95), p99: q(0.99) };
    })
    .sort((a, b) => b.count - a.count);
}

export function clientIp(req: NextRequest): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || null;
}

/**
 * CSRF protection for state-changing requests (§43): a browser-sent Origin must match this host,
 * and a request the browser marks cross-site is refused. Cookies are also SameSite=Lax.
 */
function assertSameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  if (req.headers.get("sec-fetch-site") === "cross-site") throw Errors.forbidden();
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw Errors.forbidden();
  } catch (err) {
    if (err instanceof WesifyError) throw err;
    throw Errors.forbidden();
  }
}

export function adminToken(): string | null {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  return process.env.NODE_ENV === "production" ? null : "dev-admin";
}

const safeEqual = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

/** The bootstrap admin token (header or cookie) acts as the owner account. */
export function isAdmin(req: NextRequest): boolean {
  const expected = adminToken();
  const given = req.headers.get("x-admin-token") ?? req.cookies.get(ADMIN_COOKIE)?.value;
  return Boolean(expected && given && safeEqual(expected, given));
}

/** Scheduler calls (§35 jobs): `Authorization: Bearer $CRON_SECRET`, or the admin token. */
function isCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return (Boolean(secret && auth) && safeEqual(secret!, auth!)) || isAdmin(req);
}

export function worldMeta(world: World): WorldMeta {
  return { kind: world.state.kind, worldNow: world.now(), scale: world.state.clock.scale };
}

function resolveAdmin(req: NextRequest, user: UserRow | null): AdminPrincipal | null {
  if (isAdmin(req)) return { id: "owner", role: "admin", via: "token" };
  if (user && user.status === "active" && (user.role === "admin" || user.role === "support")) return { id: user.id, role: user.role, via: "session" };
  return null;
}

function recordDevice(ctx: Ctx, deviceId: string, userId: string, ipHash: string | null) {
  const devices = (ctx.state.devices ??= {});
  const now = ctx.now();
  const d = (devices[deviceId] ??= { userIds: [], ipHashes: [], firstSeenAt: now, lastSeenAt: now });
  if (!d.userIds.includes(userId)) d.userIds.push(userId);
  if (ipHash && !d.ipHashes.includes(ipHash)) {
    d.ipHashes.push(ipHash);
    if (d.ipHashes.length > 20) d.ipHashes.shift();
  }
  d.lastSeenAt = now;
}

/** The signed-in main-world user for routes that can't use `handle` (OAuth redirects). */
export async function resolveMainUser(req: NextRequest, world: World): Promise<UserRow | null> {
  if (clerkEnabled()) {
    const id = await clerkUserId(req);
    const linked = id ? Object.values(world.state.users).find((u) => u.clerkUserId === id) : undefined;
    if (linked && linked.status !== "suspended" && linked.status !== "deleted") return linked;
  }
  return userForToken(world.ctx, req.cookies.get(SESSION_COOKIE)?.value);
}

export async function handle<T>(req: NextRequest, opts: Options, fn: (rc: RequestContext) => Promise<T> | T): Promise<NextResponse> {
  const started = performance.now();
  const key = routeKey(req);
  const requestId = randomBytes(6).toString("hex");
  const clearDemo = { value: false };
  let world: World | null = null;
  try {
    assertSameOrigin(req);
    const ip = clientIp(req);
    if (opts.rateLimit && opts.rateLimit.key !== "user") rateLimit(`${opts.rateLimit.name}:${ip ?? "local"}`, opts.rateLimit.limit, opts.rateLimit.windowMs);

    const demoId = req.cookies.get(DEMO_COOKIE)?.value;
    const demo = opts.mainOnly ? null : getDemoWorld(demoId);
    if (demoId && !demo && !opts.mainOnly) clearDemo.value = true;
    world = demo ?? getMainWorld();
    if (opts.tick !== false) await world.tick();

    const sessionCookie = demo ? DEMO_SESSION_COOKIE : SESSION_COOKIE;
    const token = req.cookies.get(sessionCookie)?.value;
    let user = userForToken(world.ctx, token);
    let authProvider: RequestContext["authProvider"] = demo ? "demo" : "local";
    let clerkId: string | null = null;
    if (!demo && clerkEnabled()) {
      authProvider = "clerk";
      clerkId = await clerkUserId(req);
      const linked = clerkId ? Object.values(world.state.users).find((u) => u.clerkUserId === clerkId) : undefined;
      user = linked && linked.status !== "suspended" && linked.status !== "deleted" ? linked : user?.clerkUserId ? null : user;
    }
    const admin = resolveAdmin(req, user);
    if (opts.auth === "user" && !user) throw Errors.unauthorized();
    if (opts.auth === "admin" && admin?.role !== "admin") throw Errors.forbidden();
    if (opts.auth === "support" && !admin) throw Errors.forbidden();
    if (opts.auth === "cron" && !isCron(req)) throw Errors.forbidden();
    if (opts.rateLimit?.key === "user") rateLimit(`${opts.rateLimit.name}:${user?.id ?? ip ?? "local"}`, opts.rateLimit.limit, opts.rateLimit.windowMs);

    const rc: RequestContext = {
      req,
      world,
      ctx: world.ctx,
      user,
      isDemo: Boolean(demo),
      sessionCookie,
      sessionHash: token ? hashToken(token) : undefined,
      admin,
      deviceId: req.cookies.get(DEVICE_COOKIE)?.value ?? randomBytes(12).toString("base64url"),
      ip,
      ipHash: hashIp(ip),
      authProvider,
      clerkUserId: clerkId,
      response: { cookies: [], headers: {} },
    };
    if (!req.cookies.get(DEVICE_COOKIE)) rc.response.cookies.push({ name: DEVICE_COOKIE, value: rc.deviceId, maxAge: 60 * 60 * 24 * 730 });
    const visitId = req.cookies.get(VISIT_COOKIE)?.value ?? randomBytes(8).toString("base64url");
    rc.response.cookies.push({ name: VISIT_COOKIE, value: visitId, maxAge: 30 * 60 });

    // Idempotency (§8 duplicate-submit, §28 replay): the first result for a key is stored and replayed.
    const idemKey = opts.idempotent ? req.headers.get("idempotency-key")?.slice(0, 100) : null;
    const idemId = idemKey && user ? `${user.id}:${idemKey}` : null;
    if (idemId) {
      const stored = world.state.idempotency?.[idemId];
      if (stored) {
        if (stored.route !== key) throw Errors.invalid("Idempotency-Key reused for a different request.");
        const res = NextResponse.json(stored.body as object, { status: stored.status });
        res.headers.set("Idempotent-Replay", "true");
        res.headers.set("Cache-Control", "no-store");
        return res;
      }
    }

    const data = await world.mutate(() => {
      if (user && !demo) {
        recordDevice(rc.ctx, rc.deviceId, user.id, rc.ipHash);
      }
      recordActivity(rc.ctx, user && !user.isBot ? user.id : null, demo ? null : visitId);
      return fn(rc);
    });
    const body = { data, meta: worldMeta(world) };
    if (idemId) (world.state.idempotency ??= {})[idemId] = { createdAt: Date.now(), route: key, status: 200, body };
    const res = NextResponse.json(body);
    for (const c of rc.response.cookies) setCookie(res, c.name, c.value, c.maxAge, c.httpOnly);
    for (const [h, v] of Object.entries(rc.response.headers)) res.headers.set(h, v);
    if (clearDemo.value) setCookie(res, DEMO_COOKIE, "", 0);
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("X-Request-Id", requestId);
    recordRoute(key, performance.now() - started, false);
    scheduleAfterWork(world);
    return res;
  } catch (err) {
    const status = err instanceof WesifyError ? err.status : err instanceof z.ZodError ? 400 : 500;
    recordRoute(key, performance.now() - started, status >= 500);
    if (status >= 500 && !(err instanceof WesifyError) && world) {
      world.mutate((ctx) => captureError(ctx, "server", err, { route: key, requestId }));
    } else if (status >= 500 && !(err instanceof WesifyError)) {
      log.error("unhandled error", { route: key, requestId, ...errorFields(err) });
    }
    if (world && /\/(buy|sell)$/.test(key) && status < 500) {
      const u = userForToken(world.ctx, req.cookies.get(SESSION_COOKIE)?.value);
      world.mutate((ctx) => track(ctx, "trade_failed", u?.id ?? null, { route: key, code: err instanceof WesifyError ? err.code : "INVALID" }));
    }
    return errorResponse(err, clearDemo.value, requestId);
  }
}

/** Email, alert webhooks and analytics forwarding run after the response (next/server `after`). */
function scheduleAfterWork(world: World) {
  if (world.state.kind !== "main") return;
  const hasMail = world.state.outbox?.some((e) => e.status === "queued");
  if (!hasMail && pendingAlerts.length === 0) return;
  try {
    after(async () => {
      if (hasMail) {
        const r = await flushOutbox(world.ctx);
        if (r.sent || r.failed) world.mutate(() => undefined);
      }
      await sendAlerts();
    });
  } catch {
    /* outside a request scope (tests) */
  }
}

async function sendAlerts() {
  const url = process.env.ALERT_WEBHOOK_URL;
  const batch = pendingAlerts.splice(0, pendingAlerts.length);
  if (!url || !batch.length) return;
  for (const a of batch) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Slack- and Discord-compatible: both accept `text`/`content`.
        body: JSON.stringify({ text: `[wesify ${a.severity}] ${a.message}`, content: `[wesify ${a.severity}] ${a.message}`, context: a.context }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      log.warn("alert webhook failed", errorFields(err));
    }
  }
}

export function setCookie(res: NextResponse, name: string, value: string, maxAge: number, httpOnly = true) {
  res.cookies.set(name, value, {
    httpOnly,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

function errorResponse(err: unknown, clearDemo: boolean, requestId: string) {
  let res: NextResponse;
  if (err instanceof WesifyError) {
    res = NextResponse.json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }, { status: err.status });
  } else if (err instanceof z.ZodError) {
    const message = err.issues[0]?.message ?? "Invalid request.";
    res = NextResponse.json({ error: { code: "INVALID", message } }, { status: 400 });
  } else {
    res = NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong. Try again.", requestId } }, { status: 500 });
  }
  if (clearDemo) setCookie(res, DEMO_COOKIE, "", 0);
  res.headers.set("X-Request-Id", requestId);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function readJson<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw Errors.invalid("Invalid JSON body.");
  }
  return schema.parse(body);
}
