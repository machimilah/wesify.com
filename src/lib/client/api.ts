"use client";

import type { WorldMeta } from "@/lib/shared/dto";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Listener = (meta: WorldMeta, receivedAt: number) => void;
const metaListeners = new Set<Listener>();
export const onMeta = (l: Listener) => {
  metaListeners.add(l);
  return () => void metaListeners.delete(l);
};

/** Connection state for the offline banner (§36 offline/network failure handling). */
type NetListener = (online: boolean) => void;
const netListeners = new Set<NetListener>();
let lastOnline = true;
export const onNetwork = (l: NetListener) => {
  netListeners.add(l);
  return () => void netListeners.delete(l);
};
function setOnline(v: boolean) {
  if (v === lastOnline) return;
  lastOnline = v;
  netListeners.forEach((l) => l(v));
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; idempotencyKey?: string }): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers["Content-Type"] = "application/json";
  if (init?.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    setOnline(false);
    throw new ApiError("NETWORK", "You're offline or the connection dropped. We'll keep trying.", 0);
  }
  setOnline(true);
  let json: { data?: T; meta?: WorldMeta; error?: { code: string; message: string; details?: Record<string, unknown> } } = {};
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  if (json.meta) {
    const receivedAt = Date.now();
    metaListeners.forEach((l) => l(json.meta!, receivedAt));
  }
  if (!res.ok || json.error) {
    throw new ApiError(json.error?.code ?? "HTTP", json.error?.message ?? "Something went wrong. Try again.", res.status, json.error?.details);
  }
  return json.data as T;
}

/** A fresh key per order: retries of the same order reuse it, so the server executes it once. */
export function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function trackEvent(name: string, properties: Record<string, string | number | boolean | null> = {}) {
  void api("/api/events", { method: "POST", body: { name, properties } }).catch(() => {});
}

/** Reports a browser error to /admin → Health (§42 frontend errors). Throttled per page load. */
let reported = 0;
export function reportClientError(message: string, extra: { stack?: string | null; digest?: string | null; kind?: "error" | "unhandledrejection" | "boundary" } = {}) {
  if (reported++ > 10) return;
  void fetch("/api/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: message.slice(0, 1000), stack: extra.stack?.slice(0, 4000) ?? null, digest: extra.digest ?? null, page: location.pathname, kind: extra.kind ?? "error" }),
    keepalive: true,
  }).catch(() => {});
}
