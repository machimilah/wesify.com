# Content safety and launch supply (§59, §60)

## What never gets a market

- Illegal content of any kind.
- Sexual or sexually suggestive content.
- Graphic violence, injury or gore.
- Minors in any context where betting on their video's reach could put them at risk (default: exclude videos centered on children).
- Content whose outcome is tied to dangerous behaviour (challenges, stunts, self-harm, drugs, weapons).
- Videos where trading could incentivize harassment or pile-ons (someone's embarrassing moment, a private person, a dispute).
- Content known to be manipulated (bought engagement) or misleading (deepfakes, fake news).
- Hate, harassment, extremism, tragedies and news about real victims.

## Process

- **Admin approval of every user-submitted link** (flag `marketApproval`, on by default); the admin handbook has the review checklist. Creator-program markets come from vetted creators who signed the agreement, and are still reportable.
- Anyone can **report** a market (market page → Report). A report flags it for review.
- Takedowns are immediate (admin handbook).
- Content rules for users are published at `/community`.

## Launch-market supply (§59)

**Don't launch with an empty feed.** Before opening the doors:

- [ ] 20–50 live markets (launch gate checks ≥ 20; `MIN_ACTIVE_MARKETS` keeps simulated supply topped up; the cap is 100)
- [ ] Mix of creators (feed diversity caps any one creator at 2 of the top 20)
- [ ] Mix of engagement levels and market ages (staggered openings; not all closing at once)
- [ ] Metrics updating (launch gate: ≥ 90% of live markets refreshed in the last 20 minutes)
- [ ] Each market can settle (provider healthy; manual markets have an owner)
- [ ] Thumbnails load; "Watch on" links open the right video
- [ ] No prohibited or problematic content (someone reviews every live market)
- [ ] Enough trading to make prices move understandably (simulated traders, labelled SIM, plus alpha users)

Simulated markets must stay clearly labelled ("Simulated video", "simulated during testing" as the data source). Remove or relabel them before claiming real engagement data in marketing.
