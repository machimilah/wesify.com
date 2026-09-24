import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * App secret for HMACs (unsubscribe links, hashed IPs). Required in production; development
 * derives a fixed value so the app runs without setup.
 */
export function appSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is required in production");
  return "wesify-dev-only-session-secret";
}

export function hmac(value: string): string {
  return createHmac("sha256", appSecret()).update(value).digest("base64url");
}

export function verifyHmac(value: string, signature: string): boolean {
  const a = Buffer.from(hmac(value));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Salted hash so IPs can be compared for abuse detection without storing them (§44 minimize data). */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip || ip === "local") return null;
  return createHash("sha256").update(`${appSecret()}|ip|${ip}`).digest("hex").slice(0, 32);
}
