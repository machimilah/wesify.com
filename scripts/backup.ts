/**
 * Backup tooling (checklist §55). See docs/runbooks/backup-and-restore.md.
 *
 *   npm run backup                      # write a backup of the current data file now
 *   npm run backup -- --list            # list backups, newest first
 *   npm run backup -- --verify [file]   # restore into memory + run integrity checks (default: all)
 *   npm run backup -- --restore <file>  # replace the data file (stop the server first!)
 */
import fs from "node:fs";
import path from "node:path";
import { BACKUP_DIR, listBackups, readBackup, runBackup, verifyBackup } from "../src/server/backup";
import { migrate, type WorldState } from "../src/server/world/state";

const DATA_DIR = process.env.WESIFY_DATA_DIR || path.join(process.cwd(), ".data");
const MAIN = path.join(DATA_DIR, "main.json");
const args = process.argv.slice(2);

function loadCurrent(): WorldState {
  return migrate(JSON.parse(fs.readFileSync(MAIN, "utf8")));
}

if (args.includes("--list")) {
  const all = listBackups();
  console.log(`${all.length} backup(s) in ${BACKUP_DIR()}`);
  for (const b of all) console.log(`${new Date(b.createdAt).toISOString()}  ${(b.bytes / 1024).toFixed(0).padStart(8)} KB  ${path.basename(b.file)}`);
} else if (args.includes("--verify")) {
  const target = args[args.indexOf("--verify") + 1];
  const files = target && !target.startsWith("--") ? [target] : listBackups().map((b) => b.file);
  let failed = 0;
  for (const f of files) {
    try {
      const r = verifyBackup(f);
      console.log(`${r.ok ? "✓" : "✗"} ${path.basename(f)}: ${r.users} users, ${r.markets} markets${r.ok ? "" : `, ${r.issues.length} integrity issue(s)`}`);
      if (!r.ok) failed++;
    } catch (err) {
      failed++;
      console.error(`✗ ${path.basename(f)}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (!files.length) console.log("No backups found.");
  process.exit(failed ? 1 : 0);
} else if (args.includes("--restore")) {
  const file = args[args.indexOf("--restore") + 1];
  if (!file) throw new Error("Usage: npm run backup -- --restore <file>");
  const restored = readBackup(file);
  // Keep the file being replaced, so a restore can itself be undone.
  if (fs.existsSync(MAIN)) {
    const saved = runBackup(loadCurrent());
    console.log(`Saved the current state first: ${path.basename(saved.file)}`);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(`${MAIN}.restore.tmp`, JSON.stringify(restored));
  fs.renameSync(`${MAIN}.restore.tmp`, MAIN);
  console.log(`Restored ${path.basename(file)} → ${MAIN}. Start the server again.`);
} else {
  const r = runBackup(loadCurrent());
  console.log(`Backup written: ${r.file} (${(r.bytes / 1024).toFixed(0)} KB, sha256 ${r.sha256.slice(0, 12)}…)`);
}
