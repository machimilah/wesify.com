# Backup and restore (§55)

## What's backed up

The entire state: users, ledger, markets, trades, positions, settlements, audit log and everything else. It's written as `main-<timestamp>.json.gz[.enc]` with a `.sha256` sidecar.

| | |
|---|---|
| Frequency | Hourly, automatically from the world tick (main world only) |
| Retention | Newest 48 files plus the newest per day for 30 days |
| Location | `BACKUP_DIR` (default `$WESIFY_DATA_DIR/backups`). Production: a different volume or a bucket mount, never only the data disk |
| Encryption | AES-256-GCM when `BACKUP_ENCRYPTION_KEY` is set. **Required in production**. Store the key in the password manager too: an encrypted backup without its key is useless |
| RPO (max data loss) | 1 hour (hourly backup) |
| RTO (time to restore) | 15 minutes |

Critical configuration is stored separately from the data: the environment variables live in the host's secret manager and in the founders' password manager, and DNS lives at the registrar/Cloudflare.

## Commands

```bash
npm run backup                         # write a backup now
npm run backup -- --list               # list backups
npm run backup:verify                  # restore every backup in memory + run integrity checks
npm run backup -- --verify <file>      # one file
npm run reconcile -- <file>            # full integrity report for a backup
npm run backup -- --restore <file>     # REPLACE the live data file (see below)
```

## Restore procedure

1. Announce the incident (see `docs/incident-handbook.md`). Turn on the trading kill switch if the app is still up.
2. **Stop the app.** It holds state in memory and would overwrite the restored file.
3. Pick the newest good backup: `npm run backup -- --list`, then `npm run backup:verify` on it.
4. `npm run backup -- --restore <file>`. The current file is backed up first, so the restore itself can be undone.
5. `npm run reconcile` must print ✓.
6. Start the app. Check `/api/health` and `/admin` → Health.
7. Markets that should have locked or settled while the app was down catch up on the first tick; settlements wait in the review queue.
8. Anything users did after the backup time is lost. Use the audit log, support tickets and email outbox to find and compensate affected users with documented adjustments.

## Monthly restore test (required)

On the first working day of the month, verify the latest backup and restore it into staging:

```bash
npm run backup:verify
WESIFY_DATA_DIR=/tmp/restore-test npm run backup -- --restore <latest>
WESIFY_DATA_DIR=/tmp/restore-test npm run reconcile
```

Record the date and result in the ops log. The launch gate in `/admin` also checks that a backup exists and is less than 2 hours old.
