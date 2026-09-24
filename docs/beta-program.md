# Beta program (§58, §74)

## Stage 1: Private alpha (10–20 people we know, several days)

1. Turn on `inviteOnly` and set `maxBetaUsers` to 25 (Admin → Controls). Create an invite code with cohort `alpha-1`.
2. Seed 20–50 live markets (§59 below) and keep simulated traders on so prices move.
3. Ask testers to **force every edge case** listed in `docs/qa-checklist.md`: sell, sell partially, trade into a market closing, double-tap confirm, go offline mid-trade, delete their account, dispute a settlement, submit an old or unsupported link.
4. Daily: fix balance bugs, settlement bugs, confusing copy and provider failures before anything else. Run the balance audit after every fix.

**Exit criteria:** zero integrity issues for 3 consecutive days, no open SEV1/SEV2, and every tester completed a first trade without help.

## Stage 2: Closed beta (50–100 users)

1. New invite code, cohort `beta-1`; raise `maxBetaUsers`.
2. Observe actual behaviour through the funnel, cohorts and session metrics. Talk to people who stall.
3. **Only then expand:** turn off `inviteOnly`, remove the cap, and keep the launch gate green.

## Feedback and research

| What | How |
|---|---|
| In-app feedback | `/api/feedback` (general/bug/idea); account deletion asks "why are you leaving?" (kind `churn`). Read in Admin → Support → Feedback |
| Community (optional) | a WhatsApp or Discord group for alpha testers; link it in the invite email |
| Interviews | 20-minute calls. Booking link (Calendly/Cal.com) in the welcome email for beta cohorts. Script: first impression → first trade → what confused you → would you come back tomorrow? |
| Record feedback | every interview gets a note in `docs/research/YYYY-MM-DD-name.md` or the team's tracker, tagged bug / copy / idea |
| Prioritize bugs | severity (incident handbook) × users affected. Balance and settlement bugs always first |
| Power users | Metrics: most trades, most markets, highest retention. Invite them to interviews and early features |
| Creators | Creators tab + users with connected accounts. Invite to the creator program |
| Churned users | Admin → Users sorted by last active; anyone active in their first week, then 7+ days inactive, gets a personal email: "What made you stop?" (reply goes to support). Track the reasons in feedback kind `churn` |
