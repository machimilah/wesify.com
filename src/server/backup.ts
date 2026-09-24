import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { checkIntegrity, type IntegrityReport } from "./world/integrity";
import { migrate, type WorldState } from "./world/state";

/**
 * Backups (checklist §55). Hourly snapshots of the whole state, gzip-compressed and, when
 * BACKUP_ENCRYPTION_KEY is set, AES-256-GCM encrypted (§43 backup security). Retention keeps the
 * last 48 hourly files plus one per day for 30 days. Every file has a sha256 sidecar, and
 * `verifyBackup` proves a file restores into a state that passes the integrity checks.
 *
 * RPO (recovery point objective): 1 hour. RTO (recovery time objective): 15 minutes.
 * See docs/runbooks/backup-and-restore.md.
 */
export const BACKUP_DIR = () => process.env.BACKUP_DIR || path.join(process.env.WESIFY_DATA_DIR || path.join(process.cwd(), ".data"), "backups");
const MAGIC = "WSFYENC1";

function key(): Buffer | null {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must be 32 bytes, base64");
  return buf;
}

export function encodeBackup(json: string): Buffer {
  const gz = gzipSync(Buffer.from(json, "utf8"));
  const k = key();
  if (!k) return gz;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(gz), cipher.final()]);
  return Buffer.concat([Buffer.from(MAGIC), iv, cipher.getAuthTag(), body]);
}

export function decodeBackup(buf: Buffer): string {
  let gz = buf;
  if (buf.subarray(0, MAGIC.length).toString() === MAGIC) {
    const k = key();
    if (!k) throw new Error("This backup is encrypted; set BACKUP_ENCRYPTION_KEY to read it");
    const iv = buf.subarray(8, 20);
    const tag = buf.subarray(20, 36);
    const decipher = createDecipheriv("aes-256-gcm", k, iv);
    decipher.setAuthTag(tag);
    gz = Buffer.concat([decipher.update(buf.subarray(36)), decipher.final()]);
  }
  return gunzipSync(gz).toString("utf8");
}

const stamp = (t: number) => new Date(t).toISOString().replace(/[:.]/g, "-").slice(0, 19);

export function runBackup(state: WorldState, now = Date.now()): { file: string; bytes: number; sha256: string } {
  const dir = BACKUP_DIR();
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  const buf = encodeBackup(JSON.stringify(state));
  const file = path.join(dir, `main-${stamp(now)}.json.gz${key() ? ".enc" : ""}`);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  fs.writeFileSync(`${file}.tmp`, buf);
  fs.renameSync(`${file}.tmp`, file);
  fs.writeFileSync(`${file}.sha256`, `${sha256}  ${path.basename(file)}\n`);
  prune(dir, now);
  return { file, bytes: buf.length, sha256 };
}

export function listBackups(): { file: string; bytes: number; createdAt: number }[] {
  const dir = BACKUP_DIR();
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) return [];
  return fs
    .readdirSync(/*turbopackIgnore: true*/ dir)
    .filter((f) => /^main-.*\.json\.gz(\.enc)?$/.test(f))
    .map((f) => {
      const st = fs.statSync(/*turbopackIgnore: true*/ path.join(dir, f));
      return { file: path.join(dir, f), bytes: st.size, createdAt: st.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Keeps 48 newest, plus the newest of each day for 30 days. */
function prune(dir: string, now: number) {
  const all = listBackups();
  const keep = new Set(all.slice(0, 48).map((b) => b.file));
  const perDay = new Map<string, string>();
  for (const b of all) {
    const day = new Date(b.createdAt).toISOString().slice(0, 10);
    if (now - b.createdAt < 30 * 86_400_000 && !perDay.has(day)) perDay.set(day, b.file);
  }
  for (const f of perDay.values()) keep.add(f);
  for (const b of all) {
    if (keep.has(b.file)) continue;
    fs.rmSync(b.file, { force: true });
    fs.rmSync(`${b.file}.sha256`, { force: true });
  }
  void dir;
}

export function readBackup(file: string): WorldState {
  const buf = fs.readFileSync(/*turbopackIgnore: true*/ file);
  const sidecar = `${file}.sha256`;
  if (fs.existsSync(/*turbopackIgnore: true*/ sidecar)) {
    const expected = fs.readFileSync(/*turbopackIgnore: true*/ sidecar, "utf8").split(/\s+/)[0];
    const actual = createHash("sha256").update(buf).digest("hex");
    if (expected !== actual) throw new Error(`Checksum mismatch for ${path.basename(file)}`);
  }
  const state = JSON.parse(decodeBackup(buf)) as WorldState;
  if (state.version !== 1 || state.kind !== "main") throw new Error("Not a main-world backup");
  return migrate(state);
}

/** Restores a backup into memory and runs every integrity check on it (§55 "verify backups work"). */
export function verifyBackup(file: string): IntegrityReport & { file: string } {
  const state = readBackup(file);
  return { file, ...checkIntegrity(state) };
}
