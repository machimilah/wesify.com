"use client";

import { useApp } from "./AppProvider";

/** Lets anyone change their cookie choice after the banner (§65 privacy preferences editable). */
export function CookieSettings() {
  const { consent, setConsent, toast } = useApp();
  const analytics = Boolean(consent?.analytics);
  const marketing = Boolean(consent?.marketing);
  const save = (c: { analytics: boolean; marketing: boolean }) => void setConsent(c).then(() => toast("Cookie choice saved."));
  return (
    <div className="card mt-3 space-y-2 p-4 text-ink">
      <p className="text-sm font-semibold">Your current choice: {consent === null ? "not set" : analytics ? "necessary + analytics" : "necessary only"}</p>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" className="size-5" checked={analytics} onChange={(e) => save({ analytics: e.target.checked, marketing })} /> Product analytics
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" className="size-5" checked={marketing} onChange={(e) => save({ analytics, marketing: e.target.checked })} /> Product news by email
      </label>
    </div>
  );
}
