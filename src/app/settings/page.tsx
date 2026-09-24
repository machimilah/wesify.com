"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import { ConnectedAccounts } from "@/components/ConnectedAccounts";
import { RequireAccount } from "@/components/RequireAccount";
import { Dialog, ErrorState, Field, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/client/api";
import { usePoll } from "@/lib/client/hooks";
import type { AccountSettingsDTO } from "@/lib/shared/dto";
import type { NotificationPrefs } from "@/lib/shared/types";

export default function SettingsPage() {
  return (
    <RequireAccount title="Settings">
      <Settings />
    </RequireAccount>
  );
}

function Settings() {
  const { data, error, refresh } = usePoll<AccountSettingsDTO>("/api/account", { intervalMs: 120_000 });
  const { toast, refreshMe, setConsent, isDemo } = useApp();
  if (error && !data) return <ErrorState message={error.message} onRetry={() => void refresh()} />;
  if (!data) return <Skeleton className="mt-6 h-96" />;

  const patch = async (body: Record<string, unknown>, done = "Saved.") => {
    try {
      await api("/api/account", { method: "PATCH", body });
      toast(done);
      await Promise.all([refresh(), refreshMe()]);
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't save.");
      return false;
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 pt-6">
      <h1 className="text-[28px] font-semibold tracking-tight">Settings</h1>
      {isDemo && <p className="notice">You&apos;re in the demo. Settings apply to your real account.</p>}

      <Security data={data} patch={patch} />
      <Notifications prefs={data.notificationPrefs} onSave={(p) => patch({ action: "preferences", notificationPrefs: p })} />

      <section id="privacy" aria-labelledby="privacy-h" className="card space-y-3 p-4">
        <h2 id="privacy-h" className="text-base font-semibold">
          Privacy
        </h2>
        <Toggle
          label="Show me on the leaderboard"
          sub="When off, your username is hidden from rankings and recent activity."
          checked={data.showOnLeaderboard}
          onChange={(v) => void patch({ action: "preferences", showOnLeaderboard: v })}
        />
        <Toggle
          label="Product analytics"
          sub="Helps us see which screens confuse people. Never sold or used for ads."
          checked={Boolean(data.consent?.analytics)}
          onChange={(v) => void setConsent({ analytics: v, marketing: Boolean(data.consent?.marketing) }).then(() => refresh())}
        />
        <Toggle
          label="Product news by email"
          sub="Occasional updates about new features. Every email has an unsubscribe link."
          checked={Boolean(data.consent?.marketing)}
          onChange={(v) => void setConsent({ analytics: Boolean(data.consent?.analytics), marketing: v }).then(() => refresh())}
        />
        <p className="text-xs text-muted">
          Terms accepted {data.termsAcceptedAt ? `${new Date(data.termsAcceptedAt).toLocaleDateString()} (version ${data.termsVersion})` : "—"}. Read the <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </section>

      <ConnectedAccounts accounts={data.connectedAccounts} onChange={() => void refresh()} />

      <section aria-labelledby="sessions-h" className="card p-4">
        <h2 id="sessions-h" className="text-base font-semibold">
          Where you&apos;re signed in
        </h2>
        {data.authProvider === "clerk" ? (
          <p className="mt-2 text-sm text-muted">Manage devices from your account menu on the sign-in screen.</p>
        ) : (
          <>
            <ul className="mt-2 divide-y divide-line text-sm">
              {data.sessions.map((s) => (
                <li key={s.id} className="flex min-h-12 items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{describeAgent(s.userAgent)}{s.current ? " · this device" : ""}</span>
                    <span className="text-xs text-muted">Last active {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : "—"}</span>
                  </span>
                  {!s.current && (
                    <button type="button" className="btn btn-ghost" onClick={() => void patch({ action: "revoke-session", sessionId: s.id }, "Signed out that device.")}>
                      Sign out
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-secondary mt-2"
              onClick={() => void api("/api/auth/logout?all=1", { method: "POST" }).then(() => (window.location.href = "/login"))}
            >
              Sign out everywhere
            </button>
          </>
        )}
      </section>

      <DataSection />
    </div>
  );
}

function describeAgent(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` on ${os}` : ""}`;
}

function Security({ data, patch }: { data: AccountSettingsDTO; patch: (b: Record<string, unknown>, done?: string) => Promise<boolean> }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [email, setEmail] = useState(data.email ?? "");
  const [password, setPassword] = useState("");
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const { toast } = useApp();

  if (data.authProvider === "clerk") {
    return (
      <section id="security" aria-labelledby="security-h" className="card p-4">
        <h2 id="security-h" className="text-base font-semibold">Sign-in and security</h2>
        <p className="mt-2 text-sm text-muted">
          {data.email} · Your email, password and two-step verification are managed by our sign-in provider. Use the account menu on the sign-in screen to change them.
        </p>
      </section>
    );
  }

  const upgrade = !data.hasPassword;
  return (
    <section id="security" aria-labelledby="security-h" className="card space-y-4 p-4">
      <h2 id="security-h" className="text-base font-semibold">Sign-in and security</h2>
      {upgrade ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void patch({ action: "upgrade", email, password, ageConfirmed: age, acceptTerms: terms }, "Account secured. Check your email to confirm it.");
          }}
        >
          <p className="text-sm text-muted">Your account was created before email sign-in. Add an email and password so you can log in on other devices and recover it.</p>
          <Field id="up-email" label="Email">
            <input id="up-email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id="up-password" label="Password" hint="At least 10 characters.">
            <input id="up-password" type="password" autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="size-5" checked={age} onChange={(e) => setAge(e.target.checked)} /> I&apos;m 18 or older.
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="size-5" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> I agree to the <Link href="/terms" className="underline">Terms</Link> and{" "}
            <Link href="/privacy" className="underline">Privacy Policy</Link>.
          </label>
          <button type="submit" className="btn btn-primary" disabled={!email || password.length < 10 || !age || !terms}>
            Secure my account
          </button>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {data.email} · {data.emailVerified ? <span className="text-success">✓ confirmed</span> : <span className="text-warning">not confirmed</span>}
            </span>
            {!data.emailVerified && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  void api("/api/auth/email", { method: "POST", body: { action: "resend-verification" } })
                    .then(() => toast("Confirmation email sent."))
                    .catch((err) => toast(err instanceof ApiError ? err.message : "Couldn't send."))
                }
              >
                Resend confirmation
              </button>
            )}
          </div>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void patch({ action: "change-password", current, next }, "Password changed. Other devices were signed out.").then((ok) => {
                if (ok) {
                  setCurrent("");
                  setNext("");
                }
              });
            }}
          >
            <Field id="cp-current" label="Current password">
              <input id="cp-current" type="password" autoComplete="current-password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field id="cp-next" label="New password" hint="At least 10 characters. Changing it signs out your other devices.">
              <input id="cp-next" type="password" autoComplete="new-password" className="input" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <button type="submit" className="btn btn-secondary" disabled={!current || next.length < 10}>
              Change password
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function Notifications({ prefs, onSave }: { prefs: NotificationPrefs; onSave: (p: Partial<NotificationPrefs>) => Promise<boolean> }) {
  const rows: [keyof NotificationPrefs, string, string][] = [
    ["priceMoves", "Big moves on my positions", "When a position is up or down a lot, or a market spikes."],
    ["closingSoon", "Closing soon", "30 minutes before a market you hold closes."],
    ["marketOpened", "New markets from creators I've traded", ""],
    ["emailSettlement", "Email me settlement results", "Win, loss, or refund when a market ends."],
    ["emailMarketOpened", "Email me about new markets", ""],
  ];
  return (
    <section id="notifications" aria-labelledby="notif-h" className="card space-y-3 p-4">
      <h2 id="notif-h" className="text-base font-semibold">Notifications</h2>
      <p className="text-xs text-muted">Trade confirmations, settlement results and account messages always appear in your notifications.</p>
      {rows.map(([key, label, sub]) => (
        <Toggle key={key} label={label} sub={sub} checked={prefs[key]} onChange={(v) => void onSave({ [key]: v })} />
      ))}
    </section>
  );
}

function Toggle({ label, sub, checked, onChange }: { label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
      <input type="checkbox" role="switch" className="mt-1 size-5 shrink-0" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function DataSection() {
  const { me, toast } = useApp();
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const exportData = async () => {
    try {
      const data = await api<unknown>("/api/account/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `wesify-${me?.username ?? "account"}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't export your data.");
    }
  };

  const del = async () => {
    setBusy(true);
    try {
      if (reason.trim()) await api("/api/feedback", { method: "POST", body: { kind: "churn", body: reason.trim(), page: "settings" } }).catch(() => {});
      await api("/api/account", { method: "DELETE", body: { confirm, password: password || null, reason: reason || null } });
      window.location.href = "/?deleted=1";
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't delete your account.");
      setBusy(false);
    }
  };

  return (
    <section id="data" aria-labelledby="data-h" className="card space-y-3 p-4">
      <h2 id="data-h" className="text-base font-semibold">Your data</h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => void exportData()}>
          Download my data
        </button>
        <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>
          Delete my account
        </button>
      </div>
      <p className="text-xs text-muted">The download includes your profile, W$ history, trades, positions and notifications as JSON.</p>
      {deleting && (
        <Dialog title="Delete your account?" onClose={() => setDeleting(false)}>
          <div className="space-y-3 text-sm">
            <p>This removes your email, password, sessions and connected accounts, and frees your username. It can&apos;t be undone.</p>
            <p className="text-muted">Your trades stay in anonymized form so other people&apos;s market results remain correct. Open positions stay in their markets until they settle.</p>
            <Field id="del-reason" label="Why are you leaving? (optional, helps us improve)">
              <textarea id="del-reason" className="input" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {me?.hasPassword && (
              <Field id="del-password" label="Your password">
                <input id="del-password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            )}
            <Field id="del-confirm" label="Type DELETE to confirm">
              <input id="del-confirm" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <button type="button" className="btn btn-danger w-full" disabled={busy || confirm !== "DELETE" || (me?.hasPassword && !password)} onClick={() => void del()}>
              {busy ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
