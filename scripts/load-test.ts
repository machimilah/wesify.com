/**
 * Load test (checklist §54) against a running server (staging or local, never production).
 *
 *   npm run load-test -- [--url http://localhost:3000] [--users 50] [--seconds 60]
 *
 * Each virtual user signs up, then loops: read the feed, open a market, poll it, and buy or sell.
 * Reports throughput, latency percentiles per endpoint, status codes (429s show rate limiting
 * working), and finally runs the admin balance audit to prove nothing was corrupted under load.
 * Set ADMIN_TOKEN to the server's admin token for the final audit.
 */
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("url", "http://localhost:3000").replace(/\/$/, "");
const USERS = Number(arg("users", "50"));
const SECONDS = Number(arg("seconds", "60"));
const ADMIN = process.env.ADMIN_TOKEN ?? "dev-admin";

type Sample = { route: string; ms: number; status: number };
const samples: Sample[] = [];

async function call(route: string, path: string, init: RequestInit & { cookie?: string } = {}) {
  const started = performance.now();
  let status = 0;
  let body: unknown = null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Origin: BASE, ...(init.cookie ? { Cookie: init.cookie } : {}), ...(init.headers ?? {}) },
    });
    status = res.status;
    body = await res.json().catch(() => null);
    const setCookie = res.headers.getSetCookie?.() ?? [];
    return { status, body, cookie: setCookie.map((c) => c.split(";")[0]).join("; ") };
  } finally {
    samples.push({ route, ms: performance.now() - started, status });
  }
}

async function virtualUser(n: number, until: number) {
  const name = `load_${Date.now().toString(36)}_${n}`;
  const signup = await call("signup", "/api/auth/signup", {
    method: "POST",
    headers: { "X-Forwarded-For": `10.${Math.floor(n / 250)}.${n % 250}.1` },
    body: JSON.stringify({ email: `${name}@load.test`, password: "load test password", username: name.slice(0, 20), ageConfirmed: true, acceptTerms: true }),
  });
  const cookie = signup.cookie;
  if (!cookie) return;
  while (Date.now() < until) {
    const feed = await call("feed", "/api/markets?limit=30", { cookie });
    const open = ((feed.body as { data?: { open?: { id: string }[] } })?.data?.open ?? []).filter(Boolean);
    if (!open.length) continue;
    const market = open[Math.floor(Math.random() * open.length)];
    const detail = await call("market", `/api/markets/${market.id}`, { cookie });
    const d = (detail.body as { data?: { outcomes: { id: string; price: number }[]; positions: { outcomeId: string; shares: number; status: string }[] } })?.data;
    if (!d) continue;
    const held = d.positions.find((p) => p.status === "OPEN");
    if (held && Math.random() < 0.4) {
      await call("sell", `/api/markets/${market.id}/sell`, { method: "POST", cookie, body: JSON.stringify({ outcomeId: held.outcomeId, shares: held.shares / 2 }) });
    } else {
      const o = d.outcomes[Math.floor(Math.random() * d.outcomes.length)];
      await call("buy", `/api/markets/${market.id}/buy`, {
        method: "POST",
        cookie,
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ outcomeId: o.id, credits: 5 + Math.round(Math.random() * 40), expectedPrice: o.price, tolerance: 0.2 }),
      });
    }
    await call("history", `/api/markets/${market.id}/history?range=ALL`, { cookie });
  }
}

function report() {
  const byRoute = new Map<string, Sample[]>();
  for (const s of samples) (byRoute.get(s.route) ?? byRoute.set(s.route, []).get(s.route)!).push(s);
  console.log(`\n${samples.length} requests in ${SECONDS}s (${(samples.length / SECONDS).toFixed(1)} req/s) with ${USERS} users\n`);
  console.log("route      n      p50     p95     p99     errors  statuses");
  for (const [route, xs] of byRoute) {
    const ms = xs.map((x) => x.ms).sort((a, b) => a - b);
    const q = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(0).padStart(6);
    const codes = new Map<number, number>();
    for (const x of xs) codes.set(x.status, (codes.get(x.status) ?? 0) + 1);
    const errors = xs.filter((x) => x.status === 0 || x.status >= 500).length;
    console.log(`${route.padEnd(8)} ${String(xs.length).padStart(5)} ${q(0.5)}ms ${q(0.95)}ms ${q(0.99)}ms ${String(errors).padStart(7)}  ${[...codes].map(([c, n]) => `${c}×${n}`).join(" ")}`);
  }
}

async function main() {
  const until = Date.now() + SECONDS * 1000;
  console.log(`Load test: ${USERS} users for ${SECONDS}s against ${BASE}`);
  await Promise.all(Array.from({ length: USERS }, (_, i) => virtualUser(i, until)));
  report();
  const audit = await call("audit", "/api/admin/health?integrity=1", { headers: { "x-admin-token": ADMIN } });
  const integrity = (audit.body as { data?: { integrity?: { ok: boolean; issues: unknown[] } } })?.data?.integrity;
  if (integrity) {
    console.log(`\nBalance audit after load: ${integrity.ok ? "✓ clean" : `✗ ${integrity.issues.length} issue(s)`}`);
    if (!integrity.ok) process.exit(1);
  } else {
    console.log("\nBalance audit skipped (set ADMIN_TOKEN).");
  }
  const serverErrors = samples.filter((s) => s.status >= 500 || s.status === 0).length;
  if (serverErrors > samples.length * 0.01) {
    console.error(`✗ ${serverErrors} server errors (>1%)`);
    process.exit(1);
  }
}

void main();
