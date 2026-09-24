import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for platform OAuth tokens at rest (§63: "encrypted tokens").
 * Key comes from TOKEN_ENCRYPTION_KEY (32 bytes, base64). Development falls back to a fixed
 * derived key so the app runs without setup; production refuses to start without a real key.
 */
function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    return buf;
  }
  if (process.env.NODE_ENV === "production") throw new Error("TOKEN_ENCRYPTION_KEY is required in production");
  return createHash("sha256").update("wesify-dev-only-token-key").digest();
}

/** Returns `iv.tag.ciphertext`, each base64url. */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function decryptToken(sealed: string): string {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !body) throw new Error("Malformed encrypted token");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
