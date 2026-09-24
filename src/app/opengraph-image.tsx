import { ImageResponse } from "next/og";
import { BRAND, logoDataUrl } from "@/server/brand";

/** Default social preview image (§2, §64). */
export const alt = "Wesify: trade the future of virality";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const logo = logoDataUrl();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: BRAND.bg, padding: 72, color: BRAND.ink }}>
        <div style={{ display: "flex", alignItems: "center", background: "#ffffff", borderRadius: 20, padding: "8px 24px", alignSelf: "flex-start" }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" style={{ height: 90, objectFit: "contain" }} />
          ) : (
            <div style={{ fontSize: 56, fontWeight: 700, color: "#080809" }}>wesify</div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>Trade the future</div>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, color: BRAND.crimson }}>of virality.</div>
          <div style={{ marginTop: 24, fontSize: 30, color: BRAND.muted }}>Predict how many likes a video gets in 24 hours.</div>
        </div>
        <div style={{ display: "flex", height: 10, borderRadius: 10, backgroundImage: BRAND.gradient }} />
        <div style={{ fontSize: 22, color: BRAND.muted }}>Play money only. Wesify Credits have no monetary value.</div>
      </div>
    ),
    size,
  );
}
