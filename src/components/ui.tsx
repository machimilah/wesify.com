"use client";

/* eslint-disable @next/next/no-img-element -- dummy stand-in photos come from an external
   placeholder service, so next/image's optimizer has nothing local to work with. */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { MarketStatus, MomentumLabel, Platform } from "@/lib/shared/types";
import { signedPercent } from "@/lib/shared/format";

/**
 * Video frame. `src` is the platform-permitted thumbnail (linked from the platform, never
 * re-hosted, §17). Simulated markets have none, so `seed` pulls a generic stand-in photo.
 * The gradient stays underneath as the loading state and as the fallback when an image breaks.
 */
export function Thumbnail({
  hue,
  caption,
  className = "",
  showPlay = true,
  seed,
  src,
}: {
  hue: number;
  caption?: string;
  className?: string;
  showPlay?: boolean;
  seed?: string;
  src?: string | null;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const image = src ?? (seed ? `https://picsum.photos/seed/${encodeURIComponent(seed)}/480/720` : null);
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-lg ${className}`}
      style={{
        background: `linear-gradient(155deg, hsl(${hue} 90% 72%) 0%, hsl(${hue + 28} 80% 58%) 55%, hsl(${hue + 55} 70% 42%) 100%)`,
      }}
      role="img"
      aria-label={caption ? `Video: ${caption}` : "Video thumbnail"}
    >
      {image && !photoFailed && (
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-cover"
          onError={() => setPhotoFailed(true)}
        />
      )}
      {showPlay && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="grid size-8 place-items-center rounded-full bg-black/30 backdrop-blur-sm">
            <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 1.8v10.4L12 7 3 1.8z" fill="white" />
            </svg>
          </span>
        </div>
      )}
    </div>
  );
}

/** Direction shown with arrow + sign, never color alone (§77). */
export function Change({ value, suffix, className = "", points }: { value: number | null; suffix?: string; className?: string; points?: boolean }) {
  if (value === null || !Number.isFinite(value)) return <span className={`text-muted ${className}`}>—</span>;
  const rounded = Math.round(value * 100);
  const dir = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "•";
  const color = dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-muted";
  return (
    <span className={`tabular inline-flex items-center gap-0.5 font-semibold ${color} ${className}`}>
      <span aria-hidden="true" className="text-[0.65em]">{arrow}</span>
      <span>
        <span className="sr-only">{dir === "up" ? "up " : dir === "down" ? "down " : ""}</span>
        {points ? Math.abs(rounded) : signedPercent(value).replace(/^[+−]/, "")}
        {suffix ? ` ${suffix}` : ""}
      </span>
    </span>
  );
}

export function Sparkline({ values, className = "h-6 w-16", color = "#6C63FF" }: { values: number[]; className?: string; color?: string }) {
  if (values.length < 2) return <div className={className} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 24}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={className} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="tabular mt-0.5 truncate text-lg font-semibold tracking-tight">{value}</p>
      {sub && <div className="text-xs">{sub}</div>}
    </div>
  );
}

/** Underlined tab strip (exchange style). */
export function Tabs<T extends string>({ options, value, onChange, label, className = "" }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={`no-scrollbar flex gap-5 overflow-x-auto ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`-mb-px min-h-11 shrink-0 border-b-2 text-sm font-semibold whitespace-nowrap transition ${
            o.value === value ? "border-indigo text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Compact pill toggle, used for chart ranges. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-h-8 rounded-md px-2.5 text-xs font-semibold transition ${o.value === value ? "bg-wash text-ink" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="py-14 text-center">
      <p className="text-base font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-wash ${className}`} />;
}

export function PrimaryButton({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`bg-gradient-main min-h-12 rounded-lg px-6 text-base font-semibold transition hover:brightness-105 active:scale-[0.99] disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`min-h-10 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink transition hover:bg-wash disabled:opacity-50 ${className}`}>
      {children}
    </button>
  );
}

/** Rank-based colors: the leader in the app's crimson, the rest neutral so the leader reads first. */
export const SERIES_COLORS = ["#DC143C", "#E4E7F4", "#8A8A93"];

/** Failed-data state with a retry (§6, §36). */
export function ErrorState({ title = "Couldn't load this.", message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="py-12 text-center">
      <p className="text-base font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{message ?? "Check your connection. We'll keep trying."}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-secondary mt-4">
          Try again
        </button>
      )}
    </div>
  );
}

const PLATFORM_LABEL: Record<Platform, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };

/** Platform indicator (§6). Text label, so it never depends on recognizing a logo. */
export function PlatformBadge({ platform, className = "" }: { platform: Platform; className?: string }) {
  return (
    <span className={`badge ${className}`} title={`${PLATFORM_LABEL[platform]} video`}>
      <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        {platform === "tiktok" ? <path d="M16 3c.3 2.3 1.8 3.9 4 4.1v3.2c-1.5 0-2.9-.4-4-1.2V15a6 6 0 11-6-6v3.3a2.8 2.8 0 102.8 2.8V3H16z" /> : <circle cx="12" cy="12" r="8" />}
      </svg>
      {PLATFORM_LABEL[platform]}
    </span>
  );
}

const MOMENTUM_TEXT: Record<MomentumLabel, string> = { COOLING: "Cooling", STABLE: "Stable", RISING: "Rising", SURGING: "Surging", EXPLODING: "Exploding" };

/** Momentum label (§6, §7): arrow + word, so it reads without color. */
export function MomentumBadge({ label }: { label: MomentumLabel }) {
  const hot = label === "SURGING" || label === "EXPLODING";
  const arrow = label === "COOLING" ? "▼" : label === "STABLE" ? "•" : "▲";
  return (
    <span className={`badge ${hot ? "badge-danger" : label === "RISING" ? "badge-warning" : ""}`}>
      <span aria-hidden="true">{arrow}</span>
      {MOMENTUM_TEXT[label]}
    </span>
  );
}

export function StatusBadge({ status }: { status: MarketStatus }) {
  const map: Record<MarketStatus, [string, string]> = {
    DRAFT: ["In review", "badge-info"],
    OPEN: ["Open", "badge-success"],
    PAUSED: ["Paused", "badge-warning"],
    LOCKED: ["Trading closed", ""],
    SETTLING: ["Settling", "badge-info"],
    SETTLED: ["Settled", ""],
    CANCELLED: ["Cancelled", "badge-danger"],
  };
  const [text, cls] = map[status];
  return <span className={`badge ${cls}`}>{text}</span>;
}

/**
 * Accessible modal (§36, §63): labelled, traps focus, closes on Escape, returns focus on close,
 * and scrolls internally so it never overflows small screens (§62).
 */
export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])') ?? []);
    (focusables()[0] ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className={`animate-rise max-h-[92dvh] w-full ${wide ? "max-w-2xl" : "max-w-md"} pb-safe overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-2xl outline-none sm:rounded-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id={id} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-wash hover:text-ink">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Labelled form field with an error message tied to the input for screen readers (§63). */
export function Field({ label, hint, error, children, id }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; id: string }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink-soft">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
