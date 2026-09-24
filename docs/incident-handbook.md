# Incident handbook (§56, §43)

**First rule:** protect balances and settlements, then fix. W$ is play money, but a wrong balance or a wrong settlement destroys trust.

## Controls (all in `/admin` → Controls, all audited)

| Control | Effect |
|---|---|
| **Kill switch: disable trading** | No buys or sells anywhere. Markets keep tracking likes. Banner shown to users |
| **Pause all markets** | Every open market goes to PAUSED with your reason; "Resume markets paused by Wesify" undoes it |
| Pause one market / cancel one market | Per market |
| Feature flags | `providers` (stop provider traffic), `registrations`, `marketCreation`, `notifications`, `emailNotifications`, `referrals`, `leaderboard` |
| Freeze / suspend user | Freeze stops trading; suspend blocks sign-in |

**Emergency access:** the owner `ADMIN_TOKEN` works even if every admin account is locked out. It's stored in the password manager; rotate it after use.

## Severity

| Level | Examples | Response |
|---|---|---|
| SEV1 | Wrong balances, wrong/duplicate settlement, data loss, security breach, site down | Page both founders now, kill switch first, user communication within 2 h |
| SEV2 | Provider outage, pricing clearly wrong on some markets, settlements stuck, email down | Fix within hours; pause affected markets |
| SEV3 | UI bugs, slow pages, one bad market | Next working day |

## Playbooks

**Trading breaks (errors on buy/sell).** Check `/admin` → Health: errors and API error rate. If trades could be applied half-way or twice, turn on the kill switch. Run the balance audit. Fix, deploy, run the audit again, then re-enable.

**Pricing breaks (absurd prices, invalid model alerts).** Pause the affected markets, or all of them. Invalid model output is never priced, but check the "Large repricings" list. If trades happened at wrong prices, decide per market: cancel (refund at cost) or leave. Never edit quantities by hand.

**Balances are wrong.** Kill switch. Run `npm run reconcile` or the admin balance audit to find the scope. Identify the cause in the ledger and audit log. Correct only with `adjust` or `refund` (never edit files), with a reason that references the incident. Run the audit again until it's clean.

**Database / state file unavailable.** `/api/health` returns 503 and an alert fires ("Failed to persist state"). Check the disk (Health shows free space). If the file is corrupt, the app refuses to start rather than start empty; restore from backup (`docs/runbooks/backup-and-restore.md`).

**TikTok (provider) data stops.** Markets pause automatically ("Metrics are temporarily delayed") and resume when data returns. Unresolvable ones cancel 12 h after settlement time. If the outage is long, turn off the `providers` flag to stop retry traffic, post a banner via support, and cancel affected markets with `PLATFORM_OUTAGE`.

**Security issue.**

1. Contain: suspend the affected accounts and rotate the leaked secrets (`ADMIN_TOKEN`, `SESSION_SECRET`, OAuth secrets, `TOKEN_ENCRYPTION_KEY` requires re-encrypting tokens or asking creators to reconnect).
2. Disconnect sessions: changing `SESSION_SECRET` doesn't invalidate sessions, so delete them by redeploying with a cleared `sessions` map, or suspend and reinstate the affected users.
3. Preserve evidence: take a backup and export logs.
4. Assess what data was exposed.
5. Notify users (and regulators where the law requires it) within the legal deadline, typically 72 h.
6. Postmortem.

## Communication templates

**Status banner / social post, during:**

> We're looking into a problem with {trading / prices / settlements}. Trading is paused while we fix it. Your W$ and positions are safe and nothing is lost. Updates here: {link}.

**Email to affected users, after:**

> Subject: What happened with {market / your balance} on {date}
>
> Hi {username}, on {date} a problem with {short plain description} affected {your position in @creator's market / your W$ balance}. We've fixed it and {refunded W$X / corrected your balance to W$Y / cancelled the market and refunded open positions at cost}. You can see the change in your Wallet. W$ is play money with no monetary value, but we take accuracy seriously and are sorry for the confusion. Reply to this email with any questions.

**Security notice:**

> We found {issue} on {date}. It {did / did not} expose {data}. We've {fixed it / rotated keys / signed everyone out}. What you should do: {reset your password / nothing}. Questions: {security email}.

## Postmortem (within 5 working days, blameless)

Use these sections: timeline · impact (users, markets, W$) · root cause · what went well · what went badly · action items with owners and dates. File it in `docs/postmortems/YYYY-MM-DD-title.md`, and add a regression test for the cause.
