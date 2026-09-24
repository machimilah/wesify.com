/**
 * Reconciliation (checklist §10): checks every balance against the ledger, the ledger chain, market
 * state against trade history, and settlement payouts. Exit code 1 on any issue, so CI or a cron can
 * alert on it.
 *
 *   npm run reconcile                 # the live data file
 *   npm run reconcile -- path/to.json # any state file or backup (.json, .json.gz, .json.gz.enc)
 */
import fs from "node:fs";
import path from "node:path";
import { readBackup } from "../src/server/backup";
import { checkIntegrity } from "../src/server/world/integrity";
import { migrate, type WorldState } from "../src/server/world/state";

const file = process.argv[2] ?? path.join(process.env.WESIFY_DATA_DIR || path.join(process.cwd(), ".data"), "main.json");
const state: WorldState = /\.gz(\.enc)?$/.test(file) ? readBackup(file) : migrate(JSON.parse(fs.readFileSync(file, "utf8")));
const report = checkIntegrity(state);
console.log(`Checked ${report.users} users, ${report.markets} markets, ${report.ledgerRows} ledger rows from ${file}`);
if (report.ok) {
  console.log("✓ All balances match the ledger; market state and settlements reconcile.");
} else {
  console.error(`✗ ${report.issues.length} issue(s):`);
  for (const i of report.issues) console.error(`  [${i.check}] ${i.entity}: ${i.detail}`);
  process.exit(1);
}
