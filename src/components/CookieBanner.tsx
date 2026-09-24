"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "./AppProvider";

/**
 * Cookie consent (checklist §65). Necessary cookies (sign-in, security, this choice) are always on.
 * Analytics events are only stored after opt-in; marketing email needs its own opt-in. The choice is
 * saved in a cookie and on the account, and can be changed any time in Settings or the Privacy page.
 */
export function CookieBanner() {
  const { consent, setConsent } = useApp();
  const [custom, setCustom] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  if (consent !== null) return null;

  return (
    <section
      role="region"
      aria-label="Cookie choices"
      className="fixed inset-x-3 bottom-[calc(72px+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-xl rounded-xl bg-surface p-4 shadow-2xl md:bottom-4"
    >
      <p className="text-sm font-semibold">Cookies on Wesify</p>
      <p className="mt-1 text-sm text-ink-soft">
        We use necessary cookies to keep you signed in and secure. With your OK we also measure how the app is used so we can improve it. We don&apos;t use advertising cookies.{" "}
        <Link href="/privacy#cookies" className="underline">
          Details
        </Link>
      </p>
      {custom && (
        <div className="mt-3 space-y-2 text-sm">
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" checked disabled className="size-5" /> Necessary (always on)
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="size-5" /> Product analytics
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="size-5" /> Product news by email
          </label>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {custom ? (
          <button type="button" className="btn btn-primary" onClick={() => void setConsent({ analytics, marketing })}>
            Save choices
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={() => void setConsent({ analytics: true, marketing: false })}>
              Accept analytics
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void setConsent({ analytics: false, marketing: false })}>
              Necessary only
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setCustom(true)}>
              Customize
            </button>
          </>
        )}
      </div>
    </section>
  );
}
