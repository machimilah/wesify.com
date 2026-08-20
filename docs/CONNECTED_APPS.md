# Connected apps

BO does not have to *be* the accounting system. Most companies already have one and will not swap it.
What they lack is one screen.

So a capability is either **built** or **connected**:

| Source | Who owns the records | What BO does |
|---|---|---|
| `built` | BO | Holds and edits them, as today |
| `connected` | Xero, Stripe, Shopify… | Shows them on the same page, and writes changes back |

Same page, same shape, different backing. The operator sees one system.

## BO already asked

The discovery agent has always collected `currentTools` — the apps the company already uses. Until
now nothing read it. That answer is what decides built vs connected.

A company that says *"we do our books in Xero"* gets an Invoices page backed by Xero, not a second
invoicing system to keep in step with the first. That is the same promise BO already makes — don't
build what you won't use — extended from features to whole applications.

BO only hands a capability over when the company named an app that covers it. No tools named means
everything stays built, so a company with nothing gets a whole system.

## The write rules

Writing into someone else's system is where this goes wrong, so the rules are in the model from the
start rather than bolted on when the first real connector lands.

**1. Every write is idempotent.** A queued write carries a key derived from what it changes. A retry
after a timeout re-sends the same key, so an invoice or a payment is never created twice. This is the
failure that costs a business real money, and it is the one a naive retry loop causes.

**2. Both sides changing is a conflict, not a merge.** If the record moved in BO *and* in the other
app since they last agreed, BO marks it and asks. It never picks a winner. Last-write-wins here
quietly corrupts the other system, and the operator finds out weeks later.

**3. Failures stop.** A write retries up to five times, then is abandoned and surfaced — never
retried forever, never dropped quietly. Endless retries against a rejecting API are how rate limits
and duplicate charges happen.

**4. Nothing claims to be synced when it is not.** `local-only`, `pending`, `conflict` and `error` are
real states a page can show. A page never implies the other app agrees with it.

## Sync states

```
no external id ─────────────────────────▶ local-only
                     write queued ───────▶ pending
neither side moved since last agreed ────▶ synced
only this side moved ────────────────────▶ pending
both sides moved ────────────────────────▶ conflict   (ask, never merge)
write abandoned after 5 tries ───────────▶ error
```

## What is built today

- **Provider registry** (`src/data/providers.ts`) — 20 apps, what each can back, whether its API
  accepts writes, and how it authenticates. A test enforces that every capability a provider claims
  actually exists in the catalog.
- **The decision** (`planConnections`) — turns "we use Xero" into a set of connected capabilities.
- **The write contract** (`src/engine/connections.ts`) — idempotency keys, the outbox, retry and
  abandon, conflict detection. Pure functions, fully tested.
- **The workspace** — entities now remember which capability brought them, so a page can find its
  connection. Connected pages show a banner naming the owner, and hide **Create** until the app is
  actually connected, because a record created there would have nowhere to go.
- **Settings** — lists connected apps and their state.

## What is not built

**No real connector exists yet.** Nothing authenticates, nothing syncs, no data moves. Every
connection reads `not-connected`, and the interface says exactly that rather than showing an empty
page that looks broken.

The first real connector needs, per provider: OAuth or API-key exchange and token refresh, a mapping
from that app's objects to BO entities, an incremental pull that survives interruption, and the
outbox drain that applies the write rules above. That is a meaningful piece of work per app, which is
why the decision layer was worth proving first.
