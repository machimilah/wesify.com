import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

/**
 * End-to-end through the real route handlers (auth, CSRF, rate limits, idempotency, admin), backed
 * by a throwaway data directory. Covers §52 duplicate trade, concurrent trade, duplicate settlement
 * and admin actions at the HTTP layer.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wesify-http-"));
process.env.WESIFY_DATA_DIR = dir;
process.env.WESIFY_BACKUPS = "0";

type Routes = {
  signup: typeof import("@/app/api/auth/signup/route");
  login: typeof import("@/app/api/auth/login/route");
  markets: typeof import("@/app/api/markets/route");
  market: typeof import("@/app/api/markets/[id]/route");
  buyRoute: typeof import("@/app/api/markets/[id]/buy/route");
  adminMarket: typeof import("@/app/api/admin/markets/[id]/route");
  overview: typeof import("@/app/api/admin/overview/route");
  wallet: typeof import("@/app/api/wallet/route");
  store: typeof import("@/server/store");
  integrity: typeof import("@/server/world/integrity");
};
let r: Routes;

beforeAll(async () => {
  r = {
    signup: await import("@/app/api/auth/signup/route"),
    login: await import("@/app/api/auth/login/route"),
    markets: await import("@/app/api/markets/route"),
    market: await import("@/app/api/markets/[id]/route"),
    buyRoute: await import("@/app/api/markets/[id]/buy/route"),
    adminMarket: await import("@/app/api/admin/markets/[id]/route"),
    overview: await import("@/app/api/admin/overview/route"),
    wallet: await import("@/app/api/wallet/route"),
    store: await import("@/server/store"),
    integrity: await import("@/server/world/integrity"),
  };
});

const BASE = "http://localhost:3000";
function req(p: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string>; ip?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": init.ip ?? "10.0.0.1", ...(init.headers ?? {}) };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`${BASE}${p}`, { method: init.method ?? "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
}
const params = <T>(p: T) => ({ params: Promise.resolve(p) }) as never;
const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

async function signup(name: string, ip = "10.0.0.2") {
  const res = await r.signup.POST(req("/api/auth/signup", { method: "POST", ip, body: { email: `${name}@example.com`, password: "a long enough password", username: name, ageConfirmed: true, acceptTerms: true } }));
  expect(res.status).toBe(200);
  return cookieOf(res);
}

async function firstOpenMarket(cookie: string) {
  const res = await r.markets.GET(req("/api/markets", { cookie }));
  const body = await res.json();
  const card = body.data.open.find((m: { status: string }) => m.status === "OPEN");
  const detail = await (await r.market.GET(req(`/api/markets/${card.id}`, { cookie }), params({ id: card.id }))).json();
  return detail.data as { id: string; outcomes: { id: string; price: number }[] };
}

describe("HTTP layer", () => {
  it("requires age confirmation and terms at sign-up", async () => {
    const res = await r.signup.POST(req("/api/auth/signup", { method: "POST", ip: "10.1.1.1", body: { email: "x@example.com", password: "a long enough password", username: "noterms", ageConfirmed: true, acceptTerms: false } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/Terms/);
  });

  it("blocks bots with the honeypot", async () => {
    const res = await r.signup.POST(req("/api/auth/signup", { method: "POST", ip: "10.1.1.2", body: { email: "bot@example.com", password: "a long enough password", username: "botty", ageConfirmed: true, acceptTerms: true, website: "spam.example" } }));
    expect(res.status).toBe(400);
  });

  it("replays an idempotent order instead of executing it twice", async () => {
    const cookie = await signup("idem_user");
    const m = await firstOpenMarket(cookie);
    const body = { outcomeId: m.outcomes[0].id, credits: 50 };
    const a = await r.buyRoute.POST(req(`/api/markets/${m.id}/buy`, { method: "POST", cookie, body, headers: { "idempotency-key": "order-1" } }), params({ id: m.id }));
    const b = await r.buyRoute.POST(req(`/api/markets/${m.id}/buy`, { method: "POST", cookie, body, headers: { "idempotency-key": "order-1" } }), params({ id: m.id }));
    expect(a.status).toBe(200);
    expect(b.headers.get("Idempotent-Replay")).toBe("true");
    expect((await a.json()).data.trade.id).toBe((await b.json()).data.trade.id);
    const wallet = (await (await r.wallet.GET(req("/api/wallet", { cookie }))).json()).data;
    expect(wallet.entries.filter((e: { type: string }) => e.type === "BUY")).toHaveLength(1);
    expect(wallet.reconciled).toBe(true);
  });

  it("stays consistent under concurrent orders from one account", async () => {
    const cookie = await signup("rush_user", "10.0.0.3");
    const m = await firstOpenMarket(cookie);
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        r.buyRoute.POST(req(`/api/markets/${m.id}/buy`, { method: "POST", cookie, body: { outcomeId: m.outcomes[i % m.outcomes.length].id, credits: 400 } }), params({ id: m.id })),
      ),
    );
    const ok = results.filter((x) => x.status === 200).length;
    expect(ok).toBeGreaterThan(0);
    expect(ok).toBeLessThan(15); // the 50%-per-market cap stops the rest
    const report = r.integrity.checkIntegrity(r.store.getMainWorld().state);
    expect(report.issues.filter((i) => /balance|ledger|negative/.test(i.check))).toEqual([]);
  });

  it("rejects cross-site state changes (CSRF)", async () => {
    const cookie = await signup("csrf_user", "10.0.0.4");
    const m = await firstOpenMarket(cookie);
    const res = await r.buyRoute.POST(
      req(`/api/markets/${m.id}/buy`, { method: "POST", cookie, body: { outcomeId: m.outcomes[0].id, credits: 10 }, headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } }),
      params({ id: m.id }),
    );
    expect(res.status).toBe(403);
  });

  it("keeps admin routes closed without the admin role or token", async () => {
    const cookie = await signup("not_admin", "10.0.0.5");
    expect((await r.overview.GET(req("/api/admin/overview", { cookie }))).status).toBe(403);
    expect((await r.overview.GET(req("/api/admin/overview", { headers: { "x-admin-token": "wrong" } }))).status).toBe(403);
    expect((await r.overview.GET(req("/api/admin/overview", { headers: { "x-admin-token": "dev-admin" } }))).status).toBe(200);
  });

  it("requires a typed confirmation to cancel a market, and cancelling twice refunds once", async () => {
    const cookie = await signup("admin_target", "10.0.0.6");
    const m = await firstOpenMarket(cookie);
    await r.buyRoute.POST(req(`/api/markets/${m.id}/buy`, { method: "POST", cookie, body: { outcomeId: m.outcomes[1].id, credits: 100 } }), params({ id: m.id }));
    const admin = { "x-admin-token": "dev-admin" };
    const missing = await r.adminMarket.POST(req(`/api/admin/markets/${m.id}`, { method: "POST", headers: admin, body: { action: "cancel", code: "ADMIN" } }), params({ id: m.id }));
    expect(missing.status).toBe(400);
    const first = await r.adminMarket.POST(req(`/api/admin/markets/${m.id}`, { method: "POST", headers: admin, body: { action: "cancel", code: "INCORRECT_SETUP", confirm: "CANCEL" } }), params({ id: m.id }));
    expect(first.status).toBe(200);
    const again = await r.adminMarket.POST(req(`/api/admin/markets/${m.id}`, { method: "POST", headers: admin, body: { action: "cancel", code: "INCORRECT_SETUP", confirm: "CANCEL" } }), params({ id: m.id }));
    expect((await again.json()).data.alreadyFinal).toBe(true);
    const report = r.integrity.checkIntegrity(r.store.getMainWorld().state);
    expect(report.issues.filter((i) => /duplicate|balance/.test(i.check))).toEqual([]);
  });

  it("rate-limits repeated login attempts", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      const res = await r.login.POST(req("/api/auth/login", { method: "POST", ip: "10.9.9.9", body: { login: "ghost@example.com", password: "whatever password" } }));
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
