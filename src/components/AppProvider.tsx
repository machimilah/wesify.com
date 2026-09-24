"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, onMeta, onNetwork, reportClientError, trackEvent } from "@/lib/client/api";
import type { AuthConfigDTO, MeDTO } from "@/lib/shared/dto";

type Clock = { worldNow: number; scale: number; receivedAt: number };
export type Consent = { analytics: boolean; marketing: boolean } | null;

type AppContextValue = {
  me: MeDTO | null;
  meLoaded: boolean;
  refreshMe: () => Promise<void>;
  clock: Clock | null;
  isDemo: boolean;
  startDemo: () => Promise<void>;
  exitDemo: () => Promise<void>;
  toast: (message: string) => void;
  logout: () => Promise<void>;
  search: string;
  setSearch: (q: string) => void;
  config: AuthConfigDTO | null;
  online: boolean;
  consent: Consent;
  setConsent: (c: { analytics: boolean; marketing: boolean }) => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

const CONSENT_COOKIE = "wesify_consent";

function readConsentCookie(): Consent {
  const m = document.cookie.match(/(?:^|; )wesify_consent=([^;]*)/);
  if (!m) return null;
  const v = decodeURIComponent(m[1]);
  return { analytics: v.includes("analytics"), marketing: v.includes("marketing") };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeDTO | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [clock, setClock] = useState<Clock | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const [search, setSearch] = useState("");
  const [config, setConfig] = useState<AuthConfigDTO | null>(null);
  const [online, setOnline] = useState(true);
  const [consent, setConsentState] = useState<Consent>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const toastId = useRef(0);

  useEffect(
    () =>
      onMeta((meta, receivedAt) => {
        setClock({ worldNow: meta.worldNow, scale: meta.scale, receivedAt });
        setIsDemo(meta.kind === "demo");
      }),
    [],
  );

  useEffect(() => {
    const off = onNetwork(setOnline);
    const on = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", down);
    if (!navigator.onLine) setOnline(false);
    // Frontend error tracking (§42).
    const onError = (e: ErrorEvent) => reportClientError(e.message, { stack: e.error?.stack ?? null });
    const onRejection = (e: PromiseRejectionEvent) => reportClientError(String(e.reason?.message ?? e.reason), { stack: e.reason?.stack ?? null, kind: "unhandledrejection" });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    setConsentState(readConsentCookie());
    return () => {
      off();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", down);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const r = await api<MeDTO | { needsProfile: true } | null>("/api/me");
      if (r && "needsProfile" in r) {
        setNeedsProfile(true);
        setMe(null);
      } else {
        setNeedsProfile(false);
        setMe(r);
        if (r?.consent) setConsentState(r.consent);
      }
    } catch {
      /* keep last known */
    } finally {
      setMeLoaded(true);
    }
  }, []);

  // Clerk signed the person in, but they haven't created their Wesify profile yet.
  useEffect(() => {
    if (needsProfile && !pathname.startsWith("/welcome/profile") && !pathname.startsWith("/terms") && !pathname.startsWith("/privacy")) router.replace("/welcome/profile");
  }, [needsProfile, pathname, router]);

  const toast = useCallback((message: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  const startDemo = useCallback(async () => {
    const user = await api<MeDTO>("/api/demo", { method: "POST" });
    setMe(user);
    setIsDemo(true);
    try {
      localStorage.setItem("wesify_onboarded", "1");
    } catch {}
  }, []);

  const exitDemo = useCallback(async () => {
    await api("/api/demo", { method: "DELETE" });
    setIsDemo(false);
    window.location.href = "/";
  }, []);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    if (config?.provider === "clerk") {
      const w = window as unknown as { Clerk?: { signOut: () => Promise<void> } };
      await w.Clerk?.signOut().catch(() => {});
    }
    setMe(null);
    window.location.href = "/";
  }, [config]);

  /** Cookie consent (§65): stored in a first-party cookie, and on the account when signed in. */
  const setConsent = useCallback(
    async (c: { analytics: boolean; marketing: boolean }) => {
      const value = ["necessary", c.analytics ? "analytics" : "", c.marketing ? "marketing" : ""].filter(Boolean).join(",");
      document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
      setConsentState(c);
      if (me) await api("/api/account", { method: "PATCH", body: { action: "consent", ...c } }).catch(() => {});
    },
    [me],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const boot = async () => {
      if (params.get("demo") === "true") {
        await startDemo().catch(() => toast("Could not start demo."));
        params.delete("demo");
        const qs = params.toString();
        window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
      }
      await refreshMe();
      api<AuthConfigDTO>("/api/auth/config").then(setConfig).catch(() => {});
      trackEvent("app_opened");
    };
    void boot();
  }, [refreshMe, startDemo, toast]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refreshMe();
    }, isDemo ? 2000 : 15_000);
    // Visit heartbeat for session-length analytics (§39).
    const hb = setInterval(() => {
      if (document.visibilityState === "visible") trackEvent("visit_heartbeat");
    }, 60_000);
    return () => {
      clearInterval(id);
      clearInterval(hb);
    };
  }, [isDemo, refreshMe]);

  const value = useMemo(
    () => ({ me, meLoaded, refreshMe, clock, isDemo, startDemo, exitDemo, toast, logout, search, setSearch, config, online, consent, setConsent }),
    [me, meLoaded, refreshMe, clock, isDemo, startDemo, exitDemo, toast, logout, search, config, online, consent, setConsent],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div key={t.id} className="card animate-rise rounded-lg px-4 py-2.5 text-sm font-medium text-ink shadow-lg">
            {t.message}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}
