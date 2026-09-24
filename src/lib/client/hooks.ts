"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { ApiError, api } from "./api";

/**
 * Fetches `path` and refetches on an interval (10s normally, faster in demo mode) and on focus
 * (§38: polling, no full page refresh). `updatedAt` is when data last arrived; `stale` turns true
 * after several missed polls so pages can say the numbers may be out of date.
 */
export function usePoll<T>(path: string | null, opts: { intervalMs?: number } = {}) {
  const { isDemo } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const refresh = useCallback(async () => {
    const current = pathRef.current;
    if (!current) return;
    try {
      const next = await api<T>(current);
      if (pathRef.current === current) {
        setData(next);
        setError(null);
        setUpdatedAt(Date.now());
      }
    } catch (err) {
      if (pathRef.current === current) setError(err instanceof ApiError ? err : new ApiError("NETWORK", "Connection lost.", 0));
    } finally {
      if (pathRef.current === current) setLoading(false);
    }
  }, []);

  const interval = opts.intervalMs ?? (isDemo ? 1500 : 10_000);
  useEffect(() => {
    if (!path) return;
    setLoading(true);
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, interval);
    const onFocus = () => void refresh();
    const onOnline = () => void refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [path, interval, refresh]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);
  void tick;
  const stale = updatedAt !== null && Date.now() - updatedAt > interval * 3 + 5000;

  return { data, error, loading, refresh, updatedAt, stale };
}

/** World time that keeps advancing between server responses (compressed in demo). */
export function useWorldNow(): number {
  const { clock } = useApp();
  const compute = useCallback(
    () => (clock ? clock.worldNow + (Date.now() - clock.receivedAt) * clock.scale : Date.now()),
    [clock],
  );
  const [now, setNow] = useState(compute);
  useEffect(() => {
    setNow(compute());
    const id = setInterval(() => setNow(compute()), clock && clock.scale > 1 ? 250 : 1000);
    return () => clearInterval(id);
  }, [compute, clock]);
  return now;
}

/** Reads a localStorage flag safely (private windows and blocked storage return the fallback). */
export function useStoredFlag(key: string): [boolean | null, (v: boolean) => void] {
  const [value, setValue] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setValue(localStorage.getItem(key) === "1");
    } catch {
      setValue(false);
    }
  }, [key]);
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  );
  return [value, set];
}
