"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useApp } from "@/components/AppProvider";
import { RequireAccount } from "@/components/RequireAccount";
import { Empty, Skeleton } from "@/components/ui";
import { api, trackEvent } from "@/lib/client/api";
import { usePoll, useWorldNow } from "@/lib/client/hooks";
import type { NotificationDTO } from "@/lib/shared/dto";
import { duration } from "@/lib/shared/format";

export default function NotificationsPage() {
  return (
    <RequireAccount title="Notifications">
      <Notifications />
    </RequireAccount>
  );
}

function Notifications() {
  const { data } = usePoll<NotificationDTO[]>("/api/notifications");
  const { refreshMe } = useApp();
  const now = useWorldNow();
  const unread = data?.some((n) => !n.read);

  useEffect(() => {
    if (!unread) return;
    void api("/api/notifications", { method: "POST" }).then(refreshMe).catch(() => {});
  }, [unread, refreshMe]);

  if (!data) return <Skeleton className="mt-4 h-48" />;
  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[28px] font-semibold tracking-tight">Notifications</h1>
        <Link href="/settings#notifications" className="btn btn-ghost">
          Preferences
        </Link>
      </div>
      {data.length === 0 && <Empty title="All quiet.">You’ll hear about big moves on your positions.</Empty>}
      <ul className="space-y-2">
        {data.map((n) => (
          <li key={n.id}>
            <Link
              href={n.kind === "CREATOR_ELIGIBLE" || n.kind === "CREATOR_DECISION" ? "/creator" : n.marketId ? `/markets/${n.marketId}` : n.kind === "REWARD" ? "/wallet" : "/portfolio"}
              onClick={() => trackEvent("notification_opened", { kind: n.kind })}
              className={`card flex min-h-16 items-start gap-3 p-4 ${n.read ? "" : "border-indigo/40"}`}
            >
              {!n.read && <span className="bg-gradient-main mt-1.5 size-2 shrink-0 rounded-full" aria-label="Unread" />}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{n.title}</span>
                <span className="block text-sm text-muted">{n.body}</span>
              </span>
              <span className="tabular shrink-0 text-xs text-muted">{duration(now - n.createdAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
