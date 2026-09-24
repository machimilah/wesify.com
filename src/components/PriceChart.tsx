"use client";

import { useMemo, useState } from "react";
import { usePoll } from "@/lib/client/hooks";
import type { HistoryDTO } from "@/lib/shared/dto";
import { percent } from "@/lib/shared/format";
import { SERIES_COLORS } from "./ui";

type Props = {
  marketId: string;
  /** Current prices by outcome id, used to rank which lines to draw. */
  outcomes: { id: string; label: string; price: number }[];
  version?: number;
  compact?: boolean;
  /** Overrides the compact/full default (e.g. a shorter chart inside the featured card). */
  height?: number;
  /** Hides the color-dot legend row — skip it where an outcome list right below already shows the same labels/prices. */
  legend?: boolean;
  /**
   * Fills the parent's height instead of using a fixed pixel height — for a flex row where a
   * sibling (e.g. a video thumbnail) with `items-stretch` sets the height. `height` still sets
   * the internal viewBox's aspect ratio, just no longer the literal rendered pixel size.
   */
  fill?: boolean;
  /**
   * The market's whole life (open → settlement). The x-axis always spans this, so a young market
   * draws its line across the part of the window that has already happened instead of stretching
   * a few minutes of data over the full width.
   */
  span?: { from: number; to: number };
};

const W = 640;

/** Line chart of the top outcomes' probabilities with a hover crosshair (§52: simple lines only). */
export function PriceChart({ marketId, outcomes, version = 0, compact = false, height, legend = true, fill = false, span }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  // Always the full history — no range picker.
  const { data } = usePoll<HistoryDTO>(`/api/markets/${marketId}/history?range=ALL&v=${version}`);
  const H = height ?? (compact ? 150 : 240);
  const PAD_TOP = 10;
  const PAD_BOTTOM = 10;

  const series = useMemo(() => {
    const ranked = [...outcomes].sort((a, b) => b.price - a.price).slice(0, 3);
    return ranked.map((o, rank) => ({ ...o, color: SERIES_COLORS[rank], index: data?.outcomes.findIndex((x) => x.id === o.id) ?? -1 }));
  }, [outcomes, data]);

  const points = data?.points ?? [];
  const ready = points.length >= 2 && series.every((s) => s.index >= 0);
  // Default to the data's own range; `span` widens it to the market's full open → settle window.
  const t0 = span?.from ?? points[0]?.t ?? 0;
  const t1 = span?.to ?? points[points.length - 1]?.t ?? 1;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => PAD_TOP + (1 - v) * (H - PAD_TOP - PAD_BOTTOM);

  const hoverPoint = hover !== null ? points[hover] : null;
  const legendValue = (idx: number, fallback: number) => (hoverPoint ? hoverPoint.prices[idx] : fallback);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!ready) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - rect.left) / rect.width) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    setHover(best);
  };

  return (
    <div className={fill ? "flex h-full flex-col" : ""}>
      {legend && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s) => (
            <li key={s.id} className="tabular flex items-center gap-1.5 text-sm">
              <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden="true" />
              <span className="text-ink-soft">{s.label}</span>
              <span className="font-semibold">{percent(s.index >= 0 ? legendValue(s.index, s.price) : s.price)}</span>
            </li>
          ))}
          {hoverPoint && (
            <li className="tabular ml-auto text-xs text-muted">
              {new Date(hoverPoint.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </li>
          )}
        </ul>
      )}

      <div className={`flex ${legend ? "mt-3" : ""} ${fill ? "min-h-0 flex-1" : ""}`}>
      <div className="relative min-w-0 flex-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className={`touch-pan-y w-full overflow-visible ${fill ? "h-full" : ""}`}
          style={fill ? undefined : { height: H }}
          role="img"
          aria-label={`Probability chart: ${series.map((s) => `${s.label} ${percent(s.price)}`).join(", ")}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <line key={v} x1="0" x2={W} y1={y(v)} y2={y(v)} stroke="#EEF0F6" strokeWidth="1" strokeDasharray={v === 0 ? undefined : "3 4"} vectorEffect="non-scaling-stroke" />
          ))}
          {ready &&
            [...series].reverse().map((s) => (
              <path
                key={s.id}
                d={points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.prices[s.index]).toFixed(1)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={s.color === SERIES_COLORS[0] ? 2.5 : 2}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            ))}
          {hoverPoint && <line x1={x(hoverPoint.t)} x2={x(hoverPoint.t)} y1={PAD_TOP} y2={H - PAD_BOTTOM} stroke="#B9BED3" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        </svg>

        {ready &&
          series.map((s) => {
            const p = hoverPoint ?? points[points.length - 1];
            return (
              <span
                key={s.id}
                className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface"
                style={{ left: `${(x(p.t) / W) * 100}%`, top: `${(y(p.prices[s.index]) / H) * 100}%`, background: s.color }}
                aria-hidden="true"
              />
            );
          })}

        {!ready && <p className="absolute inset-0 grid place-items-center text-xs text-muted">Collecting price history…</p>}
      </div>
      {/* Each label is centered on its gridline, in % of the chart height so it tracks a stretched chart. */}
      <div className={`tabular relative w-9 shrink-0 text-[10px] leading-3 text-muted ${fill ? "h-full" : ""}`} style={fill ? undefined : { height: H }} aria-hidden="true">
        {[1, 0.75, 0.5, 0.25, 0].map((v) => (
          <span key={v} className="absolute left-1.5 -translate-y-1/2" style={{ top: `${(y(v) / H) * 100}%` }}>
            {Math.round(v * 100)}%
          </span>
        ))}
      </div>
      </div>
    </div>
  );
}
