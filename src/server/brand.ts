import fs from "node:fs";
import path from "node:path";

/**
 * The supplied logo asset as a data URL for generated images (icons, social cards). The file is
 * used unchanged (spec §41: never redraw the mark); generated images only place it on a background.
 */
export function logoDataUrl(): string | null {
  try {
    const buf = fs.readFileSync(path.join(process.cwd(), "public", "brand", "wesify-logo.png"));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export const BRAND = {
  crimson: "#dc143c",
  bg: "#080809",
  surface: "#121214",
  ink: "#f4f4f5",
  muted: "#8a8a93",
  gradient: "linear-gradient(90deg, #2F80FF 0%, #6C63FF 55%, #A56EFF 100%)",
};
