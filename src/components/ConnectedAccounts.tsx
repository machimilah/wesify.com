"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/client/api";
import type { ProfileDTO } from "@/lib/shared/dto";
import { useApp } from "./AppProvider";

const PLATFORMS = [
  { id: "tiktok", name: "TikTok" },
  { id: "instagram", name: "Instagram" },
  { id: "youtube", name: "YouTube" },
] as const;

/**
 * Connected social accounts (checklist §5: "a section inside their profile that lets them connect
 * their Instagram/YouTube/TikTok"). Connecting proves which videos are yours, which keeps you out of
 * markets on your own videos. It's read-only access, and disconnecting revokes it.
 */
export function ConnectedAccounts({ accounts, onChange }: { accounts: ProfileDTO["connectedAccounts"]; onChange: () => void }) {
  const { toast, isDemo } = useApp();
  const [busy, setBusy] = useState<string | null>(null);

  const disconnect = async (id: string, name: string) => {
    if (!confirm(`Disconnect ${name}? Wesify will delete its access token and ask ${name} to revoke it.`)) return;
    setBusy(id);
    try {
      await api(`/api/social/accounts/${id}`, { method: "DELETE" });
      toast(`${name} disconnected.`);
      onChange();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't disconnect.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="connected-heading" className="card p-4">
      <h2 id="connected-heading" className="text-base font-semibold">
        Connected accounts
      </h2>
      <p className="mt-1 text-sm text-muted">
        Link the accounts you post from. Wesify reads your follower count and your recent videos&apos; likes, never posts for you, and keeps you out of markets on your own videos.
      </p>
      {isDemo ? (
        <p className="notice mt-3">Connect accounts from your real account, not the demo.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {PLATFORMS.map((p) => {
            const acct = accounts.find((a) => a.platform === p.id);
            return (
              <li key={p.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-semibold">{p.name}</p>
                  <p className="truncate text-xs text-muted">
                    {acct ? `@${acct.handle}${acct.mode === "simulated" ? " · simulated connection" : ""}${acct.status === "error" ? " · needs reconnecting" : ""}` : "Not connected"}
                  </p>
                </div>
                {acct ? (
                  <button type="button" className="btn btn-secondary" disabled={busy === acct.id} onClick={() => void disconnect(acct.id, p.name)}>
                    Disconnect
                  </button>
                ) : (
                  // Full navigation: OAuth has to leave the site for the platform's consent screen.
                  <a href={`/api/social/${p.id}/connect`} className="btn btn-primary">
                    Connect
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
