# Support playbook (§48, §49)

| Channel | Where |
|---|---|
| Support email | `SUPPORT_EMAIL` (shown in Terms, Privacy and emails) |
| Contact form | `/support` (categories, works signed out) |
| FAQ | `/faq`; rules at `/rules` |
| Internal desk | `/admin` → Support: tickets, replies emailed to the user, internal notes, canned responses, feedback |

**Response times (published):** high priority within 24 h, normal within 2 business days. High priority covers security, settlement disputes, creator takedowns, market reports and missing W$.

## Procedures

**Missing W$.** Open the user in Admin → Users → Balance history. Every change has a reason and a market link. If the balance matches the ledger, explain it with the canned "Missing W$" reply. If our error caused a loss, `refund` with the ticket id as the reason.

**Incorrect trade** ("I didn't mean to", "wrong price"). Check the trade in the user detail: price before and after, and the review step. Trades the user confirmed stand. System errors (price guard failed, double execution) get a `refund`, and the bug goes on the bug list.

**Market dispute** (wrong video, bad ranges, manipulation). Check the market detail and flags. If set up incorrectly, cancel with `INCORRECT_SETUP`. If manipulated, pause and investigate.

**Settlement dispute.** Compare the recorded proposal, snapshots and the live platform count. If we were wrong after payout, don't re-settle. Correct each affected user with `adjust` (the ticket reason), and post a public note on the market via support. Reply with the canned "Settlement explanation".

**Password reset.** Point them to "Forgot password?". If email doesn't arrive, check Health → Recent email for delivery status. With Clerk, reset happens in Clerk.

**Account deletion requests.** Users can do it themselves in Settings. For requests by email, confirm they control the address (reply from it), then Admin → Users → Delete.

**Privacy / data requests.** Export is in Settings. For other requests (correction, objection), reply within 30 days and log them in the ticket.

**Abuse reports / report user / report market.** Reports create a risk flag automatically. Review it, then freeze, suspend or rename (moderation). Never punish permanently without review.

**Creator takedown.** Verify it's their account (DM from the handle, or the connected account), then Takedown. Reply with the canned text.

**Appeals.** Re-review with a second person where possible; reinstate or explain.

## Escalation

| Level | Handles | Examples |
|---|---|---|
| L1 | Support role: FAQ-level, password, simple explanations | |
| L2 | Admin: W$ corrections, cancellations, suspensions, disputes | |
| L3 | Founders on call | Anything touching many users or balances, security, legal letters, press |

Page L3 immediately for SEV1 (`docs/incident-handbook.md`).

## Canned responses

These are in `/admin` → Support → "Canned response…": missing W$, settlement explanation, cancelled market, password reset, account deletion, creator takedown, W$ is play money. Edit them in `src/server/world/support.ts`.
