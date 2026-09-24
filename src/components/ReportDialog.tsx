"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/client/api";
import { useApp } from "./AppProvider";
import { Dialog, Field } from "./ui";

const REASONS = {
  market: ["Wrong video or wrong information", "Likes look fake or manipulated", "Inappropriate or harmful content", "Involves a minor", "Something else"],
  user: ["Offensive username", "Suspected cheating or multiple accounts", "Harassment", "Something else"],
  video: ["It's my video and I want it removed", "Inappropriate or harmful content", "Something else"],
};

/** Report a market, user or video (§49). Creates a support ticket and puts the item in the review queue. */
export function ReportDialog({ entityType, entityId, title, onClose }: { entityType: "market" | "user" | "video"; entityId: string; title: string; onClose: () => void }) {
  const { me, toast } = useApp();
  const [reason, setReason] = useState(REASONS[entityType][0]);
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/support", {
        method: "POST",
        body: {
          category: entityType === "user" ? "report_user" : reason.startsWith("It's my video") ? "creator_takedown" : "report_market",
          subject: `${title}: ${reason}`,
          body: details.trim().length >= 10 ? details : `${reason}. ${details}`.padEnd(10, "."),
          email: me ? null : email || null,
          entityType,
          entityId,
          renderedAt: null,
        },
      });
      toast("Thanks. Our team will review it.");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the report.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <fieldset>
          <legend className="text-sm font-medium text-ink-soft">What&apos;s wrong?</legend>
          <div className="mt-2 space-y-1">
            {REASONS[entityType].map((r) => (
              <label key={r} className="flex min-h-11 items-center gap-3 text-sm">
                <input type="radio" name="reason" className="size-5" checked={reason === r} onChange={() => setReason(r)} />
                {r}
              </label>
            ))}
          </div>
        </fieldset>
        <Field id="report-details" label="Details (optional)">
          <textarea id="report-details" className="input" maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>
        {!me && (
          <Field id="report-email" label="Your email, so we can follow up">
            <input id="report-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        )}
        {error && <p role="alert" className="notice notice-danger">{error}</p>}
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Sending…" : "Send report"}
        </button>
      </form>
    </Dialog>
  );
}
