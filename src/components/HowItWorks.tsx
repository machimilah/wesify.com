"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useStoredFlag } from "@/lib/client/hooks";
import { trackEvent } from "@/lib/client/api";
import { useApp } from "./AppProvider";
import { Dialog } from "./ui";

export const HOW_IT_WORKS = [
  { title: "Pick a video and a range", body: "Each market asks how many likes a video will have 24 hours after the market opened. There are four like ranges, sized to the creator." },
  { title: "Price = chance", body: "A range priced at 40% costs W$0.40 per share, because the market thinks it has about a 40% chance of winning. Prices move as likes and trades come in." },
  { title: "Win or sell early", body: "When the market settles, one range wins and each of its shares pays W$1.00. The others pay W$0. You can sell any time before trading closes to lock in a gain or cut a loss." },
  { title: "It's play money", body: "Everyone starts with W$10,000 in Wesify Credits. W$ has no monetary value and can't be bought, redeemed or withdrawn." },
];

/**
 * First-visit explainer (checklist §3 "popup that explains how Wesify works, for new users only").
 * Shows once per browser on the markets page to people who aren't signed in or haven't finished
 * onboarding. Dismissing it is remembered.
 */
export function HowItWorksPopup() {
  const pathname = usePathname();
  const { me, meLoaded } = useApp();
  const [seen, setSeen] = useStoredFlag("wesify_how_it_works_seen");
  const [step, setStep] = useState(0);
  const eligible = meLoaded && seen === false && (pathname === "/" || pathname.startsWith("/markets/")) && (!me || !me.onboardingCompleted) && me?.authProvider !== "demo";
  if (!eligible) return null;
  const close = () => {
    trackEvent("onboarding_step", { step: "how_it_works_closed", at: step });
    setSeen(true);
  };
  const s = HOW_IT_WORKS[step];
  const last = step === HOW_IT_WORKS.length - 1;
  return (
    <Dialog title="How Wesify works" onClose={close}>
      <p className="text-xs font-medium text-muted" aria-live="polite">
        {step + 1} of {HOW_IT_WORKS.length}
      </p>
      <p className="mt-2 text-xl font-semibold tracking-tight">{s.title}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{s.body}</p>
      <div className="mt-5 flex items-center justify-between gap-2">
        <button type="button" className="btn btn-ghost" onClick={close}>
          Skip
        </button>
        <div className="flex gap-2">
          {step > 0 && (
            <button type="button" className="btn btn-secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {last ? (
            me ? (
              <button type="button" className="btn btn-primary" onClick={close}>
                Start trading
              </button>
            ) : (
              <Link href="/welcome" className="btn btn-primary" onClick={() => setSeen(true)}>
                Get W$10,000
              </Link>
            )
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setStep(step + 1)}>
              Next
            </button>
          )}
        </div>
      </div>
      <p className="mt-4 text-xs text-muted">
        Full rules: <Link href="/rules" className="underline" onClick={() => setSeen(true)}>How markets work</Link>
      </p>
    </Dialog>
  );
}
