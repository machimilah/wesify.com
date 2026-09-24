import { ImageResponse } from "next/og";
import { logoDataUrl } from "@/server/brand";

/** Favicon and PWA icon (§2): the supplied logo, unchanged, on a white tile. */
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  const logo = logoDataUrl();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff", borderRadius: 96 }}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" style={{ width: "92%", height: "92%", objectFit: "contain" }} />
        ) : (
          <div style={{ fontSize: 200, fontWeight: 700, color: "#080809" }}>w</div>
        )}
      </div>
    ),
    size,
  );
}
