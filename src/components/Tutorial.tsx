"use client";

import { useEffect, useState } from "react";
import { api, trackEvent } from "@/lib/client/api";
import { useApp } from "./AppProvider";

const STEPS = [
  { title: "These are the ranges", body: "One of these four like ranges will win when the market settles 24 hours after it opened." },
  { title: "Price means probability", body: "42% means the market thinks there's about a 42% chance. It also means a share costs W$0.42, and pays W$1.00 if that range wins." },
  { title: "Buy a range you believe in", body: "Tap Buy, enter an amount, and review before you confirm. Start small: you can always add more." },
  { title: "Sell whenever you like", body: "If the odds move your way, sell early to lock in the gain. Trading closes 1 minute before the 24-hour mark." },
];

/**
 * First-trade walkthrough (checklist §5): optional, skippable, shown once to new users on their
 * first market page. Gated by the `firstTradeTutorial` rollout flag.
 */
export function FirstTradeTutorial() {
  const { me, config, refreshMe } = useApp();
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    setRequested(new URLSearchParams(window.location.search).get("tutorial") === "1" || sessionStorage.getItem("wesify_tutorial") === "1");
  }, []);

  const eligible = me && !me.tutorialCompleted && config?.flags.firstTradeTutorial && me.authProvider !== "demo";
  if (!eligible || dismissed) return null;
  if (!requested && me.createdAt < Date.now() - 2 * 86_400_000) return null;

  const finish = async (skipped: boolean) => {
    setDismissed(true);
    trackEvent("tutorial_step", { step, skipped });
    try {
      sessionStorage.removeItem("wesify_tutorial");
    } catch {}
    await api("/api/account", { method: "PATCH", body: { action: "tutorial-complete" } }).catch(() => {});
    void refreshMe();
  };
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <aside
      role="dialog"
      aria-label="First trade walkthrough"
      aria-live="polite"
      className="card animate-rise fixed inset-x-3 bottom-[calc(128px+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md p-4 shadow-2xl md:bottom-6 md:left-auto md:right-6"
    >
      <p className="text-xs font-medium text-muted">
        Your first trade · {step + 1} of {STEPS.length}
      </p>
      <p className="mt-1 text-base font-semibold">{s.title}</p>
      <p className="mt-1 text-sm text-ink-soft">{s.body}</p>
      <div className="mt-3 flex items-center justify-between">
        <button type="button" className="btn btn-ghost" onClick={() => void finish(true)}>
          Skip tutorial
        </button>
        <button type="button" className="btn btn-primary" onClick={() => (last ? void finish(false) : setStep(step + 1))}>
          {last ? "Got it" : "Next"}
        </button>
      </div>
    </aside>
  );
}
