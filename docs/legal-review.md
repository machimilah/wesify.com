# Legal and platform review before public launch (§44–§47)

This is the brief for counsel. The product decisions below are already built; counsel confirms or changes them. **Nothing launches publicly until every box in section A is checked by counsel.**

## A. Counsel review (§47)

- [ ] **Play-money structure:** W$ can't be bought, redeemed, withdrawn, transferred or exchanged. There's no purchase anywhere in the product. Terms §2, `/rules` → "Wesify Credits", footer and ticket disclaimers.
- [ ] **W$ can't be read as redeemable value:** no store, no conversion rate, no prizes, no leaderboard rewards with value. Referral rewards are W$ only.
- [ ] **No prizes convert W$ into value.** Any future contest or prize triggers review (see section D).
- [ ] **Market terminology:** "market", "trade", "shares", "price = chance". Check "trade"/"buy" wording against local gambling definitions (consideration + chance + prize: here the consideration and prize are absent).
- [ ] **Gambling exposure** in each launch jurisdiction.
- [ ] **Sweepstakes law** if rewards are ever introduced.
- [ ] **Consumer-protection claims:** no promises of earnings; the copy review in §61 bans casino and investment language.
- [ ] **Platform-data rights:** we use public metadata, platform oEmbed for thumbnails, and official APIs for connected accounts only (section B).
- [ ] **Intellectual property:** thumbnails linked (not hosted) with attribution; takedown process; trademarks used only nominatively with a non-affiliation statement.
- [ ] **Creator attribution** and whether featuring creators' videos without consent is acceptable. Mitigations: public videos only, instant takedown, no market on a creator who asks.
- [ ] **Privacy:** Privacy Policy (`/privacy`), data map below, processors, retention, cookie consent, data subject rights.
- [ ] **Terms** (`/terms`) and Community rules (`/community`): fill in the governing law, venue and entity name placeholders.
- [ ] **Age gating:** 18+ self-attestation at sign-up. Decide whether stronger verification is needed anywhere.
- [ ] **Jurisdiction of incorporation** and where the service is offered (geo restrictions if needed).
- [ ] **Website disclosures:** operator identity, contact, imprint where required.

## B. Platform compliance (§46)

For each platform, before enabling live credentials:

| | TikTok | Instagram / Meta | YouTube / Google |
|---|---|---|---|
| Developer terms reviewed | [ ] | [ ] | [ ] |
| API restrictions (rate limits, data retention, caching of metrics) reviewed | [ ] | [ ] | [ ] |
| Allowed use of thumbnails/metadata confirmed (oEmbed / API display rules) | [ ] | [ ] | [ ] |
| OAuth rules (scopes requested are minimal: TikTok `user.info.basic/profile/stats, video.list`; IG `instagram_business_basic`; Google `youtube.readonly`) | [ ] | [ ] | [ ] |
| App review submitted with screencast + privacy policy URL | [ ] | [ ] | [ ] |
| Platform-required privacy language added to `/privacy` | [ ] | [ ] | [ ] |
| Attribution / branding guidelines met (links back, names, no logo misuse) | [ ] | [ ] | [ ] |
| Deep links open the native app or web correctly (`Watch on …` links use canonical URLs) | [ ] | [ ] | [ ] |
| Token deletion + revocation on disconnect | ✓ built | ✓ built (no revoke endpoint) | ✓ built |
| No scraping dependency (metrics for arbitrary videos stay simulated/manual until a licensed source exists) | ✓ | ✓ | ✓ |
| No use outside granted scopes | ✓ | ✓ | ✓ |

**Monitor policy changes** as part of the weekly routine (`docs/operations.md`).

## C. Privacy data map (§44)

| Data | Why | Retention | Processor |
|---|---|---|---|
| Email, username, password hash / Clerk id, age & terms acceptance | Account, consent proof | Until deletion | Host; Clerk (if enabled) |
| Trades, positions, ledger | The game; other users' results | Anonymized after deletion, kept | Host |
| Device id cookie, salted IP hash, user agent, session times | Security, multi-account & bot detection | 30 days after session expiry; device links until deletion | Host |
| Product analytics events | Improve the product (consent) | 180 days | Host; analytics vendor if added (consent) |
| Connected account handle, follower count, video likes, encrypted tokens | Self-trading ban, creator markets | Until disconnect/deletion (tokens deleted at disconnect) | Host; platform APIs |
| Support tickets | Support | 2 years after close | Host; email provider |
| Email content | Transactional & opted-in email | Provider's log retention | Resend |
| Backups | Recovery | 30 days | Backup storage |

Not collected: precise location, contacts, photos, payment details. Cookie consent is recorded per browser (cookie) and on the account with a timestamp, and can be changed in Settings or the Privacy page.

## D. What changes would trigger a real-money regulatory analysis

Any of these requires legal review **before** building:

- Selling W$, or any purchase that affects trading (including "boosts" or refills for money).
- Cashing out, withdrawing, transferring W$ between users, or a marketplace for it.
- Prizes, rewards, merchandise or gift cards tied to leaderboard rank or W$.
- Sponsored markets where brands pay to influence outcomes or rewards.
- Creator fee share tied to trading volume.
- Real-money deposits, order books, limit orders, leverage or options (§76).
- Allowing users under 18.
- Launching in a new country.
