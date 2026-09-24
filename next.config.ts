import type { NextConfig } from "next";

/**
 * Security headers (checklist §43). The CSP allows only what the app loads: its own scripts and
 * styles, Google Fonts (self-hosted by next/font), platform thumbnails and stand-in photos over
 * HTTPS, and — when configured — Clerk, Cloudflare Turnstile and the analytics host.
 * Inline scripts are needed by Next's hydration and the JSON-LD blocks.
 */
const dev = process.env.NODE_ENV !== "production";
const clerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const turnstile = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
const clerkHosts = clerk ? ["https://*.clerk.accounts.dev", "https://*.clerk.com", process.env.CLERK_FRONTEND_API ?? ""].filter(Boolean) : [];
const turnstileHost = turnstile ? ["https://challenges.cloudflare.com"] : [];

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} ${[...clerkHosts, ...turnstileHost].join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${[...clerkHosts, ...turnstileHost].join(" ")}${dev ? " ws: wss:" : ""}`,
  `frame-src ${[...clerkHosts, ...turnstileHost].join(" ") || "'none'"}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
]
  .map((d) => d.replace(/\s+/g, " ").trim())
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Long-lived caching for the logo; the CDN serves it (§37).
      { source: "/brand/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
    ];
  },
};

export default nextConfig;
