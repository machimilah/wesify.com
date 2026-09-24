"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Field } from "@/components/ui";
import { ApiError, api } from "@/lib/client/api";
import { usePoll } from "@/lib/client/hooks";

const CATEGORIES: [string, string][] = [
  ["missing_credits", "Missing W$"],
  ["incorrect_trade", "A trade looks wrong"],
  ["market_dispute", "Problem with a market"],
  ["settlement_dispute", "I disagree with a settlement"],
  ["password_reset", "Can't sign in / password"],
  ["account_deletion", "Delete my account"],
  ["privacy_request", "Privacy or data request"],
  ["creator_takedown", "Remove my video (creators)"],
  ["abuse_report", "Report abuse"],
  ["appeal", "Appeal a suspension or decision"],
  ["security", "Security issue"],
  ["feedback", "Feedback or idea"],
  ["other", "Something else"],
];

type Ticket = { id: string; category: string; subject: string; status: string; createdAt: number; replies: { at: number; body: string }[] };

/** Contact form and ticket history (checklist §48). */
export default function SupportPage() {
  return (
    <Suspense>
      <Support />
    </Suspense>
  );
}

function Support() {
  const params = useSearchParams();
  const { me, toast } = useApp();
  const [category, setCategory] = useState(CATEGORIES.some(([c]) => c === params.get("category")) ? params.get("category")! : "other");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const renderedAt = useRef(Date.now());
  const { data: tickets, refresh } = usePoll<Ticket[]>(me ? "/api/support" : null, { intervalMs: 60_000 });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string; responseTime: string }>("/api/support", {
        method: "POST",
        body: { category, subject, body, email: me ? null : email, website, renderedAt: renderedAt.current },
      });
      setSent(r.responseTime);
      setSubject("");
      setBody("");
      toast("Message sent.");
      void refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send your message.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 pt-6">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">Help & support</h1>
        <p className="mt-1 text-sm text-muted">
          Most questions are answered in the <Link href="/faq" className="underline">FAQ</Link> and <Link href="/rules" className="underline">market rules</Link>. We reply to messages within 2 business days, and within 24 hours for
          security, settlement and missing-W$ issues.
        </p>
      </div>

      {sent ? (
        <div className="notice notice-success" role="status">
          Thanks, we got it. Expect a reply {sent}
          {me?.email ? ` at ${me.email}` : ""}.{" "}
          <button type="button" className="underline" onClick={() => setSent(null)}>
            Send another
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="card space-y-4 p-4">
          <Field id="s-category" label="What's it about?">
            <select id="s-category" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          {category === "creator_takedown" && (
            <p className="notice">Include the video link and your handle. We remove videos from Wesify as soon as we confirm the request, and cancel any open market with refunds.</p>
          )}
          <Field id="s-subject" label="Subject">
            <input id="s-subject" className="input" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field id="s-body" label="Details" hint="Include market links or times if it's about a trade.">
            <textarea id="s-body" className="input" maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          {!me && (
            <Field id="s-email" label="Your email">
              <input id="s-email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          )}
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          {error && <p role="alert" className="notice notice-danger">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy || subject.trim().length < 3 || body.trim().length < 10 || (!me && !email)}>
            {busy ? "Sending…" : "Send message"}
          </button>
        </form>
      )}

      {me && tickets && tickets.length > 0 && (
        <section aria-labelledby="tickets-h">
          <h2 id="tickets-h" className="mb-3 text-lg font-semibold">Your messages</h2>
          <ul className="space-y-2">
            {tickets.map((t) => (
              <li key={t.id} className="card p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{t.subject}</span>
                  <span className={`badge ${t.status === "resolved" ? "badge-success" : t.status === "pending" ? "badge-info" : ""}`}>{t.status === "pending" ? "replied" : t.status}</span>
                </div>
                <p className="text-xs text-muted">{new Date(t.createdAt).toLocaleString()}</p>
                {t.replies.map((r) => (
                  <p key={r.at} className="mt-2 whitespace-pre-wrap rounded-lg bg-wash p-3">
                    {r.body}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
