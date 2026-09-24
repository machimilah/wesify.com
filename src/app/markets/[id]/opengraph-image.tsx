import { ImageResponse } from "next/og";
import { BRAND, logoDataUrl } from "@/server/brand";
import { getMainWorld } from "@/server/store";
import { platformDisplayName } from "@/lib/social-providers";

/**
 * Social card for a shared market (§30): Wesify logo, creator attribution and the current odds.
 * Probabilities only: no money language, since W$ is play money.
 */
export const alt = "Wesify market";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function MarketImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const world = getMainWorld();
  const market = world.state.markets[id];
  const video = market ? world.state.videos[market.videoId] : undefined;
  const outcomes = market ? [...world.state.outcomes[id]].sort((a, b) => b.currentPrice - a.currentPrice).slice(0, 3) : [];
  const logo = logoDataUrl();
  const visible = market && video && !market.hidden && market.status !== "DRAFT";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: BRAND.bg, padding: 64, color: BRAND.ink }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", background: "#ffffff", borderRadius: 16, padding: "6px 18px" }}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" style={{ height: 64, objectFit: "contain" }} />
            ) : (
              <div style={{ fontSize: 40, fontWeight: 700, color: "#080809" }}>wesify</div>
            )}
          </div>
          {visible && <div style={{ fontSize: 26, color: BRAND.muted }}>Video by @{video.creatorHandle} on {platformDisplayName(video.platform)}</div>}
        </div>
        <div style={{ marginTop: 48, fontSize: 52, fontWeight: 700, lineHeight: 1.15 }}>
          {visible ? `How many likes will @${video.creatorHandle}'s video have after 24 hours?` : "Trade the future of virality."}
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 40, gap: 18 }}>
          {visible &&
            outcomes.map((o, i) => (
              <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <div style={{ width: 240, fontSize: 34, fontWeight: 600 }}>{o.label}</div>
                <div style={{ display: "flex", flex: 1, height: 26, background: BRAND.surface, borderRadius: 13 }}>
                  <div style={{ width: `${Math.max(3, Math.round(o.currentPrice * 100))}%`, height: 26, borderRadius: 13, background: i === 0 ? BRAND.crimson : "#3a3a40" }} />
                </div>
                <div style={{ width: 120, textAlign: "right", fontSize: 38, fontWeight: 700, color: i === 0 ? BRAND.crimson : BRAND.ink }}>{Math.round(o.currentPrice * 100)}%</div>
              </div>
            ))}
        </div>
        <div style={{ marginTop: "auto", fontSize: 22, color: BRAND.muted }}>Play money only. Wesify Credits have no monetary value.</div>
      </div>
    ),
    size,
  );
}
