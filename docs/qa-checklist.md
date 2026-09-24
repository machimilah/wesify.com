# Pre-launch QA (§73, §36, §62, §63)

Run on staging with production-like settings, on **iPhone Safari, Android Chrome, desktop Chrome, Safari and Firefox**. Automated coverage: `npm test` (unit/integration/simulations) and `npm run test:e2e` (iPhone-sized Chromium + desktop). Everything below still needs human eyes.

## New person, no help (§73)

- [ ] Fresh account from scratch (email + password, age, terms)
- [ ] Verification email received; link works; welcome email received
- [ ] W$10,000 received, visible in header and Wallet ("Welcome credits")
- [ ] Understands the app without a founder explaining (watch silently, note every hesitation)
- [ ] Market feed loads < 2.5 s on 4G; tabs Trending / New / Biggest movers / Closing soon / Settled work
- [ ] "Watch on TikTok" opens the original (real markets)
- [ ] Trade executes: review screen → confirm → receipt; balance correct; Portfolio correct; Wallet line correct
- [ ] Price updates without refresh (≈10 s); "Likes updated … ago" advances
- [ ] Sell works (partial and full)
- [ ] Settlement works (confirm in admin → payout + notification + email)
- [ ] Cancellation works (refund at cost, explanation on market page, notification)
- [ ] Notification links open the right market
- [ ] Account deletion works; username is free again; can't sign in
- [ ] Terms, Privacy, Rules, FAQ, Community, Support, Security links work from the footer
- [ ] No obvious broken UI, no lorem/placeholder text, no fake test markets unless labelled "Simulated video"
- [ ] No admin controls visible to normal users; `/admin` asks for sign-in

## Failure behaviour

- [ ] Airplane mode mid-page: offline banner; reconnects by itself
- [ ] Double-tap "Confirm buy": one trade only
- [ ] Price moves between review and confirm: "The price moved…" message, new quote
- [ ] Market closes while the ticket is open: clear "Trading has ended" error
- [ ] Insufficient W$ and over-limit amounts show inline messages and disable Review
- [ ] Unsupported link (Instagram/YouTube), old video, deleted/private video, garbage URL: clear messages
- [ ] Missing thumbnail shows the placeholder, never a broken image
- [ ] 500 error page offers "Try again" and is reported in Admin → Health → Errors

## Mobile UX (§62)

- [ ] Markets cards readable at 375 px wide; no horizontal scroll anywhere
- [ ] Bottom nav reachable one-handed; Trade button sticky above it
- [ ] Trade sheet never overflows; keyboard doesn't cover the amount field
- [ ] Safe-area insets on iPhone (notch, home indicator)
- [ ] Share market uses the native share sheet
- [ ] PWA install + Android share target → `/share-target` opens the market or "Sent for review"

## Accessibility (§63)

- [ ] Keyboard only: tab through feed → market → ticket → confirm; visible focus; Escape closes dialogs; focus returns
- [ ] VoiceOver/TalkBack read prices with "up/down", statuses and form errors
- [ ] All images have alt text or are decorative; inputs have labels
- [ ] Reduced motion setting removes animations
- [ ] Contrast check with an automated tool (axe DevTools) on feed, market, ticket, settings: no serious issues
- [ ] Up/down is never color-only (arrows ▲ ▼ + words)

## Performance (§37)

- [ ] Lighthouse mobile on `/` and a market page: LCP < 2.5 s, CLS < 0.1
- [ ] `npm run load-test -- --users 100 --seconds 120` against staging: p95 < 800 ms on feed/market, 0 server errors, balance audit clean
- [ ] CI prints the bundle size; no chunk grows > 20% release to release without a reason
