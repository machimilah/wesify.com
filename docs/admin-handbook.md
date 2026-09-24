# Admin handbook (§33)

`/admin` is for the `support` role (read everything, answer tickets, resolve flags) and the `admin` role (everything). The owner token is for recovery only.

## Every day, in this order

1. **Overview:** read the alerts; check failed jobs, failing providers and paused markets.
2. **Review queue:** approve or reject submitted links, and confirm settlements (see below).
3. **Risk flags:** resolve or dismiss every open flag with a written note.
4. **Support:** answer high-priority tickets first. Target: 24 h for high, 2 business days for normal.
5. **Launch gate / Health:** everything green? Run the balance audit if anything looked odd.

## Reviewing a submitted link (§22, §60)

Open the video and approve only if:

- It's a public, original video under 6 hours old with real engagement.
- No illegal, sexual or graphic content.
- No minors at risk.
- Nothing rewarding dangerous behaviour, harassment or pile-ons.
- Not known to be manipulated (bought likes).

Reject with a short, kind reason; the submitter sees it. Approval opens a fresh 24-hour window and recomputes the ranges from the likes at that moment.

## Confirming a settlement (§1, §25)

- **Clean proposals** (no ⚠) can be approved in bulk ("Approve all clean"). Spot-check one against the platform.
- **Proposals with ⚠ issues:** open the market detail and compare the final count with the snapshot trend and the live platform count.
  - If the count is right, confirm (you acknowledge the issues).
  - If it's wrong, "Correct" with the right number and a reason.
  - If you can't get a reliable number, cancel with `PLATFORM_OUTAGE` or `METRIC_CORRUPTION`.
- **Manual-provider markets:** enter the final count ("Final count"), then confirm it in the queue. Two steps, on purpose.

## Cancelling (§26)

Choose the reason code that matches; the explanation is public. Refunds are automatic.

## Users

| Situation | Action |
|---|---|
| Suspicious but unconfirmed | **Freeze** (can't trade). Never suspend on a flag alone (§27) |
| Confirmed abuse | **Suspend** (signs them out). Record why |
| Appeals | Reinstate if the review clears them |
| Balance fixes | `adjust` for corrections, `refund` for trade-specific refunds. Always give the ticket id in the reason. Amounts ≥ W$1,000 need the amount retyped |
| Offensive usernames | Rename |
| Account deletion requests without app access | Verify ownership by email reply first, then Delete |

## Content takedown (§17)

Use "Takedown" on the market. It hides it everywhere, removes the thumbnail link and caption, and cancels the market with refunds. Reply to the creator with the canned "Creator takedown" text.

## Metrics

Metrics = business numbers, cohorts and funnel. Model = forecast accuracy on real settled markets. Health = jobs, providers, errors, latency, costs, recent emails.

## Never

- Edit `main.json` by hand.
- Settle a market before its settlement time.
- Share the owner token.
- Promise anything with money value in exchange for W$.
