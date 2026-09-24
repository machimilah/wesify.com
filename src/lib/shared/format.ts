export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(n / 1_000)}K`;
  return `${Math.round(n)}`;
}

function trim(v: number): string {
  const digits = Math.abs(v) >= 100 ? 0 : 1;
  return v.toFixed(digits).replace(/\.0$/, "");
}

export function credits(n: number, opts: { sign?: boolean; decimals?: number } = {}): string {
  const decimals = opts.decimals ?? (Math.abs(n) < 100 ? 2 : 0);
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = n < 0 ? "−" : opts.sign ? "+" : "";
  return `${sign}W$${body}`;
}

export function price(p: number): string {
  return `W$${p.toFixed(2)}`;
}

export function percent(p: number, decimals = 0): string {
  const v = p * 100;
  if (v > 0 && v < 1 && decimals === 0) return "<1%";
  if (v < 100 && v > 99 && decimals === 0) return ">99%";
  return `${v.toFixed(decimals)}%`;
}

export function signedPercent(change: number): string {
  const v = Math.round(change * 100);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
}

export function duration(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (totalMin > 0) return `${m}m`;
  return `${Math.max(1, Math.floor(ms / 1000))}s`;
}
