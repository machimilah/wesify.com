# Settlement rules (operator view)

The user-facing rules are in `src/lib/shared/rules.ts` (rendered at `/rules`, version `RULES_VERSION`, stored on every market). This page is how the system and reviewers apply them.

## Definitions (§1)

| Item | Rule |
|---|---|
| Market | One public video, one question: its like count 24 hours after the market opened |
| Metric | Likes only |
| Horizon | `settlesAt = openedAt + 24h`; trading closes at `settlesAt − 1 min` |
| Ranges | Four, from `generateRanges` (average likes 70% + followers × 5% 30%, geometric; center = max(baseline, 2.5 × current likes); boundaries center/2, center, 2×center, rounded to nice numbers) |
| Boundaries | Min-inclusive, max-exclusive: an exact boundary count wins the higher range |
| Rounding | Balances in cents. Payouts and sale proceeds floored to the cent; refunds rounded to the cent. Shares kept at full precision |
| Payout | W$1.00 per winning share, W$0 otherwise |

## Flow (§25)

1. At `locksAt` the market goes to **LOCKED** automatically.
2. At `settlesAt` it goes to **SETTLING** and the provider is asked for the final count. The system retries on every tick if the provider is unavailable.
3. The result is recorded as a **proposal**: final count, source, capture time, winner, and integrity issues.
4. **Review** (flag `settlementReview`, on by default): a reviewer confirms in `/admin` → Review queue by typing the count. Clean proposals can be approved in bulk. A different number needs a written reason and is recorded as `reviewer-correction`.
5. **Payout** runs as one synchronous block. There is exactly one winner, losing positions close at zero, every holder is notified, and the settlement record stores the final metric, source, capture time, engine version, reviewer and proposal.
6. **Idempotency:** a unique settlement record per market. Any repeat call returns the existing result and pays nothing (tests: unit, HTTP and simulation).

## Integrity issues that block automatic settlement

- The count isn't a whole number ≥ 0.
- The count is more than 10% below the last usable snapshot.
- The count jumps far above the recent trend (20× the per-minute rate).
- The count was captured more than 30 minutes after `settlesAt`.
- The market has a risk score ≥ 0.9 (for example, impossible velocity).

## When to cancel instead (§26)

| Situation | Automatic behaviour | Reason code |
|---|---|---|
| Video deleted | Pause at once; cancel after 1 h | `DELETED_CONTENT` |
| Video private | Pause at once; cancel after 1 h (resumes if it comes back) | `PRIVATE_CONTENT` |
| No reliable final count within 12 h of `settlesAt` | Cancel | `PLATFORM_OUTAGE` |
| Metric corruption | Reviewer decides | `METRIC_CORRUPTION` |
| Confirmed manipulation | Reviewer decides | `MANIPULATION` |
| Wrong setup | Reviewer decides | `INCORRECT_SETUP` |
| Takedown | Automatic on takedown | `CONTENT_REMOVED` |
| Other | Reviewer decides | `ADMIN` |

Cancellation refunds every open position at cost basis. Shares already sold stay sold. Holders are notified. The market page shows the reason's public explanation, and the reason is logged in the audit log and the settlement record.

## Disputes

A settlement dispute ticket is high priority. Check the proposal, the snapshots and the source in the admin market detail. If the recorded count was wrong after payout, correct with ledger adjustments, not by re-settling (see `docs/support-playbook.md`).
