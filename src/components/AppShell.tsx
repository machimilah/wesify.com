"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { credits } from "@/lib/shared/format";
import { useApp } from "./AppProvider";
import { CookieBanner } from "./CookieBanner";
import { HowItWorksPopup } from "./HowItWorks";
import { Logo } from "./Logo";

const NAV = [
  { href: "/", label: "Markets", icon: MarketsIcon },
  { href: "/portfolio", label: "Portfolio", icon: PortfolioIcon },
  { href: "/leaderboard", label: "Leaders", icon: TrophyIcon },
  { href: "/creator", label: "Creator", icon: TrophyIcon, desktopOnly: true },
  { href: "/profile", label: "Profile", icon: ProfileIcon },
];

/** Full-screen flows without the app chrome. */
const BARE_ROUTES = ["/welcome", "/share", "/admin", "/login", "/signup", "/verify-email", "/forgot-password", "/reset-password"];

export function AppShell({ children, hasLogo }: { children: ReactNode; hasLogo: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, isDemo, startDemo, exitDemo, toast, search, setSearch, online, config } = useApp();
  const bare = BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  const isActive = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/markets") : pathname.startsWith(href));

  if (bare)
    return (
      <>
        {!online && <OfflineBanner />}
        {children}
        <CookieBanner />
      </>
    );

  return (
    <div className="flex min-h-dvh w-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      {!online && <OfflineBanner />}
      {config?.flags.globalPause && (
        <div role="status" className="bg-warning/15 px-4 py-2 text-center text-sm font-medium text-warning">
          Trading is paused across Wesify for maintenance. Your positions and W$ are safe.
        </div>
      )}
      {isDemo && (
        <div className="bg-gradient-main">
          <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-2 px-3 py-1.5 text-xs font-medium md:px-4">
            <span>Demo · 24 hours in 3 minutes</span>
            <span className="flex gap-1">
              <button
                className="min-h-8 rounded-md bg-black/8 px-3 hover:bg-black/15"
                onClick={() => startDemo().then(() => window.location.assign("/")).catch(() => toast("Could not restart demo."))}
              >
                Restart
              </button>
              <button className="min-h-8 rounded-md bg-black/8 px-3 hover:bg-black/15" onClick={() => void exitDemo()}>
                Exit
              </button>
            </span>
          </div>
        </div>
      )}
      {me && !isDemo && me.needsAccountUpgrade && (
        <div className="bg-wash px-4 py-2 text-center text-sm">
          Secure your account: add an email and password so you can sign in again.{" "}
          <Link href="/settings#security" className="font-semibold text-crimson-soft underline">
            Add them
          </Link>
        </div>
      )}
      {me && !isDemo && !me.needsAccountUpgrade && me.email && !me.emailVerified && me.authProvider === "local" && pathname !== "/settings" && (
        <div className="bg-wash px-4 py-2 text-center text-sm">
          Confirm your email ({me.email}) to get settlement results and recover your account.{" "}
          <Link href="/settings#security" className="font-semibold text-crimson-soft underline">
            Resend link
          </Link>
        </div>
      )}

      <header className="sticky top-0 z-30 bg-bg">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center gap-4 px-3 md:gap-3 md:px-4 lg:gap-6">
          <Link href="/" aria-label="wesify home" className="flex min-h-11 shrink-0 items-center">
            <Logo hasLogo={hasLogo} className="-my-3 h-14 md:-my-2 md:h-11 lg:-my-3 lg:h-14" />
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-0.5 md:flex lg:gap-1">
            {NAV.filter((n) => n.href !== "/profile").map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={isActive(n.href) ? "page" : undefined}
                className={`rounded-md px-2 py-2 text-sm font-semibold transition lg:px-3 ${isActive(n.href) ? "text-ink" : "text-muted hover:text-ink"}`}
              >
                {n.label === "Leaders" ? "Leaderboard" : n.label}
              </Link>
            ))}
          </nav>

          <form
            role="search"
            className="hidden min-w-0 max-w-md flex-1 lg:block"
            onSubmit={(e) => {
              e.preventDefault();
              if (pathname !== "/") router.push("/");
            }}
          >
            <label className="relative block">
              <span className="sr-only">Search markets</span>
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (pathname !== "/") router.push("/");
                }}
                placeholder="Search @creator, a caption, or paste a TikTok link"
                className="h-10 w-full rounded-lg border border-line bg-wash pl-9 pr-3 text-sm outline-none placeholder:text-muted focus:border-indigo focus:bg-surface"
              />
            </label>
          </form>

          <div className="ml-auto flex items-center gap-1 md:gap-3">
            {me ? (
              <>
                <Link href="/wallet" className="tabular hidden flex-col items-end leading-tight sm:flex" aria-label={`Balance ${credits(me.balance, { decimals: 0 })}, open wallet`}>
                  <span className="text-[11px] font-medium text-muted">Cash (play money)</span>
                  <span className="text-sm font-semibold">{credits(me.balance, { decimals: 2 })}</span>
                </Link>
                <Link
                  href="/wallet"
                  className="tabular flex min-h-11 items-center rounded-lg border border-line px-3 text-sm font-semibold sm:hidden"
                  aria-label={`Balance ${credits(me.balance, { decimals: 0 })}`}
                >
                  {credits(me.balance, { decimals: 0 })}
                </Link>
                <Link
                  href="/notifications"
                  aria-label={`Notifications${me.unreadNotifications ? `, ${me.unreadNotifications} unread` : ""}`}
                  className="relative grid size-11 place-items-center rounded-lg text-ink-soft hover:bg-wash"
                >
                  <BellIcon />
                  {me.unreadNotifications > 0 && (
                    <span className="bg-gradient-main absolute right-1 top-1 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold leading-4">
                      {me.unreadNotifications > 9 ? "9+" : me.unreadNotifications}
                    </span>
                  )}
                </Link>
                <Link
                  href="/profile"
                  aria-label="Profile"
                  className="hidden size-9 place-items-center rounded-full text-sm font-semibold text-white md:grid"
                  style={{ background: `linear-gradient(135deg, hsl(${me.avatarHue} 90% 62%), hsl(${me.avatarHue + 40} 75% 60%))` }}
                >
                  {me.username.charAt(0).toUpperCase()}
                </Link>
                {(me.role === "admin" || me.role === "support") && (
                  <Link href="/admin" className="badge hidden md:inline-flex">
                    Admin
                  </Link>
                )}
              </>
            ) : (
              <>
                <Link href="/login" className="hidden min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-ink-soft hover:bg-wash sm:flex">
                  Log in
                </Link>
                <Link href="/welcome" className="bg-gradient-main flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-screen-2xl flex-1 px-3 pb-12 md:px-4 md:pb-16">
        {children}
      </main>

      <footer className="bg-bg pb-24 md:pb-0">
        <div className="mx-auto grid max-w-screen-2xl gap-8 px-3 py-10 sm:grid-cols-2 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] md:px-4">
          <div>
            <Logo hasLogo={hasLogo} />
            <p className="mt-3 max-w-sm text-sm text-muted">Trade the future of virality. Pick where a video will finish, and watch the odds move as the internet reacts.</p>
            <p className="mt-3 max-w-sm text-xs text-muted">
              Wesify isn&apos;t affiliated with, endorsed or sponsored by TikTok, Instagram or YouTube. Videos belong to their creators and are linked, never copied.
            </p>
          </div>
          <nav aria-label="Footer: product">
            <p className="text-sm font-semibold">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li><Link href="/" className="hover:text-ink">Markets</Link></li>
              <li><Link href="/portfolio" className="hover:text-ink">Portfolio</Link></li>
              <li><Link href="/leaderboard" className="hover:text-ink">Leaderboard</Link></li>
              <li><Link href="/creator" className="hover:text-ink">For creators</Link></li>
              {/* Full page load on purpose: the demo sandbox is created during app boot. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <li><a href="/?demo=true" className="hover:text-ink">Try the 3-minute demo</a></li>
            </ul>
          </nav>
          <nav aria-label="Footer: help">
            <p className="text-sm font-semibold">Help</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li><Link href="/rules" className="hover:text-ink">How markets work</Link></li>
              <li><Link href="/faq" className="hover:text-ink">FAQ</Link></li>
              <li><Link href="/support" className="hover:text-ink">Contact support</Link></li>
              <li><Link href="/support?category=creator_takedown" className="hover:text-ink">Remove my video</Link></li>
            </ul>
          </nav>
          <nav aria-label="Footer: legal">
            <p className="text-sm font-semibold">Legal</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li><Link href="/terms" className="hover:text-ink">Terms of Use</Link></li>
              <li><Link href="/privacy" className="hover:text-ink">Privacy Policy</Link></li>
              <li><Link href="/community" className="hover:text-ink">Community rules</Link></li>
              <li><Link href="/security" className="hover:text-ink">Security</Link></li>
              <li><Link href="/privacy#cookies" className="hover:text-ink">Cookie settings</Link></li>
            </ul>
          </nav>
        </div>
        <div>
          <p className="mx-auto max-w-screen-2xl px-3 py-5 text-xs text-muted md:px-4">
            © {new Date().getFullYear()} wesify · Play money only. Wesify Credits (W$) have no monetary value and can&apos;t be bought, redeemed or withdrawn.
          </p>
        </div>
      </footer>

      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 bg-bg pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="grid grid-cols-4">
          {NAV.filter((n) => !n.desktopOnly).map((tab) => {
            const active = isActive(tab.href);
            const Icon = tab.icon;
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-15 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${active ? "text-ink" : "text-muted"}`}
                >
                  <Icon active={active} />
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <HowItWorksPopup />
      <CookieBanner />
    </div>
  );
}

function OfflineBanner() {
  return (
    <div role="alert" className="sticky top-0 z-40 bg-danger/15 px-4 py-2 text-center text-sm font-medium text-danger">
      You&apos;re offline. Prices shown may be out of date; we&apos;ll reconnect automatically.
    </div>
  );
}

const stroke = (active: boolean) => (active ? "#f2647f" : "currentColor");

function MarketsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 17l5-5 4 4 8-8M15 8h5v5" stroke={stroke(active)} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PortfolioIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="7" width="18" height="13" rx="3" stroke={stroke(active)} strokeWidth="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0110.5 4h3A1.5 1.5 0 0115 5.5V7" stroke={stroke(active)} strokeWidth="2" />
    </svg>
  );
}

function ProfileIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.5" r="4" stroke={stroke(active)} strokeWidth="2" />
      <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TrophyIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 4h8v5a4 4 0 01-8 0V4zM12 13v4M8 20h8" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 20.5a2 2 0 004 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
