"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { RequireAccount } from "@/components/RequireAccount";
import { PrimaryButton, SecondaryButton, Skeleton, Thumbnail } from "@/components/ui";
import { ApiError, api } from "@/lib/client/api";
import { usePoll, useWorldNow } from "@/lib/client/hooks";
import type { CreatorAccountDTO, CreatorOverviewDTO, CreatorProgramDTO, CreatorVideoDTO } from "@/lib/shared/dto";
import { compactNumber, duration } from "@/lib/shared/format";
import { hashString } from "@/lib/shared/random";

export default function CreatorPage() {
  return (
    <RequireAccount title="Creator studio">
      <CreatorStudio />
    </RequireAccount>
  );
}

function CreatorStudio() {
  const { toast } = useApp();
  const { data, refresh } = usePoll<CreatorOverviewDTO>("/api/social");
  const now = useWorldNow();
  const [busy, setBusy] = useState<string | null>(null);

  // Result of the OAuth round trip comes back as ?connected= or ?error=.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const connected = q.get("connected");
    const error = q.get("error");
    if (connected) toast(`${connected === "tiktok" ? "TikTok" : "Instagram"} connected.`);
    if (error) toast(error);
    if (connected || error) window.history.replaceState(null, "", "/creator");
  }, [toast]);

  const run = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast(success);
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <Skeleton className="mt-6 h-72" />;

  // Invite-only: everything before "active" is the application → review → agreement path.
  if (data.program.state !== "active") {
    return <ProgramGate program={data.program} rules={data.rules} now={now} onDone={refresh} />;
  }

  const eligible = data.videos.filter((v) => v.status === "eligible");
  const watching = data.videos.filter((v) => v.status === "tracking");
  const past = data.videos.filter((v) => v.status === "market_created" || v.status === "expired");

  return (
    <div className="mx-auto max-w-4xl space-y-8 pt-6">
      <header>
        <h1 className="text-[28px] font-semibold tracking-tight">Creator studio</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Connect your accounts and Wesify watches your new uploads. When one takes off, you&apos;ll get an alert to open its market.
        </p>
      </header>

      <section aria-label="Your limit and the rules" className="card grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <p className="text-xs font-medium text-muted">Markets you can open</p>
          {data.limit.remaining > 0 ? (
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              <span className="text-gradient">{data.limit.remaining}</span> available
            </p>
          ) : (
            <p className="tabular mt-1 text-2xl font-semibold tracking-tight">Next in {duration((data.limit.nextAvailableAt ?? now) - now)}</p>
          )}
          <p className="mt-0.5 text-xs text-muted">
            {data.limit.perWindow} every {data.limit.windowHours} hours, across all your accounts
          </p>
        </div>
        <ul className="grid gap-2 text-sm text-ink-soft sm:grid-cols-2">
          <Rule>Likes reach {data.rules.likePercent}% of your followers</Rule>
          <Rule>
            At least {compactNumber(data.rules.minFollowers)} followers and {data.rules.minLikes} likes
          </Rule>
          <Rule>Opened within {data.rules.maxAgeHours} hours of posting</Rule>
          <Rule>Uploads and likes are checked every {data.rules.syncMinutes} minutes</Rule>
        </ul>
      </section>

      <section aria-label="Connected accounts">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Accounts</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {data.platforms.map((p) => {
            const account = data.accounts.find((a) => a.platform === p.platform);
            return account ? (
              <AccountCard
                key={p.platform}
                account={account}
                name={p.name}
                now={now}
                busy={busy}
                onSync={() => run(`sync:${account.id}`, () => api(`/api/social/accounts/${account.id}/sync`, { method: "POST" }), "Checked for new uploads.")}
                onSimulate={() => run(`sim:${account.id}`, () => api(`/api/social/accounts/${account.id}/simulate-upload`, { method: "POST" }), "Simulated a new upload.")}
                onDisconnect={() => {
                  if (confirm(`Disconnect ${p.name}? Wesify will stop watching your uploads and revoke its access.`)) {
                    const purge = confirm("Also delete the upload and like data Wesify stored for this account? Markets that already ran stay on record.");
                    void run(`off:${account.id}`, () => api(`/api/social/accounts/${account.id}${purge ? "?purge=1" : ""}`, { method: "DELETE" }), `${p.name} disconnected.`);
                  }
                }}
              />
            ) : (
              <div key={p.platform} className="card flex flex-col justify-between gap-4 p-5">
                <div className="flex items-center gap-3">
                  <PlatformMark platform={p.platform} />
                  <div>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-muted">
                      {p.platform === "instagram" ? "Business or Creator accounts only" : p.platform === "youtube" ? "Your channel (read-only)" : "Personal or Creator accounts"}
                    </p>
                  </div>
                </div>
                {/* Full navigation, not a fetch: OAuth needs the browser to go to the platform. */}
                <a href={`/api/social/${p.platform}/connect?from=creator`} className="bg-gradient-main flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold">
                  Connect {p.name}
                </a>
                {p.mode === "simulated" && (
                  <p className="text-xs text-muted">Simulated connection — no {p.name} API keys are configured on this server yet.</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {data.accounts.length > 0 && (
        <>
          <VideoGroup title="Ready to open" empty="Nothing ready yet. We'll alert you when an upload qualifies.">
            {eligible.map((v) => (
              <VideoRow key={v.id} video={v} now={now}>
                <SecondaryButton
                  disabled={busy !== null}
                  onClick={() => run(`dismiss:${v.id}`, () => api(`/api/social/videos/${v.id}/dismiss`, { method: "POST" }))}
                >
                  Dismiss
                </SecondaryButton>
                <OpenMarketButton video={v} disabled={busy !== null || data.limit.remaining === 0} onDone={refresh} />
              </VideoRow>
            ))}
          </VideoGroup>

          <VideoGroup title="Watching" empty={`No uploads from the last ${data.rules.maxAgeHours} hours.`}>
            {watching.map((v) => (
              <VideoRow key={v.id} video={v} now={now} />
            ))}
          </VideoGroup>

          {past.length > 0 && (
            <VideoGroup title="Earlier" empty="">
              {past.map((v) => (
                <VideoRow key={v.id} video={v} now={now}>
                  {v.marketId ? (
                    <Link href={`/markets/${v.marketId}`} className="flex min-h-10 items-center rounded-lg border border-line px-4 text-sm font-semibold hover:bg-wash">
                      View market
                    </Link>
                  ) : (
                    <span className="text-xs text-muted">Window closed</span>
                  )}
                </VideoRow>
              ))}
            </VideoGroup>
          )}
        </>
      )}

      {data.markets.length > 0 && (
        <section aria-label="Your markets">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Your markets</h2>
          <div className="card overflow-x-auto">
            <table className="tabular w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Market</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-medium">Traders</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-medium">Trades</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-medium">Volume (W$)</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Visits to your video</th>
                </tr>
              </thead>
              <tbody>
                {data.markets.map((m) => (
                  <tr key={m.marketId}>
                    <td className="px-4 py-3">
                      <Link href={`/markets/${m.marketId}`} className="font-semibold hover:underline">
                        @{m.handle}
                      </Link>
                      <span className="block text-xs text-muted">
                        {new Date(m.openedAt).toLocaleDateString()} · {m.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-right">{m.traders}</td>
                    <td className="px-2 py-3 text-right">{m.trades}</td>
                    <td className="px-2 py-3 text-right">{Math.round(m.volume).toLocaleString("en-US")}</td>
                    <td className="px-4 py-3 text-right">{m.originalOpens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">Visits count people who tapped &ldquo;Watch on&rdquo; from Wesify. W$ volume is play money; creators aren&apos;t paid for markets.</p>
        </section>
      )}

      <section aria-label="Permissions" className="card p-5 text-sm text-ink-soft">
        <h2 className="text-base font-semibold text-ink">What Wesify can see</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Your public profile name and follower count.</li>
          <li>Your recent videos: their links, captions, post times and like counts.</li>
          <li>Nothing else. Wesify never posts, comments, messages or changes anything on your account.</li>
        </ul>
        <p className="mt-2">
          Tokens are encrypted and deleted when you disconnect; we also ask the platform to revoke them. You can&apos;t trade markets on your own videos.{" "}
          <Link href="/support?category=creator_takedown" className="underline">
            Contact creator support
          </Link>
        </p>
      </section>
    </div>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="bg-gradient-main mt-1.5 size-1.5 shrink-0 rounded-full" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

function AccountCard({
  account,
  name,
  now,
  busy,
  onSync,
  onSimulate,
  onDisconnect,
}: {
  account: CreatorAccountDTO;
  name: string;
  now: number;
  busy: string | null;
  onSync: () => void;
  onSimulate: () => void;
  onDisconnect: () => void;
}) {
  const tooSmall = account.followerCount < 1000;
  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <PlatformMark platform={account.platform} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">@{account.handle}</p>
          <p className="text-xs text-muted">
            {name} · {account.mode === "simulated" ? "Simulated" : "Connected"}
          </p>
        </div>
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${account.status === "error" ? "bg-wash text-ink-soft" : "bg-blue/10 text-up"}`}>
          {account.status === "error" ? "Needs attention" : "Active"}
        </span>
      </div>

      <dl className="tabular grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Followers</dt>
          <dd className="font-semibold">{compactNumber(account.followerCount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Likes needed</dt>
          <dd className="font-semibold">{tooSmall ? "—" : compactNumber(account.threshold)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Last check</dt>
          <dd className="font-semibold">{account.lastSyncedAt ? `${duration(now - account.lastSyncedAt)} ago` : "Pending"}</dd>
        </div>
      </dl>

      {tooSmall && <p className="text-xs text-muted">Markets open once this account reaches 1,000 followers.</p>}
      {account.statusMessage && <p className="rounded-lg bg-wash px-3 py-2 text-xs text-ink-soft">{account.statusMessage}</p>}

      <div className="flex flex-wrap gap-2">
        <SecondaryButton onClick={onSync} disabled={busy !== null}>
          {busy === `sync:${account.id}` ? "Checking…" : "Check now"}
        </SecondaryButton>
        {account.mode === "simulated" && (
          <SecondaryButton onClick={onSimulate} disabled={busy !== null}>
            {busy === `sim:${account.id}` ? "Posting…" : "Simulate a new upload"}
          </SecondaryButton>
        )}
        <button
          type="button"
          onClick={onDisconnect}
          disabled={busy !== null || account.hasRunningMarket}
          title={account.hasRunningMarket ? "Available after your running market settles" : undefined}
          className="ml-auto min-h-10 rounded-lg px-3 text-sm font-semibold text-muted hover:text-ink disabled:opacity-40"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

/** Everything a creator sees before they're in the program: apply, wait, or sign the agreement. */
function ProgramGate({
  program,
  rules,
  now,
  onDone,
}: {
  program: CreatorProgramDTO;
  rules: CreatorOverviewDTO["rules"];
  now: number;
  onDone: () => Promise<void>;
}) {
  const { state, application, contract } = program;
  return (
    <div className="mx-auto max-w-2xl space-y-6 pt-6">
      <header>
        <h1 className="text-[28px] font-semibold tracking-tight">Creator program</h1>
        <p className="mt-1 text-sm text-muted">
          Markets are opened by approved creators only. Apply with the account you post from — we review every application by hand.
        </p>
      </header>

      {state === "pending" && application && (
        <section aria-label="Application status" className="card p-5">
          <p className="text-lg font-semibold">Application under review</p>
          <p className="tabular mt-1 text-sm text-muted">
            @{application.handle} on {application.platform} · sent {duration(now - application.submittedAt)} ago
          </p>
          <p className="mt-3 text-sm text-ink-soft">We&apos;ll send you a notification as soon as there&apos;s a decision.</p>
        </section>
      )}

      {(state === "rejected" || state === "revoked") && (
        <section aria-label="Application status" className="card p-5">
          <p className="text-lg font-semibold">{state === "rejected" ? "Not approved this time" : "Removed from the program"}</p>
          {application?.decisionNote && <p className="mt-2 text-sm text-ink-soft">{application.decisionNote}</p>}
          {state === "rejected" && (
            <p className="tabular mt-3 text-sm text-muted">
              {program.canApplyAt && program.canApplyAt > now ? `You can apply again in ${duration(program.canApplyAt - now)}.` : "You can apply again now."}
            </p>
          )}
        </section>
      )}

      {state === "unsigned" && <ContractCard contract={contract} onDone={onDone} />}

      {(state === "none" || (state === "rejected" && (!program.canApplyAt || program.canApplyAt <= now))) && (
        <ApplicationForm rules={rules} onDone={onDone} />
      )}

      {state !== "unsigned" && (
        <section aria-label="What approved creators get" className="card p-5">
          <p className="text-sm font-semibold">What you get once you&apos;re in</p>
          <ul className="mt-3 grid gap-2 text-sm text-ink-soft">
            <Rule>Connect TikTok or Instagram and Wesify watches your new uploads</Rule>
            <Rule>An alert the moment a video passes {rules.likePercent}% of your followers in likes</Rule>
            <Rule>Open one market a day on a video of yours, within {rules.maxAgeHours} hours of posting</Rule>
          </ul>
        </section>
      )}
    </div>
  );
}

function ApplicationForm({ rules, onDone }: { rules: CreatorOverviewDTO["rules"]; onDone: () => Promise<void> }) {
  const { toast } = useApp();
  const [platform, setPlatform] = useState("");
  const [handle, setHandle] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [followerCount, setFollowerCount] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/social/apply", {
        method: "POST",
        body: { platform, handle: handle.trim(), profileUrl: profileUrl.trim(), followerCount: Number(followerCount), about: about.trim() },
      });
      toast("Application sent.");
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the application. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <p className="text-lg font-semibold">Apply</p>

      <Field label="Where you post">
        <input
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          required
          minLength={2}
          maxLength={40}
          list="creator-platforms"
          placeholder="TikTok, Instagram, YouTube Shorts…"
          className={FIELD}
          aria-label="Where you post"
        />
        <datalist id="creator-platforms">
          {["TikTok", "Instagram", "YouTube Shorts", "Snapchat Spotlight", "X", "Twitch", "Facebook Reels", "Pinterest"].map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>

      <Field label="Your handle">
        <input value={handle} onChange={(e) => setHandle(e.target.value)} required maxLength={60} placeholder="@yourhandle" className={FIELD} aria-label="Your handle" />
      </Field>
      <Field label="Link to your profile">
        <input
          value={profileUrl}
          onChange={(e) => setProfileUrl(e.target.value)}
          required
          type="url"
          placeholder="https://www.tiktok.com/@yourhandle"
          className={FIELD}
          aria-label="Link to your profile"
        />
      </Field>
      <Field label={`Followers (at least ${compactNumber(rules.minFollowers)} to qualify)`}>
        <input
          value={followerCount}
          onChange={(e) => setFollowerCount(e.target.value.replace(/[^\d]/g, ""))}
          required
          inputMode="numeric"
          placeholder="25000"
          className={`tabular ${FIELD}`}
          aria-label="Followers"
        />
      </Field>
      <Field label="What you post, and how often">
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          required
          minLength={20}
          maxLength={1000}
          rows={4}
          placeholder="Tell us about your videos, your usual like counts, and how often you post."
          className={`${FIELD} h-auto py-2.5`}
          aria-label="What you post, and how often"
        />
      </Field>

      {error && (
        <p role="alert" className="rounded-lg bg-wash px-3 py-2.5 text-sm font-medium text-ink-soft">
          {error}
        </p>
      )}
      <PrimaryButton type="submit" disabled={busy} className="w-full">
        {busy ? "Sending…" : "Send application"}
      </PrimaryButton>
      <p className="text-xs text-muted">
        Any platform is welcome — we review each one by hand. If you&apos;re approved you&apos;ll sign the creator agreement, then connect the account so
        Wesify can read your like counts. Automatic tracking works with TikTok and Instagram today; for anything else we&apos;ll set it up with you.
      </p>
    </form>
  );
}

function ContractCard({ contract, onDone }: { contract: CreatorProgramDTO["contract"]; onDone: () => Promise<void> }) {
  const { toast } = useApp();
  const [fullName, setFullName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sign = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/social/contract", { method: "POST", body: { fullName: fullName.trim(), version: contract.version, agree: true } });
      toast("Agreement signed.");
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={sign} className="card space-y-4 p-5">
      <div>
        <p className="text-lg font-semibold">You&apos;re approved — sign the creator agreement</p>
        <p className="mt-1 text-sm text-muted">Version {contract.version}. Read it, then type your full name to sign.</p>
      </div>

      <ol className="space-y-2.5 text-sm text-ink-soft">
        {contract.terms.map((term, i) => (
          <li key={term} className="flex gap-2.5">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-wash text-[11px] font-semibold text-ink-soft">{i + 1}</span>
            <span>{term}</span>
          </li>
        ))}
      </ol>

      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4" />
        <span>I have read the agreement and I accept these rules.</span>
      </label>
      <Field label="Full name">
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={120} placeholder="Your full name" className={FIELD} aria-label="Full name" />
      </Field>

      {error && (
        <p role="alert" className="rounded-lg bg-wash px-3 py-2.5 text-sm font-medium text-ink-soft">
          {error}
        </p>
      )}
      <PrimaryButton type="submit" disabled={busy || !agree || fullName.trim().length < 2} className="w-full">
        {busy ? "Signing…" : "Sign and continue"}
      </PrimaryButton>
    </form>
  );
}

const FIELD = "mt-1 h-11 w-full rounded-lg bg-wash px-3 text-sm outline-none placeholder:text-muted focus:bg-surface";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function VideoGroup({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-3 text-lg font-semibold tracking-tight">{title}</h2>
      {children.length ? <ul className="card">{children}</ul> : empty ? <p className="card p-4 text-sm text-muted">{empty}</p> : null}
    </section>
  );
}

function VideoRow({ video, now, children }: { video: CreatorVideoDTO; now: number; children?: React.ReactNode }) {
  const progress = Math.min(1, video.threshold > 0 ? video.likes / video.threshold : 0);
  const left = video.windowEndsAt - now;
  const open = video.status === "tracking" || video.status === "eligible";
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Thumbnail hue={205 + (hashString(video.id) % 80)} seed={video.id} showPlay={false} className="h-16 w-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{video.caption || "Untitled upload"}</p>
          <p className="tabular text-xs text-muted">
            @{video.handle} · posted {duration(now - video.publishedAt)} ago
            {open && left > 0 ? ` · ${duration(left)} left to open` : ""}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 max-w-56 flex-1 overflow-hidden rounded-full bg-wash" aria-hidden="true">
              <div className="bg-gradient-main h-full rounded-full" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className="tabular text-xs text-ink-soft">
              {compactNumber(video.likes)} / {compactNumber(video.threshold)} likes
            </span>
          </div>
        </div>
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </li>
  );
}

function OpenMarketButton({ video, disabled, onDone }: { video: CreatorVideoDTO; disabled: boolean; onDone: () => Promise<void> }) {
  const router = useRouter();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ marketId: string }>(`/api/social/videos/${video.id}/open`, { method: "POST" });
          toast("Market opened.");
          await onDone();
          router.push(`/markets/${r.marketId}`);
        } catch (err) {
          toast(err instanceof ApiError ? err.message : "Could not open the market.");
        } finally {
          setBusy(false);
        }
      }}
      className="bg-gradient-main min-h-10 rounded-lg px-4 text-sm font-semibold disabled:opacity-40"
    >
      {busy ? "Opening…" : "Open market"}
    </button>
  );
}

function PlatformMark({ platform }: { platform: "tiktok" | "instagram" | "youtube" }) {
  // Initials, not the platforms' trademarked logos.
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-wash text-sm font-bold text-ink" aria-hidden="true">
      {platform === "tiktok" ? "TT" : platform === "youtube" ? "YT" : "IG"}
    </span>
  );
}
