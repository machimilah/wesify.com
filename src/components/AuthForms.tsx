"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ApiError, api } from "@/lib/client/api";
import type { MeDTO } from "@/lib/shared/dto";
import { useApp } from "./AppProvider";
import { Field } from "./ui";

/** Loads Cloudflare Turnstile when a site key is configured (§28 CAPTCHA where necessary). */
function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = window as unknown as { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => void } };
    const render = () => w.turnstile && ref.current && w.turnstile.render(ref.current, { sitekey: siteKey, callback: onToken, theme: "dark" });
    if (w.turnstile) return void render();
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }, [siteKey, onToken]);
  return <div ref={ref} className="min-h-16" />;
}

// Only loaded when Clerk is the auth provider, so the built-in login doesn't ship Clerk's bundle.
const SignIn = dynamic(() => import("@clerk/nextjs").then((m) => m.SignIn), { ssr: false });
const SignUp = dynamic(() => import("@clerk/nextjs").then((m) => m.SignUp), { ssr: false });

const clerkAppearance = { variables: { colorPrimary: "#dc143c", colorBackground: "#121214", colorText: "#f4f4f5", colorInputBackground: "#1c1c1f", colorInputText: "#f4f4f5" } };

export function SignupForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const { refreshMe, config } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [invite, setInvite] = useState(params.get("invite") ?? "");
  const [website, setWebsite] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const renderedAt = useRef(Date.now());

  if (config?.provider === "clerk") {
    return <SignUp routing="hash" signInUrl="/login" forceRedirectUrl="/welcome/profile" appearance={clerkAppearance} />;
  }
  if (config && !config.flags.registrations) {
    return <p className="notice">New sign-ups are paused right now. Try again soon.</p>;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api<MeDTO>("/api/auth/signup", {
        method: "POST",
        body: { email, password, username, ageConfirmed: age, acceptTerms: terms, inviteCode: invite || null, referralCode: params.get("ref"), website, renderedAt: renderedAt.current, turnstileToken: token },
      });
      try {
        localStorage.setItem("wesify_onboarded", "1");
        localStorage.setItem("wesify_how_it_works_seen", "1");
        sessionStorage.setItem("wesify_tutorial", "1");
      } catch {}
      await api("/api/account", { method: "PATCH", body: { action: "onboarding-complete" } }).catch(() => {});
      await refreshMe();
      if (onDone) onDone();
      else router.replace("/?tutorial=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field id="su-email" label="Email">
        <input id="su-email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field id="su-password" label="Password" hint="At least 10 characters.">
        <input id="su-password" type="password" autoComplete="new-password" required minLength={10} className="input" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="su-password-hint" />
      </Field>
      <Field id="su-username" label="Username" hint="3–20 characters: letters, numbers, _ or . Shown on the leaderboard.">
        <input
          id="su-username"
          autoComplete="username"
          required
          maxLength={20}
          className="input"
          placeholder="Pick a username"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""))}
          aria-describedby="su-username-hint"
        />
      </Field>
      {config?.flags.inviteOnly && (
        <Field id="su-invite" label="Invite code">
          <input id="su-invite" className="input uppercase" value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())} />
        </Field>
      )}
      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={age} onChange={(e) => setAge(e.target.checked)} />
        <span>I&apos;m 18 or older.</span>
      </label>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
        <span>
          I agree to the{" "}
          <Link href="/terms" target="_blank" className="underline">
            Terms of Use
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" className="underline">
            Privacy Policy
          </Link>
          , and understand W$ is play money with no monetary value.
        </span>
      </label>
      {config?.turnstileSiteKey && <Turnstile siteKey={config.turnstileSiteKey} onToken={setToken} />}
      {error && (
        <p role="alert" className="notice notice-danger">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full min-h-12 text-base" disabled={busy || !email || password.length < 10 || username.length < 3 || !age || !terms}>
        {busy ? "Creating your account…" : "Create account · get W$10,000"}
      </button>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-ink underline">
          Log in
        </Link>
      </p>
    </form>
  );
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refreshMe, config } = useApp();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [website, setWebsite] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = params.get("next")?.startsWith("/") ? params.get("next")! : "/";

  if (config?.provider === "clerk") {
    return <SignIn routing="hash" signUpUrl="/signup" forceRedirectUrl={next} appearance={clerkAppearance} />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api<MeDTO>("/api/auth/login", { method: "POST", body: { login, password, website, turnstileToken: token } });
      try {
        localStorage.setItem("wesify_onboarded", "1");
      } catch {}
      await refreshMe();
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field id="li-login" label="Email or username">
        <input id="li-login" autoComplete="username" required className="input" value={login} onChange={(e) => setLogin(e.target.value)} />
      </Field>
      <Field id="li-password" label="Password">
        <input id="li-password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      {config?.turnstileSiteKey && <Turnstile siteKey={config.turnstileSiteKey} onToken={setToken} />}
      {error && (
        <p role="alert" className="notice notice-danger">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full min-h-12 text-base" disabled={busy || !login || !password}>
        {busy ? "Signing in…" : "Log in"}
      </button>
      <div className="flex justify-between text-sm text-muted">
        <Link href="/forgot-password" className="underline">
          Forgot password?
        </Link>
        <Link href="/welcome" className="underline">
          Create an account
        </Link>
      </div>
    </form>
  );
}
