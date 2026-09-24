import { ImageResponse } from "next/og";
import { logoDataUrl } from "@/server/brand";

/** iOS home-screen icon (§2 app icon). */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const logo = logoDataUrl();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" style={{ width: "92%", height: "92%", objectFit: "contain" }} />
        ) : (
          <div style={{ fontSize: 80, fontWeight: 700, color: "#080809" }}>w</div>
        )}
      </div>
    ),
    size,
  );
}
