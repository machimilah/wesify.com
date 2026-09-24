"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui";
import { ApiError, api } from "@/lib/client/api";
import { compactNumber, credits, duration, percent } from "@/lib/shared/format";

/**
 * Admin console (checklist §33). Support staff can read everything; only admins can act. Every
 * action that moves W$ or ends a market asks for a typed confirmation, and the server re-checks it.
 */

type Tab = "overview" | "review" | "markets" | "users" | "risk" | "support" | "metrics" | "model" | "health" | "controls" | "creators" | "audit";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "review", label: "Review queue" },
  { id: "markets", label: "Markets" },
  { id: "users", label: "Users" },
  { id: "risk", label: "Risk flags" },
  { id: "support", label: "Support" },
  { id: "metrics", label: "Metrics" },
  { id: "model", label: "Model" },
  { id: "health", label: "Health" },
  { id: "controls", label: "Controls" },
  { id: "creators", label: "Creators" },
  { id: "audit", label: "Audit log" },
];

type Json = Record<string, unknown>;
type RunFn = (path: string, body: unknown, ok?: string) => Promise<unknown>;

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api("/api/admin/overview")
      .then(() => setAuthed(true))
      .catch((err) => setAuthed(err instanceof ApiError && (err.status === 403 || err.status === 401) ? false : true));
  }, [version]);

  const run: RunFn = useCallback(async (path, body, ok = "Done.") => {
    setMessage(null);
    try {
      const r = await api<unknown>(path, { method: "POST", body });
      setMessage({ ok: true, text: ok });
      setVersion((v) => v + 1);
      return r;
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "Request failed." });
      return null;
    }
  }, []);

  if (authed === false) {
    return (
      <form
        className="mx-auto max-w-sm space-y-3 px-6 py-24"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/admin/login", { method: "POST", body: { token } });
            setVersion((v) => v + 1);
          } catch (err) {
            setMessage({ ok: false, text: err instanceof ApiError ? err.message : "Login failed" });
          }
        }}
      >
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-muted">Sign in with an admin or support account, or the owner token.</p>
        <label className="block">
          <span className="sr-only">Admin token</span>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Owner token" className="input" />
        </label>
        <button className="btn btn-primary w-full">Sign in</button>
        {message && <p className="text-sm text-muted">{message.text}</p>}
      </form>
    );
  }
  if (authed === null) return <p className="p-8 text-sm text-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 text-sm">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-xl font-semibold">wesify</Link>
          <span className="badge">Admin</span>
        </div>
        <button onClick={() => setVersion((v) => v + 1)} className="btn btn-secondary">Refresh</button>
      </header>
      <nav aria-label="Admin sections" className="no-scrollbar flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined} className={`min-h-10 shrink-0 rounded-full px-4 font-semibold ${tab === t.id ? "btn-solid" : "border border-line"}`}>
            {t.label}
          </button>
        ))}
      </nav>
      {message && (
        <p role="status" className={`notice ${message.ok ? "notice-success" : "notice-danger"}`}>
          {message.text}
        </p>
      )}
      {tab === "overview" && <Overview version={version} run={run} />}
      {tab === "review" && <ReviewQueue version={version} run={run} />}
      {tab === "markets" && <Markets version={version} run={run} />}
      {tab === "users" && <Users version={version} run={run} />}
      {tab === "risk" && <Risk version={version} run={run} />}
      {tab === "support" && <Support version={version} run={run} />}
      {tab === "metrics" && <Metrics version={version} />}
      {tab === "model" && <Model version={version} />}
      {tab === "health" && <Health version={version} />}
      {tab === "controls" && <Controls version={version} run={run} />}
      {tab === "creators" && <Creators version={version} run={run} />}
      {tab === "audit" && <Audit version={version} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function useData<T>(path: string, version: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<T>(path)
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : "Failed to load"));
    return () => {
      live = false;
    };
  }, [path, version]);
  return { data, error };
}

function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-2xl bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${warn ? "bg-warning/10" : "bg-wash"}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className="tabular mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : percent(v, 1));
const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "—" : v.toFixed(d));
const when = (t: number | null | undefined) => (t ? new Date(t).toLocaleString() : "—");

function Btn({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`min-h-9 rounded-full px-3 text-xs font-semibold ${danger ? "btn-danger" : "border border-line hover:bg-wash"}`}>
      {children}
    </button>
  );
}

type Prompt = { title: string; description?: string; fields: { name: string; label: string; type?: string; options?: string[]; initial?: string }[]; confirmWord?: string; submit: string; danger?: boolean; onSubmit: (v: Record<string, string>) => void };

/** Form dialog with optional typed confirmation (§33: no accidental settle/cancel). */
function PromptDialog({ prompt, onClose }: { prompt: Prompt; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(prompt.fields.map((f) => [f.name, f.initial ?? f.options?.[0] ?? ""])));
  const [typed, setTyped] = useState("");
  const ready = !prompt.confirmWord || typed.replace(/[,\s]/g, "") === prompt.confirmWord.replace(/[,\s]/g, "");
  return (
    <Dialog title={prompt.title} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          prompt.onSubmit({ ...values, confirm: typed });
          onClose();
        }}
      >
        {prompt.description && <p className="text-sm text-ink-soft">{prompt.description}</p>}
        {prompt.fields.map((f) => (
          <label key={f.name} className="block text-sm">
            <span className="text-ink-soft">{f.label}</span>
            {f.options ? (
              <select className="input mt-1" value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                {f.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea className="input mt-1" value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
            ) : (
              <input className="input mt-1" type={f.type ?? "text"} value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
            )}
          </label>
        ))}
        {prompt.confirmWord && (
          <label className="block text-sm">
            <span className="text-ink-soft">
              Type <strong className="text-ink">{prompt.confirmWord}</strong> to confirm
            </span>
            <input className="input mt-1" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
        )}
        <button type="submit" disabled={!ready} className={`btn w-full ${prompt.danger ? "btn-danger" : "btn-primary"}`}>
          {prompt.submit}
        </button>
      </form>
    </Dialog>
  );
}

function usePrompt() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const node = prompt ? <PromptDialog prompt={prompt} onClose={() => setPrompt(null)} /> : null;
  return { ask: setPrompt, node };
}

// ---------------------------------------------------------------------------
// Overview (§67 founder dashboard, §75 launch gate)
// ---------------------------------------------------------------------------

type Overview = {
  dashboard: Record<string, unknown> & { failedJobs: { name: string; error: string | null }[]; failedMetrics: { name: string; consecutiveFailures: number }[] };
  launchGate: { ready: boolean; checks: { id: string; section: string; label: string; ok: boolean; detail: string; manual?: boolean }[] };
  alerts: { id: string; severity: string; message: string; createdAt: number }[];
  admin: { id: string; role: string; via: string };
};

function Overview({ version, run }: { version: number; run: RunFn }) {
  const { data, error } = useData<Overview>("/api/admin/overview", version);
  if (error) return <p className="notice notice-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;
  const d = data.dashboard as Record<string, number | null>;
  return (
    <div className="space-y-4">
      <Panel title="Today">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
          <Kpi label="Users active today" value={d.usersToday} />
          <Kpi label="Sign-ups today" value={d.signupsToday} />
          <Kpi label="Active traders" value={d.activeTraders} />
          <Kpi label="First trades" value={d.firstTradesToday} />
          <Kpi label="Repeat traders (all time)" value={d.repeatTraders} />
          <Kpi label="Trades today" value={d.tradesToday} />
          <Kpi label="Volume today" value={credits(d.volumeToday ?? 0, { decimals: 0 })} />
          <Kpi label="Markets live" value={d.marketsLive} warn={(d.marketsLive ?? 0) < 20} />
          <Kpi label="Paused" value={d.marketsPaused} warn={(d.marketsPaused ?? 0) > 0} />
          <Kpi label="Settling" value={d.marketsSettling} />
          <Kpi label="Settlements to review" value={d.settlementsAwaitingReview} warn={(d.settlementsAwaitingReview ?? 0) > 0} />
          <Kpi label="Submissions to review" value={d.submissionsAwaitingReview} warn={(d.submissionsAwaitingReview ?? 0) > 0} />
          <Kpi label="Open tickets" value={d.openSupportTickets} warn={(d.openSupportTickets ?? 0) > 0} />
          <Kpi label="Suspicious users" value={d.suspiciousUsers} warn={(d.suspiciousUsers ?? 0) > 0} />
          <Kpi label="Open risk flags" value={d.openRiskFlags} />
          <Kpi label="D1 retention" value={pct(d.retentionD1)} />
          <Kpi label="D7 retention" value={pct(d.retentionD7)} />
          <Kpi label="Shares today" value={d.creatorShares} />
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-muted">Failed jobs (24h)</p>
            {data.dashboard.failedJobs.length ? data.dashboard.failedJobs.map((j) => <p key={j.name} className="text-danger">{j.name}: {j.error}</p>) : <p className="text-success">None</p>}
          </div>
          <div>
            <p className="text-xs font-semibold text-muted">Failing metric providers</p>
            {data.dashboard.failedMetrics.length ? data.dashboard.failedMetrics.map((p) => <p key={p.name} className="text-danger">{p.name}: {p.consecutiveFailures} failures in a row</p>) : <p className="text-success">None</p>}
          </div>
        </div>
      </Panel>

      <Panel
        title={`Alerts (${data.alerts.length} unacknowledged)`}
        actions={data.alerts.length > 0 && <Btn onClick={() => void run("/api/admin/health", { action: "ack-alerts" }, "Alerts acknowledged.")}>Acknowledge all</Btn>}
      >
        {data.alerts.length === 0 ? <p className="text-muted">No alerts.</p> : (
          <ul className="space-y-1">
            {data.alerts.map((a) => (
              <li key={a.id} className={a.severity === "critical" ? "text-danger" : a.severity === "warning" ? "text-warning" : ""}>
                [{a.severity}] {a.message} <span className="text-muted">· {when(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Launch gate: ${data.launchGate.ready ? "READY" : "not ready"}`}>
        <ul className="grid gap-1 md:grid-cols-2">
          {data.launchGate.checks.map((c) => (
            <li key={c.id} className="flex gap-2">
              <span aria-hidden="true" className={c.ok ? "text-success" : "text-danger"}>{c.ok ? "✓" : "✗"}</span>
              <span>
                <span className="font-medium">{c.label}</span>
                {c.manual && <span className="badge ml-1">manual</span>}
                <span className="block text-xs text-muted">{c.section} · {c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markets & review (§22, §25, §26, §33)
// ---------------------------------------------------------------------------

type MarketListRow = {
  id: string; creatorHandle: string; canonicalUrl: string; provider: string; scenario: string | null; source: string; status: string; pausedReason: string | null;
  currentLikes: number; momentumLabel: string; riskScore: number; openedAt: number; settlesAt: number; liquidity: number; finalMetric: number | null; featured: boolean; hidden: boolean;
  prices: { label: string; price: number }[]; trades: number; traders: number; volume: number;
  proposal: { finalMetric: number; source: string; capturedAt: number; issues: string[]; winningLabel: string | null } | null;
  review: { submittedAt: number; decidedAt: number | null; note: string | null } | null;
  cancellation: { label: string; explanation: string } | null; submittedBy: string | null;
  thumbnail: { url: string | null; source: string | null; broken: boolean }; simulatedAvailability: string;
};

function ReviewQueue({ version, run }: { version: number; run: RunFn }) {
  const { data } = useData<MarketListRow[]>("/api/admin/markets?status=review", version);
  const { ask, node } = usePrompt();
  if (!data) return <p className="text-muted">Loading…</p>;
  const drafts = data.filter((m) => m.status === "DRAFT");
  const settlements = data.filter((m) => m.status === "SETTLING");
  const clean = settlements.filter((m) => m.proposal && m.proposal.issues.length === 0);
  return (
    <div className="space-y-4">
      {node}
      <Panel
        title={`Settlements waiting for review (${settlements.length})`}
        actions={clean.length > 0 && (
          <Btn onClick={() => ask({ title: `Approve ${clean.length} clean settlements`, description: "Each proposal passed every integrity check. Winners are paid immediately.", fields: [], confirmWord: "APPROVE", submit: "Approve and pay out", onSubmit: () => void run("/api/admin/bulk", { action: "approve-clean-settlements", confirm: "APPROVE" }, "Settled.") })}>
            Approve all clean ({clean.length})
          </Btn>
        )}
      >
        {settlements.length === 0 ? <p className="text-muted">Nothing to review.</p> : (
          <ul className="space-y-2">
            {settlements.map((m) => (
              <li key={m.id} className="rounded-xl bg-wash p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link href={`/markets/${m.id}`} className="font-semibold">@{m.creatorHandle}</Link> <span className="text-muted">· {m.provider} · settles {when(m.settlesAt)}</span>
                    {m.proposal ? (
                      <p className="mt-1">Recorded <strong>{m.proposal.finalMetric.toLocaleString()}</strong> likes → <strong>{m.proposal.winningLabel}</strong> <span className="text-muted">({m.proposal.source}, captured {when(m.proposal.capturedAt)}; last snapshot {m.currentLikes.toLocaleString()})</span></p>
                    ) : (
                      <p className="mt-1 text-warning">No final count yet ({m.pausedReason ?? "waiting"}). Enter it manually.</p>
                    )}
                    {m.proposal?.issues.map((i) => <p key={i} className="text-danger">⚠ {i}</p>)}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {m.proposal && (
                      <Btn onClick={() => ask({
                        title: `Settle @${m.creatorHandle} at ${m.proposal!.finalMetric.toLocaleString()} likes`,
                        description: m.proposal!.issues.length ? `This proposal has issues: ${m.proposal!.issues.join("; ")}. Confirming acknowledges them.` : `Winner: ${m.proposal!.winningLabel}. Payouts happen immediately and can't be undone.`,
                        fields: [],
                        confirmWord: String(m.proposal!.finalMetric),
                        submit: "Confirm settlement",
                        onSubmit: (v) => void run(`/api/admin/markets/${m.id}`, { action: "approve-settlement", confirm: v.confirm, acknowledgeIssues: m.proposal!.issues.length > 0 }, "Settled."),
                      })}>Confirm</Btn>
                    )}
                    <Btn onClick={() => ask({
                      title: "Settle on a corrected count",
                      fields: [{ name: "finalLikes", label: "Correct final likes", type: "number" }, { name: "reason", label: "Why is the recorded number wrong?", type: "textarea" }],
                      submit: "Continue",
                      onSubmit: (v) => ask({
                        title: `Settle at ${Number(v.finalLikes).toLocaleString()} likes`,
                        fields: [],
                        confirmWord: v.finalLikes,
                        submit: "Settle",
                        danger: true,
                        onSubmit: (c) => void run(`/api/admin/markets/${m.id}`, { action: "approve-settlement", finalLikes: Number(v.finalLikes), reason: v.reason, acknowledgeIssues: true, confirm: c.confirm }, "Settled on the corrected count."),
                      }),
                    })}>{m.proposal ? "Correct" : "Enter count"}</Btn>
                    <CancelButton m={m} run={run} ask={ask} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Submitted links (${drafts.length})`}>
        <p className="mb-2 text-xs text-muted">Check each video before approving (§60): no illegal, sexual or graphic content; no minors put at risk; nothing that rewards dangerous behaviour or harassment; not known to be manipulated.</p>
        {drafts.length === 0 ? <p className="text-muted">No submissions.</p> : (
          <ul className="space-y-2">
            {drafts.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-wash p-3">
                <div>
                  <a href={m.canonicalUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">@{m.creatorHandle} ↗</a>
                  <span className="text-muted"> · submitted by {m.submittedBy ?? "?"} · {m.source} · {when(m.review?.submittedAt)} · {m.currentLikes.toLocaleString()} likes</span>
                </div>
                <div className="flex gap-1">
                  <Btn onClick={() => void run(`/api/admin/markets/${m.id}`, { action: "approve-submission" }, "Approved: market is open.")}>Approve</Btn>
                  <Btn danger onClick={() => ask({ title: "Reject submission", fields: [{ name: "note", label: "Reason (sent to the submitter)", type: "textarea" }], submit: "Reject", onSubmit: (v) => void run(`/api/admin/markets/${m.id}`, { action: "reject-submission", note: v.note }, "Rejected.") })}>Reject</Btn>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

const CANCEL_CODES = ["DELETED_CONTENT", "PRIVATE_CONTENT", "PLATFORM_OUTAGE", "METRIC_CORRUPTION", "MANIPULATION", "INCORRECT_SETUP", "CONTENT_REMOVED", "ADMIN"];

function CancelButton({ m, run, ask }: { m: { id: string; creatorHandle: string }; run: RunFn; ask: (p: Prompt) => void }) {
  return (
    <Btn danger onClick={() => ask({
      title: `Cancel @${m.creatorHandle}'s market`,
      description: "Every open position is refunded at cost and holders are notified. The reason's explanation is shown on the market page.",
      fields: [{ name: "code", label: "Reason", options: CANCEL_CODES }, { name: "note", label: "Extra public detail (optional)", type: "textarea" }],
      confirmWord: "CANCEL",
      submit: "Cancel market and refund",
      danger: true,
      onSubmit: (v) => void run(`/api/admin/markets/${m.id}`, { action: "cancel", code: v.code, note: v.note || undefined, confirm: "CANCEL" }, "Cancelled and refunded."),
    })}>Cancel</Btn>
  );
}

function Markets({ version, run }: { version: number; run: RunFn }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("live");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data } = useData<MarketListRow[]>(`/api/admin/markets?status=${status}&q=${encodeURIComponent(q)}`, version);
  const { ask, node } = usePrompt();
  return (
    <div className="space-y-4">
      {node}
      <CreateMarket run={run} ask={ask} />
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search handle, id or URL" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" />
        <select className="input max-w-[12rem]" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {["live", "all", "OPEN", "PAUSED", "LOCKED", "SETTLING", "SETTLED", "CANCELLED", "DRAFT"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto rounded-2xl bg-surface">
        <table className="w-full min-w-[1000px] text-left">
          <thead className="bg-wash text-xs text-muted">
            <tr><th className="p-3">Market</th><th className="p-3">Status</th><th className="p-3">Likes</th><th className="p-3">Prices</th><th className="p-3">Activity</th><th className="p-3">Risk</th><th className="p-3">Closes</th><th className="p-3">Actions</th></tr>
          </thead>
          <tbody>
            {(data ?? []).map((m) => (
              <tr key={m.id} className="align-top">
                <td className="p-3">
                  <Link href={`/markets/${m.id}`} className="font-semibold">@{m.creatorHandle}</Link>
                  {m.featured && <span className="badge badge-info ml-1">featured</span>}
                  {m.hidden && <span className="badge badge-danger ml-1">taken down</span>}
                  <div className="text-xs text-muted">{m.provider}{m.scenario ? ` · ${m.scenario}` : ""} · {m.source} · b={m.liquidity}</div>
                  <button className="text-xs text-crimson-soft underline" onClick={() => setOpenId(m.id)}>Details</button>
                </td>
                <td className="p-3">{m.status}{m.pausedReason && <div className="text-xs text-muted">{m.pausedReason}</div>}{m.cancellation && <div className="text-xs text-muted">{m.cancellation.label}</div>}</td>
                <td className="p-3">{compactNumber(m.currentLikes)}{m.finalMetric !== null ? ` → ${compactNumber(m.finalMetric)}` : ""}<div className="text-xs text-muted">{m.momentumLabel}</div></td>
                <td className="p-3 text-xs">{m.prices.map((p) => `${p.label} ${percent(p.price)}`).join(" · ")}</td>
                <td className="p-3 text-xs">{m.trades} trades · {m.traders} traders · W${compactNumber(m.volume)}</td>
                <td className="p-3">{m.riskScore ? m.riskScore.toFixed(2) : "—"}</td>
                <td className="p-3">{m.status === "OPEN" || m.status === "PAUSED" ? new Date(m.settlesAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}</td>
                <td className="p-3"><MarketActions m={m} run={run} ask={ask} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {openId && <MarketDetail id={openId} version={version} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function MarketActions({ m, run, ask }: { m: MarketListRow; run: RunFn; ask: (p: Prompt) => void }) {
  const path = `/api/admin/markets/${m.id}`;
  const live = ["OPEN", "PAUSED", "LOCKED", "SETTLING"].includes(m.status);
  return (
    <div className="flex max-w-xs flex-wrap gap-1">
      {m.status === "OPEN" && <Btn onClick={() => ask({ title: "Pause trading", fields: [{ name: "reason", label: "Reason (shown to users)", initial: "Unusual activity is under review." }], submit: "Pause", onSubmit: (v) => void run(path, { action: "pause", reason: v.reason }, "Paused.") })}>Pause</Btn>}
      {m.status === "PAUSED" && <Btn onClick={() => void run(path, { action: "resume" }, "Resumed.")}>Resume</Btn>}
      {live && m.status !== "SETTLING" && <Btn onClick={() => void run(path, { action: "refresh-metric" }, "Metric refreshed.")}>Refresh likes</Btn>}
      {live && m.provider === "manual" && <Btn onClick={() => ask({ title: "Enter current likes", fields: [{ name: "likes", label: "Likes now", type: "number" }], submit: "Save", onSubmit: (v) => void run(path, { action: "set-likes", likes: Number(v.likes) }, "Saved.") })}>Set likes</Btn>}
      {(m.status === "LOCKED" || m.status === "SETTLING") && m.provider === "manual" && <Btn onClick={() => ask({ title: "Propose final count", fields: [{ name: "finalLikes", label: "Final likes at the 24h mark", type: "number" }], submit: "Propose (goes to review)", onSubmit: (v) => void run(path, { action: "propose-settlement", finalLikes: Number(v.finalLikes) }, "Proposed. Confirm it in the review queue.") })}>Final count</Btn>}
      {!["SETTLED", "CANCELLED"].includes(m.status) && <Btn onClick={() => void run(path, { action: "feature", featured: !m.featured }, m.featured ? "Unfeatured." : "Featured.")}>{m.featured ? "Unfeature" : "Feature"}</Btn>}
      <Btn onClick={() => void run(path, { action: "refresh-thumbnail" }, "Thumbnail refreshed.")}>Thumbnail</Btn>
      {m.provider === "mock" && live && <Btn onClick={() => ask({ title: "Simulate video availability (staging)", fields: [{ name: "availability", label: "Video state", options: ["deleted", "private", "available"] }], submit: "Apply", onSubmit: (v) => void run(path, { action: "simulate-availability", availability: v.availability }, "Applied.") })}>Simulate</Btn>}
      {live && <CancelButton m={m} run={run} ask={ask} />}
      {!m.hidden && <Btn danger onClick={() => ask({ title: "Take down this video", description: "Hides it everywhere, removes the thumbnail link, and cancels a live market with refunds.", fields: [{ name: "reason", label: "Reason", type: "textarea" }], confirmWord: "TAKEDOWN", submit: "Take down", danger: true, onSubmit: (v) => void run(path, { action: "takedown", reason: v.reason, confirm: "TAKEDOWN" }, "Taken down.") })}>Takedown</Btn>}
      {m.trades === 0 && live && <Btn onClick={() => ask({ title: "Edit liquidity (before first trade)", fields: [{ name: "liquidity", label: "b", type: "number", initial: String(m.liquidity) }], submit: "Save", onSubmit: (v) => void run(path, { action: "edit-liquidity", liquidity: Number(v.liquidity) }, "Saved.") })}>Edit b</Btn>}
      <Btn danger onClick={() => ask({ title: "Reset market (staging only)", description: "Cancels with refunds and opens a fresh simulated copy.", fields: [], confirmWord: "RESET", submit: "Reset", danger: true, onSubmit: () => void run(path, { action: "reset", confirm: "RESET" }, "Reset.") })}>Reset</Btn>
    </div>
  );
}

function MarketDetail({ id, version, onClose }: { id: string; version: number; onClose: () => void }) {
  const { data } = useData<Json>(`/api/admin/markets/${id}`, version);
  const d = data as null | {
    outcomes: { label: string; price: number; model: number; quantity: number; min: number | null; max: number | null }[];
    rangeBasis: Json | null; snapshots: { t: number; likes: number; source: string; suspicious: boolean }[];
    largeRepricings: { at: number; move: number; explanation: string }[]; flags: { id: string; reason: string; severity: number; status?: string }[];
    audit: { id: string; createdAt: number; actor: string | null; action: string; metadata: Json }[];
  };
  return (
    <Dialog title="Market detail" onClose={onClose} wide>
      {!d ? <p className="text-muted">Loading…</p> : (
        <div className="space-y-4 text-xs">
          <div>
            <p className="font-semibold">Ranges</p>
            {d.outcomes.map((o) => <p key={o.label}>{o.label}: price {percent(o.price, 1)} · model {percent(o.model, 1)} · q={o.quantity.toFixed(1)}</p>)}
            {d.rangeBasis && <p className="text-muted">Range basis: {JSON.stringify(d.rangeBasis)}</p>}
          </div>
          <div>
            <p className="font-semibold">Large repricings (explained)</p>
            {d.largeRepricings.length === 0 ? <p className="text-muted">None.</p> : d.largeRepricings.map((r) => <p key={r.at}>{when(r.at)} · {(r.move * 100).toFixed(1)} pts · {r.explanation}</p>)}
          </div>
          <div>
            <p className="font-semibold">Recent snapshots</p>
            <p className="font-mono">{d.snapshots.map((s) => `${new Date(s.t).toLocaleTimeString()} ${s.likes}${s.suspicious ? "⚠" : ""}`).join(" · ")}</p>
          </div>
          <div>
            <p className="font-semibold">Risk flags</p>
            {d.flags.length === 0 ? <p className="text-muted">None.</p> : d.flags.map((f) => <p key={f.id}>{f.reason} ({f.severity.toFixed(1)}, {f.status ?? "open"})</p>)}
          </div>
          <div>
            <p className="font-semibold">Audit</p>
            {d.audit.map((a) => <p key={a.id} className="font-mono">{new Date(a.createdAt).toISOString()} {a.actor ?? "system"} {a.action} {JSON.stringify(a.metadata)}</p>)}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function CreateMarket({ run, ask }: { run: RunFn; ask: (p: Prompt) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Btn onClick={() => ask({ title: "Create simulated market", fields: [{ name: "scenario", label: "Scenario", options: ["viral-spike", "slow-growth", "spike-decay", "stable-mid", "late-spike", "flat", "fake-spike", "double-spike"] }, { name: "handle", label: "Handle (optional)" }], submit: "Create", onSubmit: (v) => void run("/api/admin/markets", { kind: "simulated", scenario: v.scenario, handle: v.handle || undefined }, "Created.") })}>+ Simulated market</Btn>
      <Btn onClick={() => ask({
        title: "Create manual market (admin override)",
        description: "Likes are entered by hand. Eligibility rules are skipped.",
        fields: [{ name: "url", label: "TikTok URL" }, { name: "initialLikes", label: "Likes now", type: "number" }, { name: "ageMinutes", label: "Video age in minutes (optional)", type: "number" }, { name: "followers", label: "Creator followers (optional)", type: "number" }, { name: "avgLikes", label: "Creator average likes (optional)", type: "number" }],
        submit: "Create",
        onSubmit: (v) => void run("/api/admin/markets", { kind: "manual", url: v.url, initialLikes: Number(v.initialLikes), ageMinutes: v.ageMinutes ? Number(v.ageMinutes) : undefined, followers: v.followers ? Number(v.followers) : undefined, avgLikes: v.avgLikes ? Number(v.avgLikes) : undefined }, "Created."),
      })}>+ Manual market</Btn>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users (§33)
// ---------------------------------------------------------------------------

type UserListRow = { id: string; username: string; email: string | null; emailVerified: boolean; balance: number; role: string; status: string; riskScore: number; cohort: string | null; createdAt: number; lastActiveAt: number | null; trades: number };

function Users({ version, run }: { version: number; run: RunFn }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data } = useData<UserListRow[]>(`/api/admin/users?q=${encodeURIComponent(q)}&filter=${filter}`, version);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search username, email or id" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        <select className="input max-w-[12rem]" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter">
          <option value="">All</option>
          <option value="flagged">Flagged</option>
          <option value="restricted">Frozen / suspended</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-2xl bg-surface">
        <table className="w-full min-w-[800px] text-left">
          <thead className="bg-wash text-xs text-muted"><tr><th className="p-3">User</th><th className="p-3">Balance</th><th className="p-3">Status</th><th className="p-3">Risk</th><th className="p-3">Trades</th><th className="p-3">Joined / active</th></tr></thead>
          <tbody>
            {(data ?? []).map((u) => (
              <tr key={u.id}>
                <td className="p-3">
                  <button className="font-semibold underline" onClick={() => setOpenId(u.id)}>{u.username}</button>
                  <div className="text-xs text-muted">{u.email ?? "no email"}{u.email && !u.emailVerified ? " (unverified)" : ""}{u.cohort ? ` · ${u.cohort}` : ""}{u.role !== "user" ? ` · ${u.role}` : ""}</div>
                </td>
                <td className="p-3">{credits(u.balance, { decimals: 2 })}</td>
                <td className="p-3">{u.status}</td>
                <td className="p-3">{u.riskScore ? u.riskScore.toFixed(2) : "—"}</td>
                <td className="p-3">{u.trades}</td>
                <td className="p-3 text-xs">{when(u.createdAt)}<br />{when(u.lastActiveAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {openId && <UserDetail id={openId} version={version} run={run} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function UserDetail({ id, version, run, onClose }: { id: string; version: number; run: RunFn; onClose: () => void }) {
  const { data } = useData<Json>(`/api/admin/users/${id}`, version);
  const { ask, node } = usePrompt();
  const d = data as null | {
    user: Json & { username: string; status: string; creditsBalance: number; role?: string };
    ledger: { id: string; type: string; amount: number; balanceAfter: number; description?: string; createdAt: number }[];
    trades: { id: string; side: string; credits: number; shares: number; handle?: string; outcome?: string; createdAt: number }[];
    flags: { id: string; reason: string; severity: number; status?: string }[];
    relatedAccounts: { id: string; username: string }[];
    sessions: { createdAt: number; lastSeenAt: number | null; userAgent: string | null }[];
  };
  const path = `/api/admin/users/${id}`;
  return (
    <Dialog title={d ? `${d.user.username}` : "User"} onClose={onClose} wide>
      {node}
      {!d ? <p className="text-muted">Loading…</p> : (
        <div className="space-y-4 text-xs">
          <p className="text-sm">Balance <strong>{credits(d.user.creditsBalance, { decimals: 2 })}</strong> · status <strong>{d.user.status}</strong> · role {d.user.role ?? "user"}</p>
          <div className="flex flex-wrap gap-1">
            <Btn onClick={() => ask({ title: "Adjust balance", fields: [{ name: "amount", label: "± W$", type: "number" }, { name: "reason", label: "Reason (shown in their wallet)" }], submit: "Continue", onSubmit: (v) => ask({ title: `Adjust by ${v.amount}`, fields: [], confirmWord: Math.abs(Number(v.amount)) >= 1000 ? v.amount : undefined, submit: "Apply", onSubmit: (c) => void run(path, { action: "adjust", amount: Number(v.amount), reason: v.reason, confirm: c.confirm || undefined }, "Adjusted.") }) })}>Adjust</Btn>
            <Btn onClick={() => ask({ title: "Refund", fields: [{ name: "amount", label: "W$", type: "number" }, { name: "tradeId", label: "Trade id (optional)" }, { name: "reason", label: "Reason" }], submit: "Continue", onSubmit: (v) => ask({ title: `Refund ${v.amount}`, fields: [], confirmWord: Number(v.amount) >= 1000 ? v.amount : undefined, submit: "Refund", onSubmit: (c) => void run(path, { action: "refund", amount: Number(v.amount), tradeId: v.tradeId || undefined, reason: v.reason, confirm: c.confirm || undefined }, "Refunded.") }) })}>Refund</Btn>
            {d.user.status === "active" && <Btn onClick={() => ask({ title: "Freeze trading", description: "They can browse but not trade while under review.", fields: [{ name: "reason", label: "Reason" }], submit: "Freeze", onSubmit: (v) => void run(path, { action: "freeze", reason: v.reason }, "Frozen.") })}>Freeze</Btn>}
            {d.user.status !== "suspended" && <Btn danger onClick={() => ask({ title: "Suspend account", description: "Signs them out everywhere and blocks sign-in.", fields: [{ name: "reason", label: "Reason" }], confirmWord: "SUSPEND", submit: "Suspend", danger: true, onSubmit: (v) => void run(path, { action: "suspend", reason: v.reason, confirm: "SUSPEND" }, "Suspended.") })}>Suspend</Btn>}
            {d.user.status !== "active" && <Btn onClick={() => ask({ title: "Reinstate", fields: [{ name: "reason", label: "Reason" }], submit: "Reinstate", onSubmit: (v) => void run(path, { action: "reinstate", reason: v.reason }, "Reinstated.") })}>Reinstate</Btn>}
            <Btn onClick={() => ask({ title: "Rename (moderation)", fields: [{ name: "username", label: "New username" }], submit: "Rename", onSubmit: (v) => void run(path, { action: "rename", username: v.username }, "Renamed.") })}>Rename</Btn>
            <Btn onClick={() => ask({ title: "Change role", fields: [{ name: "role", label: "Role", options: ["user", "support", "admin"] }], confirmWord: "ROLE", submit: "Change", onSubmit: (v) => void run(path, { action: "role", role: v.role, confirm: "ROLE" }, "Role changed.") })}>Role</Btn>
            <Btn onClick={() => void run(path, { action: "resend-verification" }, "Verification sent.")}>Resend verification</Btn>
            <Btn danger onClick={() => ask({ title: "Delete account (on request)", fields: [{ name: "reason", label: "Request reference" }], confirmWord: "DELETE", submit: "Delete", danger: true, onSubmit: (v) => void run(path, { action: "delete", reason: v.reason, confirm: "DELETE" }, "Deleted.") })}>Delete</Btn>
          </div>
          {d.relatedAccounts.length > 0 && <p className="text-warning">Shares a device or network with: {d.relatedAccounts.map((r) => r.username).join(", ")}</p>}
          <div>
            <p className="font-semibold">Flags</p>
            {d.flags.length === 0 ? <p className="text-muted">None.</p> : d.flags.map((f) => <p key={f.id}>{f.reason} ({f.severity.toFixed(1)}, {f.status ?? "open"})</p>)}
          </div>
          <div>
            <p className="font-semibold">Balance history</p>
            <div className="max-h-48 overflow-y-auto">
              {d.ledger.map((l) => <p key={l.id} className="font-mono">{new Date(l.createdAt).toLocaleString()} {l.type} {l.amount >= 0 ? "+" : ""}{l.amount} → {l.balanceAfter} {l.description ?? ""}</p>)}
            </div>
          </div>
          <div>
            <p className="font-semibold">Trades</p>
            <div className="max-h-48 overflow-y-auto">
              {d.trades.map((t) => <p key={t.id} className="font-mono">{new Date(t.createdAt).toLocaleString()} {t.side} {t.outcome} @{t.handle} W${t.credits} ({t.shares.toFixed(2)} sh) · {t.id}</p>)}
            </div>
          </div>
          <div>
            <p className="font-semibold">Sessions</p>
            {d.sessions.map((s, i) => <p key={i}>{when(s.lastSeenAt)} · {s.userAgent ?? "?"}</p>)}
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Risk (§27)
// ---------------------------------------------------------------------------

function Risk({ version, run }: { version: number; run: RunFn }) {
  const [status, setStatus] = useState("open");
  const { data } = useData<{ id: string; entityType: string; entityId: string; label?: string; reason: string; severity: number; createdAt: number; status: string; resolution?: string | null; metadata: Json }[]>(`/api/admin/risk?status=${status}`, version);
  const { ask, node } = usePrompt();
  return (
    <div className="space-y-3">
      {node}
      <select className="input max-w-[12rem]" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
        {["open", "resolved", "dismissed", "all"].map((s) => <option key={s}>{s}</option>)}
      </select>
      <p className="text-xs text-muted">Flags never punish anyone on their own. Review, then freeze/suspend a user or pause/cancel a market if needed.</p>
      <ul className="space-y-2">
        {(data ?? []).map((f) => (
          <li key={f.id} className="rounded-2xl bg-surface p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <span className="font-semibold">{f.reason}</span> · {f.entityType} {f.label ?? f.entityId} · severity {f.severity.toFixed(1)} · <span className="text-muted">{when(f.createdAt)}</span>
                {f.entityType === "market" && <Link className="ml-2 text-crimson-soft" href={`/markets/${f.entityId}`}>view</Link>}
                <p className="font-mono text-xs text-muted">{JSON.stringify(f.metadata)}</p>
                {f.resolution && <p className="text-xs">Resolution: {f.resolution}</p>}
              </div>
              {f.status === "open" && (
                <div className="flex gap-1">
                  <Btn onClick={() => ask({ title: "Resolve flag", fields: [{ name: "resolution", label: "What you found and did", type: "textarea" }], submit: "Resolve", onSubmit: (v) => void run("/api/admin/risk", { id: f.id, status: "resolved", resolution: v.resolution }, "Resolved.") })}>Resolve</Btn>
                  <Btn onClick={() => ask({ title: "Dismiss flag", fields: [{ name: "resolution", label: "Why it's a false alarm", type: "textarea" }], submit: "Dismiss", onSubmit: (v) => void run("/api/admin/risk", { id: f.id, status: "dismissed", resolution: v.resolution }, "Dismissed.") })}>Dismiss</Btn>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Support (§48)
// ---------------------------------------------------------------------------

type Ticket = { id: string; username: string | null; email: string | null; categoryLabel: string; subject: string; body: string; status: string; priority: string; createdAt: number; entityType: string | null; entityId: string | null; replies: { at: number; by: string; body: string; internal: boolean }[] };

function Support({ version, run }: { version: number; run: RunFn }) {
  const [status, setStatus] = useState("active");
  const { data } = useData<{ tickets: Ticket[]; canned: { id: string; title: string; body: string }[]; feedback: { id: string; kind: string; rating: number | null; body: string; createdAt: number }[] }>(`/api/admin/support?status=${status}`, version);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!data) return <p className="text-muted">Loading…</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-2">
        <select className="input max-w-[12rem]" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {["active", "open", "pending", "resolved", "all"].map((s) => <option key={s}>{s}</option>)}
        </select>
        {data.tickets.length === 0 && <p className="text-muted">No tickets.</p>}
        {data.tickets.map((t) => (
          <div key={t.id} className="rounded-2xl bg-surface p-3">
            <p>
              {t.priority === "high" && <span className="badge badge-danger mr-1">high</span>}
              <strong>{t.subject}</strong> · {t.categoryLabel} · {t.status}
            </p>
            <p className="text-xs text-muted">{t.username ?? "guest"} · {t.email ?? "no email"} · {when(t.createdAt)}{t.entityId ? ` · ${t.entityType} ${t.entityId}` : ""}</p>
            <p className="mt-2 whitespace-pre-wrap">{t.body}</p>
            {t.replies.map((r) => <p key={r.at} className={`mt-1 whitespace-pre-wrap rounded-lg p-2 text-xs ${r.internal ? "bg-warning/10" : "bg-wash"}`}>{r.internal ? "Internal note" : "Reply"} by {r.by}: {r.body}</p>)}
            <textarea className="input mt-2" placeholder="Reply…" value={drafts[t.id] ?? ""} onChange={(e) => setDrafts({ ...drafts, [t.id]: e.target.value })} aria-label="Reply" />
            <div className="mt-1 flex flex-wrap gap-1">
              <select className="input h-9 max-w-[12rem] text-xs" onChange={(e) => { const c = data.canned.find((x) => x.id === e.target.value); if (c) setDrafts({ ...drafts, [t.id]: c.body }); }} aria-label="Insert canned response" defaultValue="">
                <option value="" disabled>Canned response…</option>
                {data.canned.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
              <Btn onClick={() => void run("/api/admin/support", { ticketId: t.id, body: drafts[t.id] ?? "", internal: false }, "Reply sent.").then(() => setDrafts({ ...drafts, [t.id]: "" }))}>Send reply</Btn>
              <Btn onClick={() => void run("/api/admin/support", { ticketId: t.id, body: drafts[t.id] ?? "", internal: true }, "Note saved.").then(() => setDrafts({ ...drafts, [t.id]: "" }))}>Internal note</Btn>
              <Btn onClick={() => void run("/api/admin/support", { ticketId: t.id, body: "", status: "resolved" }, "Resolved.")}>Resolve</Btn>
            </div>
          </div>
        ))}
      </div>
      <Panel title="Feedback">
        <ul className="space-y-2">
          {data.feedback.map((f) => <li key={f.id}><span className="badge">{f.kind}</span> {f.rating ? `${f.rating}/5 ` : ""}{f.body} <span className="text-xs text-muted">{when(f.createdAt)}</span></li>)}
        </ul>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metrics & model (§39–§41)
// ---------------------------------------------------------------------------

function Metrics({ version }: { version: number }) {
  const { data } = useData<{ business: Record<string, number | null>; cohorts: { cohort: string; size: number; weeks: (number | null)[] }[]; funnel: { step: string; users: number }[] }>("/api/admin/metrics", version);
  if (!data) return <p className="text-muted">Loading…</p>;
  const b = data.business;
  const rows: [string, ReactNode][] = [
    ["Registered users", b.registeredUsers], ["DAU", b.dau], ["WAU", b.wau], ["MAU", b.mau], ["Active traders (7d)", b.activeTraders7d], ["New traders (7d)", b.newTraders7d],
    ["Trades per trader", num(b.tradesPerTrader, 1)], ["Markets per trader", num(b.marketsPerTrader, 1)], ["Average trade (W$)", num(b.averageTradeSize, 0)], ["Median trade (W$)", num(b.medianTradeSize, 0)],
    ["Total volume (W$)", compactNumber(b.totalVolume ?? 0)], ["First-trade conversion", pct(b.firstTradeConversion)], ["Second-trade conversion", pct(b.secondTradeConversion)],
    ["D1 retention", pct(b.retentionD1)], ["D7 retention", pct(b.retentionD7)], ["D28 retention", pct(b.retentionD28)], ["Sold before settlement", pct(b.sellBeforeSettlementRate)],
    ["Markets with low liquidity", b.marketsWithLowLiquidity], ["Trades per market", num(b.averageTradesPerMarket, 1)], ["Shares per trader", num(b.creatorShareRate, 2)],
    ["Referral conversion", pct(b.referralConversion)], ["Model Brier (lower is better)", num(b.modelBrier, 3)], ["Median time to first trade (min)", num(b.timeToFirstTradeMedianMin, 0)],
    ["Median session (min)", num(b.sessionLengthMedianMin, 1)], ["Markets viewed per session", num(b.marketsViewedPerSession, 1)],
  ];
  return (
    <div className="space-y-4">
      <Panel title="Business metrics (bots excluded)">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-5">{rows.map(([l, v]) => <Kpi key={l} label={l} value={v ?? "—"} />)}</div>
      </Panel>
      <Panel title="Funnel (sign-ups, last 30 days)">
        {data.funnel.map((f, i) => (
          <div key={f.step} className="flex items-center gap-3 py-1">
            <span className="w-40">{f.step}</span>
            <span className="h-3 flex-1 rounded-full bg-wash"><span className="bg-gradient-main block h-3 rounded-full" style={{ width: `${data.funnel[0].users ? (f.users / data.funnel[0].users) * 100 : 0}%` }} /></span>
            <span className="tabular w-24 text-right">{f.users}{i > 0 && data.funnel[0].users ? ` (${Math.round((f.users / data.funnel[0].users) * 100)}%)` : ""}</span>
          </div>
        ))}
      </Panel>
      <Panel title="Weekly cohorts: share active N weeks after sign-up">
        <div className="overflow-x-auto">
          <table className="tabular text-xs">
            <thead><tr><th className="p-1 text-left">Cohort</th><th className="p-1">Size</th>{data.cohorts.map((_, i) => <th key={i} className="p-1">W{i}</th>)}</tr></thead>
            <tbody>
              {data.cohorts.map((c) => (
                <tr key={c.cohort}>
                  <td className="p-1">{c.cohort}</td><td className="p-1 text-center">{c.size}</td>
                  {c.weeks.map((w, i) => <td key={i} className="p-1 text-center" style={{ background: w === null ? undefined : `rgba(220,20,60,${0.08 + w * 0.6})` }}>{w === null ? "" : `${Math.round(w * 100)}%`}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

type Summary = { n: number; brier: number | null; logloss: number | null; accuracy: number | null };

function SummaryTable({ title, rows }: { title: string; rows: Record<string, Summary> }) {
  return (
    <Panel title={title}>
      <table className="tabular w-full text-xs">
        <thead><tr className="text-left text-muted"><th className="p-1">Group</th><th className="p-1">n</th><th className="p-1">Brier</th><th className="p-1">Log loss</th><th className="p-1">Top-range accuracy</th></tr></thead>
        <tbody>{Object.entries(rows).map(([k, s]) => <tr key={k}><td className="p-1">{k}</td><td className="p-1">{s.n}</td><td className="p-1">{num(s.brier, 3)}</td><td className="p-1">{num(s.logloss, 3)}</td><td className="p-1">{pct(s.accuracy)}</td></tr>)}</tbody>
      </table>
    </Panel>
  );
}

function Model({ version }: { version: number }) {
  const { data } = useData<{ overall: Summary; naiveBaseline: Summary; calibration: { bin: string; n: number; predicted: number | null; actual: number | null }[]; byVideoAge: Record<string, Summary>; byCreatorSize: Record<string, Summary>; byMomentum: Record<string, Summary>; duringSpikes: Summary; byVersion: Record<string, Summary>; drift: { weeksAgo: number; markets: number; brier: number | null }[]; dataQualityAlerts: number }>("/api/admin/metrics?part=model", version);
  if (!data) return <p className="text-muted">Loading…</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SummaryTable title="Model vs naive linear baseline (settled markets, hourly checkpoints)" rows={{ model: data.overall, "naive linear": data.naiveBaseline, "during spikes": data.duringSpikes }} />
      <Panel title="Calibration">
        <table className="tabular w-full text-xs">
          <thead><tr className="text-left text-muted"><th className="p-1">Predicted</th><th className="p-1">n</th><th className="p-1">Avg predicted</th><th className="p-1">Actual hit rate</th></tr></thead>
          <tbody>{data.calibration.filter((c) => c.n).map((c) => <tr key={c.bin}><td className="p-1">{c.bin}</td><td className="p-1">{c.n}</td><td className="p-1">{pct(c.predicted)}</td><td className="p-1">{pct(c.actual)}</td></tr>)}</tbody>
        </table>
      </Panel>
      <SummaryTable title="By time since upload" rows={data.byVideoAge} />
      <SummaryTable title="By creator size" rows={data.byCreatorSize} />
      <SummaryTable title="By momentum" rows={data.byMomentum} />
      <SummaryTable title="By model version" rows={data.byVersion} />
      <Panel title="Drift (Brier by week settled)">
        {data.drift.map((d) => <p key={d.weeksAgo}>{d.weeksAgo === 0 ? "This week" : `${d.weeksAgo} week(s) ago`}: {num(d.brier, 3)} ({d.markets} markets)</p>)}
        <p className="mt-2 text-muted">Open data-quality alerts: {data.dataQualityAlerts}</p>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health (§42), controls (§56, §57, §58), creators, audit
// ---------------------------------------------------------------------------

function Health({ version }: { version: number }) {
  const { data } = useData<Json>("/api/admin/health", version);
  const [integrity, setIntegrity] = useState<Json | null>(null);
  if (!data) return <p className="text-muted">Loading…</p>;
  const h = data as {
    appEnv: string; uptimeSec: number; memoryMb: number; demoWorlds: number;
    store: { lastFlushAt: number | null; lastFlushError: string | null; dataFileBytes: number; diskFreeBytes: number | null; lastBackupAt: number | null; lastBackupError: string | null; backups: { file: string; bytes: number; createdAt: number }[] };
    env: { ok: boolean; errors: string[]; warnings: string[] };
    jobs: { name: string; lastRunAt: number | null; lastSuccessAt: number | null; lastError: string | null; runs: number; failures: number; lastDurationMs: number | null }[];
    providers: { name: string; lastSuccessAt: number | null; lastError: string | null; consecutiveFailures: number; calls: number; failures: number }[];
    errors: { fingerprint: string; source: string; message: string; count: number; lastSeenAt: number }[];
    latency: { route: string; count: number; errorRate: number; p50: number; p95: number; p99: number }[];
    costs: { providerCalls: number; emailsSentLast30d: number; stateBytes: number; monthlyBudgetUsd: number | null };
    outbox: { id: string; to: string; subject: string; status: string; createdAt: number; text?: string }[];
  };
  const mb = (b: number | null) => (b === null ? "—" : `${(b / 1e6).toFixed(1)} MB`);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="System">
        <p>Env {h.appEnv} · up {duration(h.uptimeSec * 1000)} · {h.memoryMb} MB RAM · {h.demoWorlds} demo sandboxes</p>
        <p>State file {mb(h.store.dataFileBytes)} · disk free {mb(h.store.diskFreeBytes)} · last save {when(h.store.lastFlushAt)} {h.store.lastFlushError && <span className="text-danger">({h.store.lastFlushError})</span>}</p>
        <p>Last backup {when(h.store.lastBackupAt)} {h.store.lastBackupError && <span className="text-danger">({h.store.lastBackupError})</span>} · {h.store.backups.length} recent files</p>
        <p className={h.env.ok ? "text-success" : "text-danger"}>Environment {h.env.ok ? "valid" : "INVALID"}</p>
        {h.env.errors.map((e) => <p key={e} className="text-danger">{e}</p>)}
        {h.env.warnings.map((e) => <p key={e} className="text-warning">{e}</p>)}
        <div className="mt-2 flex gap-2">
          <Btn onClick={() => void api<{ integrity: Json }>("/api/admin/health?integrity=1").then((r) => setIntegrity(r.integrity))}>Run balance audit</Btn>
        </div>
        {integrity && (
          <div className="mt-2 text-xs">
            <p className={integrity.ok ? "text-success" : "text-danger"}>{integrity.ok ? "✓ Every balance matches the ledger; market state and settlements reconcile." : `${(integrity.issues as unknown[]).length} issue(s):`}</p>
            {(integrity.issues as { check: string; entity: string; detail: string }[]).slice(0, 30).map((i, k) => <p key={k} className="font-mono">{i.check} {i.entity}: {i.detail}</p>)}
          </div>
        )}
      </Panel>
      <Panel title="Costs & usage (compare with provider bills)">
        <p>Provider calls: {h.costs.providerCalls.toLocaleString()}</p>
        <p>Emails sent (30d): {h.costs.emailsSentLast30d}</p>
        <p>Monthly budget: {h.costs.monthlyBudgetUsd ? `$${h.costs.monthlyBudgetUsd}` : "not set (MONTHLY_BUDGET_USD)"}</p>
      </Panel>
      <Panel title="Jobs">
        {h.jobs.map((j) => <p key={j.name} className={j.lastError && j.lastRunAt === j.lastRunAt ? "" : ""}>{j.name}: {j.runs} runs, {j.failures} failures · last ok {when(j.lastSuccessAt)} · {j.lastDurationMs ?? "—"} ms {j.lastError && <span className="text-danger">· {j.lastError}</span>}</p>)}
      </Panel>
      <Panel title="Metric providers">
        {h.providers.map((p) => <p key={p.name} className={p.consecutiveFailures ? "text-danger" : ""}>{p.name}: {p.calls} calls, {p.failures} failures · last ok {when(p.lastSuccessAt)}{p.lastError ? ` · ${p.lastError}` : ""}</p>)}
      </Panel>
      <Panel title="Errors (grouped)">
        {h.errors.length === 0 ? <p className="text-muted">None.</p> : h.errors.map((e) => <p key={e.fingerprint}><span className="badge">{e.source}</span> ×{e.count} {e.message} <span className="text-muted">· {when(e.lastSeenAt)}</span></p>)}
      </Panel>
      <Panel title="API latency & error rate (this instance)">
        <table className="tabular w-full text-xs">
          <thead><tr className="text-left text-muted"><th>Route</th><th>n</th><th>err</th><th>p50</th><th>p95</th><th>p99</th></tr></thead>
          <tbody>{h.latency.map((l) => <tr key={l.route}><td className="pr-2">{l.route}</td><td>{l.count}</td><td>{pct(l.errorRate)}</td><td>{l.p50}</td><td className={l.p95 > 1000 ? "text-warning" : ""}>{l.p95}</td><td>{l.p99}</td></tr>)}</tbody>
        </table>
      </Panel>
      <Panel title="Recent email">
        {h.outbox.map((e) => <details key={e.id}><summary>{when(e.createdAt)} · {e.status} · {e.to} · {e.subject}</summary>{e.text && <pre className="whitespace-pre-wrap text-xs text-muted">{e.text}</pre>}</details>)}
      </Panel>
    </div>
  );
}

function Controls({ version, run }: { version: number; run: RunFn }) {
  const { data: flags } = useData<{ name: string; description: string; kind: string; enabled: boolean; rollout: number; value: number | null; updatedAt: number; updatedBy: string | null }[]>("/api/admin/flags", version);
  const { data: invites } = useData<{ code: string; cohort: string; maxUses: number; uses: number; members: number; expiresAt: number | null }[]>("/api/admin/invites", version);
  const { ask, node } = usePrompt();
  return (
    <div className="space-y-4">
      {node}
      <Panel title="Incident controls (§56)">
        <div className="flex flex-wrap gap-2">
          <Btn danger onClick={() => ask({ title: "Pause every open market", fields: [{ name: "reason", label: "Reason (shown to users)", initial: "Maintenance" }], confirmWord: "PAUSE ALL", submit: "Pause all", danger: true, onSubmit: (v) => void run("/api/admin/bulk", { action: "pause-all", reason: v.reason, confirm: "PAUSE ALL" }, "All markets paused.") })}>Pause all markets</Btn>
          <Btn onClick={() => void run("/api/admin/bulk", { action: "resume-all" }, "Markets resumed.")}>Resume markets paused by Wesify</Btn>
          <Btn danger onClick={() => ask({ title: "Disable trading everywhere", fields: [], confirmWord: "CONFIRM", submit: "Disable trading", danger: true, onSubmit: () => void run("/api/admin/bulk", { action: "trading-kill-switch", enabled: true, confirm: "CONFIRM" }, "Trading disabled globally.") })}>Kill switch: disable trading</Btn>
          <Btn onClick={() => ask({ title: "Re-enable trading", fields: [], confirmWord: "CONFIRM", submit: "Enable", onSubmit: () => void run("/api/admin/bulk", { action: "trading-kill-switch", enabled: false, confirm: "CONFIRM" }, "Trading re-enabled.") })}>Re-enable trading</Btn>
        </div>
      </Panel>
      <Panel title="Feature flags (§57)">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-muted"><th className="p-1">Flag</th><th className="p-1">State</th><th className="p-1">Rollout / value</th><th className="p-1">Changed</th><th className="p-1" /></tr></thead>
          <tbody>
            {(flags ?? []).map((f) => (
              <tr key={f.name} className="align-top">
                <td className="p-1"><strong>{f.name}</strong><p className="text-muted">{f.description}</p></td>
                <td className="p-1">{f.enabled ? <span className="text-success">on</span> : <span className="text-danger">off</span>}</td>
                <td className="p-1">{f.kind === "number" ? f.value ?? 0 : f.kind === "rollout" ? `${f.rollout}%` : "—"}</td>
                <td className="p-1">{f.updatedBy ? `${f.updatedBy} · ${when(f.updatedAt)}` : "default"}</td>
                <td className="p-1">
                  <div className="flex gap-1">
                    <Btn onClick={() => void run("/api/admin/flags", { name: f.name, enabled: !f.enabled }, `${f.name} ${f.enabled ? "off" : "on"}.`)}>{f.enabled ? "Turn off" : "Turn on"}</Btn>
                    {f.kind === "rollout" && <Btn onClick={() => ask({ title: `Rollout for ${f.name}`, fields: [{ name: "rollout", label: "% of signed-in users", type: "number", initial: String(f.rollout) }], submit: "Save", onSubmit: (v) => void run("/api/admin/flags", { name: f.name, rollout: Number(v.rollout) }, "Saved.") })}>Rollout</Btn>}
                    {f.kind === "number" && <Btn onClick={() => ask({ title: `Value for ${f.name}`, fields: [{ name: "value", label: "Value (0 = no cap)", type: "number", initial: String(f.value ?? 0) }], submit: "Save", onSubmit: (v) => void run("/api/admin/flags", { name: f.name, value: Number(v.value) }, "Saved.") })}>Set</Btn>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Beta invites (§58)" actions={<Btn onClick={() => ask({ title: "Create invite code", fields: [{ name: "cohort", label: "Cohort tag", initial: "alpha-1" }, { name: "maxUses", label: "Max uses", type: "number", initial: "20" }, { name: "expiresInDays", label: "Expires in days (optional)", type: "number" }], submit: "Create", onSubmit: (v) => void run("/api/admin/invites", { cohort: v.cohort, maxUses: Number(v.maxUses), expiresInDays: v.expiresInDays ? Number(v.expiresInDays) : undefined }, "Invite created.") })}>+ Invite</Btn>}>
        {(invites ?? []).length === 0 ? <p className="text-muted">No invites. Turn on the inviteOnly flag to require them.</p> : (invites ?? []).map((i) => <p key={i.code} className="font-mono">{i.code} · {i.cohort} · {i.uses}/{i.maxUses} used · {i.members} members{i.expiresAt ? ` · expires ${when(i.expiresAt)}` : ""}</p>)}
      </Panel>
    </div>
  );
}

type CreatorApplication = { id: string; username: string; status: string; platform: string; handle: string; profileUrl: string; followerCount: number; about: string; submittedAt: number; decidedAt: number | null; decisionNote: string | null; contractSignedAt: number | null; contractVersion: string | null };

function Creators({ version, run }: { version: number; run: RunFn }) {
  const { data } = useData<{ applications: CreatorApplication[] }>("/api/admin/creators", version);
  const { ask, node } = usePrompt();
  const apps = data?.applications ?? [];
  return (
    <ul className="space-y-2">
      {node}
      {apps.length === 0 && <li className="text-muted">No applications yet.</li>}
      {apps.map((a) => (
        <li key={a.id} className="rounded-2xl bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{a.username} · @{a.handle} <span className="text-xs text-muted">{a.platform} · {compactNumber(a.followerCount)} followers</span></p>
              <p className="mt-0.5 text-xs text-muted">Applied {when(a.submittedAt)}{a.decidedAt ? ` · decided ${when(a.decidedAt)}` : ""}{a.contractSignedAt ? ` · signed v${a.contractVersion}` : a.status === "approved" ? " · agreement not signed" : ""}</p>
              <a href={a.profileUrl} target="_blank" rel="noopener noreferrer" className="break-all text-xs text-crimson-soft">{a.profileUrl}</a>
              <p className="mt-2 max-w-2xl whitespace-pre-wrap text-ink-soft">{a.about}</p>
              {a.decisionNote && <p className="mt-2 text-xs text-muted">Note: {a.decisionNote}</p>}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <span className="badge">{a.status}</span>
              {a.status === "pending" && (
                <div className="flex gap-1">
                  <Btn onClick={() => ask({ title: "Approve creator", fields: [{ name: "note", label: "Note (optional)" }], submit: "Approve", onSubmit: (v) => void run(`/api/admin/creators/${a.id}`, { action: "approve", note: v.note || undefined }, "Approved.") })}>Approve</Btn>
                  <Btn danger onClick={() => ask({ title: "Reject application", fields: [{ name: "note", label: "Reason (sent to applicant)" }], submit: "Reject", onSubmit: (v) => void run(`/api/admin/creators/${a.id}`, { action: "reject", note: v.note || undefined }, "Rejected.") })}>Reject</Btn>
                </div>
              )}
              {a.status === "approved" && <Btn danger onClick={() => ask({ title: "Remove from program", fields: [{ name: "note", label: "Reason" }], submit: "Remove", danger: true, onSubmit: (v) => void run(`/api/admin/creators/${a.id}`, { action: "revoke", note: v.note || undefined }, "Removed.") })}>Remove</Btn>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Audit({ version }: { version: number }) {
  const [q, setQ] = useState("");
  const { data } = useData<{ id: string; createdAt: number; actor: string | null; action: string; entityType: string; entityId: string; metadata: Json }[]>(`/api/admin/audit?q=${encodeURIComponent(q)}`, version);
  return (
    <div className="space-y-2">
      <input className="input max-w-xs" placeholder="Filter by action, actor or id" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter audit log" />
      <ul className="space-y-1 font-mono text-xs">
        {(data ?? []).map((a) => (
          <li key={a.id} className="break-all rounded-lg bg-surface p-2">
            {new Date(a.createdAt).toISOString()} · {a.actor ?? "system"} · {a.action} · {a.entityType}:{a.entityId} · {JSON.stringify(a.metadata)}
          </li>
        ))}
      </ul>
    </div>
  );
}
