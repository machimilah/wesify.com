"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/AppProvider";
import { SignupForm } from "@/components/AuthForms";
import { PrimaryButton } from "@/components/ui";
import { trackEvent } from "@/lib/client/api";

/**
 * New-user onboarding (checklist §5): three short screens, then sign-up. Every sentence here is
 * final copy (§61): what Wesify is, how prices work, how you win or lose, that W$ is virtual, that
 * one outcome wins, that you can sell before settlement, and when a market closes.
 */
const SCREENS = [
  {
    title: (
      <>
        Trade the future of <span className="text-gradient">virality.</span>
      </>
    ),
    body: "Wesify turns short videos into prediction markets. Each market asks one question: how many likes will this video have 24 hours after the market opened?",
    visual: "rising" as const,
  },
  {
    title: <>Price is the crowd&apos;s chance.</>,
    body: "Every video has four like ranges. A range at 40% costs W$0.40 a share because the market thinks it has about a 40% chance. Prices move as likes come in and people trade.",
    visual: "ranges" as const,
  },
  {
    title: <>One range wins. You can sell any time.</>,
    body: "When the market settles, each share of the winning range pays W$1.00 and the other ranges pay W$0. Trading closes 1 minute before the 24-hour mark, and you can sell your shares any time before that.",
    visual: "credits" as const,
  },
];

export default function WelcomePage() {
  return (
    <Suspense>
      <Welcome />
    </Suspense>
  );
}

function Welcome() {
  const router = useRouter();
  const { me, meLoaded } = useApp();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (meLoaded && me) router.replace("/");
  }, [me, meLoaded, router]);
  useEffect(() => trackEvent("onboarding_step", { step }), [step]);

  const markOnboarded = () => {
    try {
      localStorage.setItem("wesify_onboarded", "1");
      localStorage.setItem("wesify_how_it_works_seen", "1");
    } catch {}
  };
  const signup = step === SCREENS.length;

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-6 pb-10 pt-8">
      <div className="bg-accents" aria-hidden="true" />
      <div className="flex items-center justify-between">
        <span className="text-2xl font-semibold tracking-tight">wesify</span>
        <div className="flex items-center gap-1">
          <Link href="/login" className="btn btn-ghost">
            Log in
          </Link>
          <Link href="/" onClick={markOnboarded} className="btn btn-ghost">
            {signup ? "Browse first" : "Skip"}
          </Link>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-center" key={step}>
        {!signup && (
          <div className="animate-rise">
            <div className="mb-10">{SCREENS[step].visual === "rising" ? <RisingVisual /> : SCREENS[step].visual === "ranges" ? <RangesVisual /> : <CreditsVisual />}</div>
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight">{SCREENS[step].title}</h1>
            <p className="mt-4 text-lg leading-relaxed text-muted">{SCREENS[step].body}</p>
          </div>
        )}
        {signup && (
          <div className="animate-rise py-6">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight">
              Start with <span className="text-gradient">W$10,000.</span>
            </h1>
            <p className="mt-2 text-base text-muted">W$ is play money. It has no monetary value and can&apos;t be bought, redeemed or withdrawn.</p>
            <div className="mt-6">
              <SignupForm onDone={() => router.replace("/?tutorial=1")} />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-5">
        <Dots step={step} total={SCREENS.length + 1} />
        {!signup && (
          <PrimaryButton onClick={() => setStep(step + 1)} className="w-full">
            Continue
          </PrimaryButton>
        )}
        {step > 0 && (
          <button type="button" className="btn btn-ghost w-full" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
      </div>
    </div>
  );
}

function Dots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex justify-center gap-2" role="img" aria-label={`Step ${step + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "bg-gradient-main w-6" : "w-1.5 bg-line"}`} />
      ))}
    </div>
  );
}

function RisingVisual() {
  return (
    <svg viewBox="0 0 300 140" className="w-full" aria-hidden="true">
      <defs>
        <linearGradient id="wf" x1="0" x2="0" y1="0" y2="1">
          <stop stopColor="#ffffff" stopOpacity="0.14" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 128 C 70 126, 120 118, 160 98 S 240 30, 300 10 L300 140 L0 140Z" fill="url(#wf)" />
      <path d="M0 128 C 70 126, 120 118, 160 98 S 240 30, 300 10" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
      <circle cx="296" cy="11" r="7" fill="#ffffff" />
    </svg>
  );
}

function RangesVisual() {
  const bars = [
    ["< 25K", 12],
    ["25K–50K", 38],
    ["50K–100K", 34],
    ["100K+", 16],
  ] as const;
  return (
    <div className="space-y-2.5" aria-hidden="true">
      {bars.map(([label, w]) => (
        <div key={label} className="flex items-center gap-3">
          <span className="w-20 text-xs font-medium text-muted">{label}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-wash">
            <div className="bg-gradient-main h-full rounded-full" style={{ width: `${w}%` }} />
          </div>
          <span className="tabular w-10 text-right text-xs font-semibold">{w}%</span>
        </div>
      ))}
    </div>
  );
}

function CreditsVisual() {
  return (
    <div className="bg-gradient-main flex h-36 items-end justify-between rounded-[22px] p-5" aria-hidden="true">
      <div>
        <p className="text-xs opacity-80">Winning share pays</p>
        <p className="text-3xl font-semibold">W$1.00</p>
      </div>
      <span className="text-sm opacity-80">losing shares pay W$0</span>
    </div>
  );
}
