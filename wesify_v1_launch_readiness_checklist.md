# Wesify V1 Launch Readiness Checklist

This document defines **everything that should be ready before the first real users begin using Wesify**.

It assumes the first public version is still:


- Uses one simple initial market type around future video engagement

The goal is not to overbuild. The goal is to make sure the first version is **usable, trustworthy, measurable, supportable, and safe enough to put in front of real users**.

---

## 1. Core Product Definition

- Finalize exactly what one Wesify market represents
- Define one settlement metric
- Start with likes only
- Define one settlement horizon. Example: likes 24 hours after market creation
- Define the number of outcome ranges (A mathematical formula that takes into account average likes and the       followers tat the user has in that social media, to determine these ranges. Only 4 ranges, for now)
- Define when settlement happens (After review)
- Define what happens if a video is deleted 
- Define what happens if a video becomes private
- Define what happens if engagement metrics disappear
- Define what happens if platform data arrives late
- Define what happens if a market is created with incorrect information 
- Define what happens if manipulation is suspected
- Define cancellation rules
- Define refund rules
- Define rounding rules
- Define tie and boundary rules
- Write all of these rules in plain English users can understand 

---

## 2. Brand and Visual Identity

- Exact Wesify logo finalized
- Logo file stored in high quality
- Light-background version
- Dark-background version if eventually necessary
- Favicon
- App icon
- Social preview image
- Primary blue
- Primary light purple
- Gradient definitions
- Background colors
- Text colors
- Border colors
- Success state
- Warning state
- Error state
- Typography system
- Google Sans where legally and technically available
- Font fallback defined
- Spacing system
- Border radius system
- Shadow system
- Button styles
- Input styles
- Card styles
- Mobile navigation style
- Loading skeleton style
- Empty-state style
- Error-state style
- Basic visual design documentation so every new screen stays consistent

---

## 3. Landing Page

- Popup that explains how Wesify works, for new users only.

---

## 4. Authentication (Clerk)

- Sign up
- Login
- Logout
- Email verification
- Password reset
- Change password
- Session management
- Session expiration
- Secure cookies
- Prevent duplicate email accounts
- Username creation
- Username uniqueness
- Username validation
- Optional Google login
- Optional Apple login
- Basic age confirmation
- Terms acceptance recorded
- Privacy-policy acceptance recorded
- Account creation timestamp
- Account deletion flow
- User data export mechanism or at least an internal process for fulfilling requests
- Block suspended accounts
- Rate-limit authentication attempts
- Basic bot protection

---

## 5. New-User Onboarding. 

- Screen 1: what Wesify is
- Screen 2: how prices work
- Screen 3: how users win or lose $
- Explain that $ is virtual
- Explain that one outcome eventually wins
- Explain that users can sell before settlement
- Give new user starting credits
- Suggested amount: $10
- Record welcome bonus in ledger
- Take user directly to markets
- Optional first-trade tutorial
- Ability to skip tutorial
- First-market walkthrough
- Explain probability versus price
- Explain market closing time
- Also, make sure that user's have a section inside their profile, that lets them connect their instagram/youtube/tiktok...

---

## 6. Markets Feed

- Main markets feed
- Video thumbnail
- Creator handle
- Platform indicator
- Current likes
- Time since market opened
- Time until close
- Momentum label
- Top outcome probabilities
- Price movement indicator
- Trade button
- Watch original button
- Link to original video
- Search
- Sorting
- Trending
- New markets
- Biggest movers
- Closing soon
- Loading states
- Empty states
- Failed-data states
- Market paused state
- Market settled state
- Correct behavior when market data updates while the user is on the page

---

## 7. Video Market Page

- Video thumbnail
- Creator
- Original-platform link
- Current engagement count
- Market question
- All outcome ranges
- Current price for every range
- Implied probability
- 1-hour change
- Optional 3-hour change
- Small price chart
- Momentum status
- Current like velocity if useful
- Countdown to market close
- Total virtual volume
- Recent market activity if useful
- User's current position
- Buy action
- Sell action
- Market rules
- Settlement definition
- Data source
- Paused-market warning
- Settlement-in-progress state
- Settled result
- Cancelled-market state
- Share market
- Watch original post

---

## 8. Trading Interface

- Select outcome
- Enter W$ amount
- Quick amount buttons
- Maximum position logic
- Current price
- Estimated number of shares
- Estimated resulting average entry price
- Potential settlement value
- Current balance
- Confirmation button
- Confirmation screen
- Trade success state
- Trade failure state
- Insufficient-balance state
- Market-closed-during-order state
- Price-changed-during-order state
- Duplicate-submit protection
- Disable button while request is processing
- Server-side validation
- Atomic database transaction
- Idempotency
- Trade receipt
- Trade timestamp

---

## 9. Selling Positions

- Sell full position
- Sell partial position
- Current price shown
- Current position value
- Unrealized W$ profit/loss
- Estimated proceeds
- Confirm sell
- Update balance
- Update shares
- Update average position state
- Record realized P&L
- Record sell transaction
- Handle price changes
- Prevent selling more shares than owned
- Handle market locking during execution

---

## 10. Virtual Wallet

- W$ balance
- Welcome credit
- Trading debits
- Selling credits
- Settlement credits
- Refunds
- Admin adjustments
- Referral credits if enabled
- Full ledger
- Balance calculated from ledger or reconciled against ledger
- No client-side balance authority
- No possibility of negative balance unless explicitly supported
- Transaction history
- Human-readable transaction descriptions
- Timestamp
- Reference to market/trade
- Reconciliation script
- Admin balance audit tool

---

## 11. Portfolio

- Total W$ balance
- Open-position value
- Unrealized P&L
- Realized P&L
- Prediction accuracy
- Open positions
- Settled positions
- Position entry price
- Current price
- Number of shares
- Time remaining
- Position value
- Profit/loss
- Sell button
- Filter by open
- Filter by settled
- Link back to market
- Correct updates after settlement
- Empty portfolio state

---

## 12. Profile

- Username
- Avatar if desired
- Account creation date
- W$ balance
- Number of markets traded
- Win rate
- Realized P&L
- Best trade
- Current streak
- Prediction accuracy
- Optional rank
- Account settings
- Privacy settings
- Logout
- Delete account

---

## 13. Leaderboard

- Daily
- Weekly
- All time
- Ranking methodology
- Minimum trade count before eligibility
- Prevent one lucky trade from dominating
- Display W$ gains
- Accuracy
- Number of markets traded
- Usernames
- Optional badges
- Anti-cheating logic
- Exclude banned accounts
- Recompute periodically
- Define tie-breaking

---

## 14. Video Ingestion

- Paste URL
- Validate supported URLs
- Normalize URL
- Extract platform
- Extract content ID
- Detect duplicate market
- Fetch permitted metadata
- Fetch thumbnail
- Fetch creator information
- Store canonical URL
- Store original platform ID
- Error if unsupported
- Error if private
- Error if deleted
- Error if data unavailable
- Prevent duplicate video records
- Prevent duplicate markets for same ruleset
- Admin override when necessary

---

## 15. Share-to-Wesify

- Website fallback with paste URL
- iOS Share Extension later if using native wrapper
- Android share target later
- Universal link/deep-link handling
- Open existing market if already created
- Create submission request if no market exists
- User sees immediate status
- Unsupported-link handling
- Duplicate-link handling
- Track how many markets originate from sharing

---

## 16. Social-Platform Data Layer

- Provider abstraction
- TikTok provider
- Mock provider
- Manual provider
- Future Instagram provider
- Standardized video object
- Standardized metric object
- Access-token storage
- Refresh-token handling
- Token encryption
- Provider rate-limit handling
- Retry logic
- Backoff logic
- Data freshness field
- Data source field
- Last successful update
- Provider-failure alert
- Ability to pause trading if data becomes unreliable
- Ability to switch providers without changing market code

---

## 17. Thumbnail and Media Rights Handling

- Use authorized or platform-permitted thumbnail source
- Store provenance of thumbnail
- Do not assume thumbnail is owned by Wesify
- Link back to original creator/video
- Creator attribution
- Platform attribution where required
- Mechanism to refresh expiring thumbnail URLs
- Remove broken thumbnails
- Remove content if necessary
- Takedown/contact process
- Avoid hosting copied video
- No unnecessary downloading of social media assets

---

## 18. Metric Collection

- Store current likes
- Timestamp each observation
- Poll active markets
- Define refresh frequency
- Suggested normal interval: 5 minutes
- Faster interval for high-momentum markets if needed
- Save historical snapshots
- Prevent duplicate snapshots
- Handle negative/incorrect metric changes
- Handle data corrections
- Mark suspicious snapshots
- Metric freshness monitoring
- Snapshot retention policy
- Database indexes for time-series access

---

## 19. Virality Engine

- 5-minute velocity
- 15-minute velocity
- 30-minute velocity
- 1-hour velocity
- 3-hour velocity
- 6-hour velocity
- Relative velocity
- Acceleration
- Momentum score
- Momentum labels
- Forecast final likes
- Forecast uncertainty
- Outcome probability calculation
- Probability normalization
- Smoothing
- Protection against a single noisy snapshot
- Cold-start prior
- Creator baseline if available
- Fallback when little history exists
- Store every model forecast
- Store model version
- Backtesting pipeline
- Calibration measurement
- Compare against naive linear extrapolation
- Brier score
- Log loss
- Bucket accuracy
- Alert if model output becomes invalid
- Prevent probabilities from summing to anything other than 1

---

## 20. Play-Money Market Engine

- Choose AMM mechanism
- LMSR is reasonable for MVP
- Define liquidity parameter
- Initial outcome state
- Model prior
- User-trade effect
- Buy-price calculation
- Sell-price calculation
- Slippage logic
- Price bounds
- Probability normalization
- Market state persistence
- Transaction locking
- Concurrent-order safety
- No creation of invalid balances
- No negative shares
- Market-state reconstruction capability
- Price-history storage
- Trade-history storage
- Simulation tests
- Extreme-case tests
- Market-reset tool for staging only

---

## 21. Model-to-Market Interaction

- Decide exactly how real engagement changes market prices
- Separate model probability from user trading state
- Prevent model changes from creating inconsistent market economics
- Decide weighting of model prior
- Decide weighting of trader behavior
- Reduce model influence as market liquidity improves if desired
- Log each repricing event
- Explain large repricings in admin interface
- Set maximum price movement per update if necessary
- Allow emergency pause

---

## 22. Market Creation

- Eligibility criteria
- Minimum video age
- Maximum video age
- Minimum engagement
- Minimum data quality
- Minimum expected trader interest
- Manipulation-risk check
- Generate question
- Generate ranges
- Generate initial probabilities
- Set opening time
- Set lock time
- Set settlement time
- Store market rules
- Admin review initially
- Open market
- Notify interested users

---

## 23. Market Supply Management

- Maximum active markets
- Suggested early range: 20 to 100
- Avoid infinite markets
- Trending-market selection
- Remove stale markets from discovery
- Ensure enough users per market
- Minimum trading activity
- Featured markets
- New markets
- Closing soon
- Market diversity
- Avoid ten near-identical creator markets dominating feed

---

## 24. Market Lifecycle

- Draft
- Open
- Paused
- Locked
- Settling
- Settled
- Cancelled
- Every state transition validated server-side
- State-transition audit log
- Scheduled jobs
- Manual emergency override
- No trading outside Open
- Correct UI for every state

---

## 25. Settlement Engine

- Automatic lock
- Final metric request
- Retry if provider unavailable
- Verify data freshness
- Detect suspicious final metric
- Determine winning range
- Exactly one winner
- Winning shares settle to defined value
- Losing positions settle to zero
- Credit ledger
- Close positions
- Record final metric
- Record data source
- Record timestamp
- Record settlement engine version
- Notify users
- Settlement idempotency
- Never pay twice
- Admin review for flagged markets
- Cancel when reliable settlement is impossible

---

## 26. Market Cancellation

- Define cancellation reasons
- Deleted content
- Private content
- Platform outage
- Metric corruption
- Manipulation
- Incorrect market setup
- Admin cancellation
- Refund methodology
- Restore balances correctly
- Close positions
- Notify affected users
- Log cancellation reason
- Public explanation on market page

---

## 27. Anti-Manipulation System

- Creator self-trading ban for connected creators
- Related-account detection where possible
- Detect unusual engagement jumps
- Detect impossible velocity
- Detect sudden repeated identical trades
- Detect many new accounts trading one outcome
- Detect many accounts from same device/IP pattern
- Position limits
- Per-market exposure limits
- Per-user trade limits
- Market integrity risk score
- User risk score
- Flagged-market queue
- Ability to freeze market
- Ability to freeze user
- Manual review tools
- Audit logs
- No automatic permanent punishment initially without review

---

## 28. Abuse Prevention

- Rate limiting
- CAPTCHA where necessary
- Email verification
- Device/session tracking
- Prevent scripted signup farms
- Prevent referral farming
- Prevent W$ exploit loops
- Prevent trade replay
- Prevent duplicate API requests
- Prevent client-side price manipulation
- Prevent forged settlement calls
- Admin authentication
- Audit admin actions

---

## 29. Notifications

- Market opened
- Position up significantly
- Position down significantly if desired
- Virality spike
- Market closing soon
- Settlement result
- Trade confirmation
- Sell confirmation
- Cancelled market
- W$ reward
- Notification preferences
- Email notifications if used
- Push infrastructure if app supports it
- Deep link from notification to relevant market
- Prevent notification spam

---

## 30. Sharing and Virality

- Share market
- Share profitable position
- Share prediction before outcome
- Generate clean social card
- Include Wesify logo
- Include creator attribution
- Include market probability
- Avoid fake monetary claims in play-money version
- Referral code
- Referral link
- Track referral source
- Reward after actual usage rather than signup only
- Prevent referral abuse

---

## 31. Creator Experience

- Creator-connect flow if available
- OAuth
- Explain permissions
- Connected-account status
- Creator dashboard
- Videos eligible for markets
- Markets attached to their videos
- Traffic generated back to platform
- Market activity
- Future fee-share messaging only if actually supported
- Creator cannot trade own markets
- Disconnect account
- Token revocation
- Delete creator data
- Creator support/contact

---

## 32. Search

- Search creator username
- Search market
- Search URL
- Search video
- Handle no results
- Search ranking
- Recent searches optional
- Prevent expensive unbounded queries

---

## 33. Admin Dashboard

- User search
- User details
- Balance history
- Trade history
- Market search
- Create market
- Pause market
- Resume market
- Cancel market
- Force metric refresh
- Manual metric entry
- Settlement review
- Force settlement only with safeguards
- Flagged users
- Flagged markets
- Provider status
- System health
- Audit logs
- Refund tool
- Account suspension
- Account reinstatement
- Content takedown
- Thumbnail refresh
- Feature flags
- Never let one accidental admin click settle/cancel without confirmation

---

## 34. Database

- Users
- Sessions
- Social accounts
- Videos
- Video metric snapshots
- Markets
- Outcomes
- Market state
- Market price history
- Trades
- Positions
- Credit ledger
- Settlements
- Cancellations
- Notifications
- Referrals
- Risk flags
- Admin actions
- Terms acceptance
- API/provider logs
- Database migrations
- Database indexes
- Foreign keys
- Unique constraints
- Data validation
- Backups
- Restore procedure
- Staging database separate from production

---

## 35. Backend

- Authentication API
- Markets API
- Market-detail API
- Trading API
- Sell API
- Portfolio API
- Profile API
- Leaderboard API
- Video ingestion API
- Social-provider API layer
- Metric-refresh jobs
- Repricing jobs
- Market-lock jobs
- Settlement jobs
- Notification jobs
- Referral logic
- Risk logic
- Admin API
- Consistent error codes
- Request validation
- Structured logging
- Rate limiting
- Server-side authorization
- Environment-variable validation

---

## 36. Frontend

- Mobile-first responsive design
- Desktop support
- Chrome
- Safari
- Firefox
- Mobile Safari
- Android Chrome
- Proper loading states
- Proper errors
- Offline/network failure handling
- Button disabled states
- Skeleton loading
- Accessible forms
- Accessible navigation
- Keyboard navigation
- Screen-reader labels
- Touch targets
- Reduced motion
- Do not use color alone for up/down movement
- Graceful handling of long usernames
- Graceful handling of missing thumbnails

---

## 37. Performance

- Optimize images
- CDN
- Cache market feed
- Cache thumbnails appropriately
- Avoid loading unnecessary data
- Server-side rendering where useful
- Lazy loading
- Bundle-size monitoring
- Database query optimization
- Pagination
- Prevent feed from fetching thousands of markets
- Monitor API latency
- Market actions should feel immediate
- Target sub-2.5-second primary load
- Trade confirmation should feel near-instant

---

## 38. Realtime Updates

- Decide polling vs WebSockets/SSE
- MVP can poll every 5 to 10 seconds
- Prices update without full page refresh
- Current likes update
- Position values update
- Market status changes live
- Handle reconnect
- Handle stale data
- Timestamp last update

---

## 39. Analytics

- Product analytics tool installed
- User signed up
- Onboarding completed
- Market viewed
- Market searched
- Original video opened
- Trade started
- Trade completed
- Trade failed
- Position sold
- Portfolio viewed
- Market shared
- Referral sent
- Referral converted
- Notification opened
- Market settled
- Market cancelled
- Creator connected
- Session length
- Markets viewed per session
- Trades per user
- Time to first trade
- Second-trade rate
- Retention
- Cohort analysis
- Funnel analysis

---

## 40. Core Business Metrics Dashboard

- Registered users
- Daily active users
- Weekly active users
- Monthly active users
- Active traders
- New traders
- Trades per trader
- Markets per trader
- Average virtual trade size
- Total virtual trading volume
- Median trade size
- First-trade conversion
- Second-trade conversion
- 1-day retention
- 7-day retention
- 28-day retention
- Position sell-before-settlement percentage
- Markets with insufficient liquidity
- Average trades per market
- Creator-share rate
- Referral conversion
- Virality model accuracy

---

## 41. Model Analytics

- Forecast history
- Actual outcomes
- Brier score
- Log loss
- Calibration plot
- Accuracy by time since upload
- Accuracy by creator size
- Accuracy by momentum
- Accuracy during spikes
- Naive baseline comparison
- Model drift
- Data-quality alerts
- Version comparison

---

## 42. Observability

- Error tracking
- Backend logs
- Frontend errors
- Job failures
- Provider failures
- Database health
- Latency monitoring
- API error rate
- Settlement failures
- Trading failures
- Notification failures
- Disk/storage monitoring
- Cost monitoring
- Alerting to founders
- Production dashboard
- Uptime monitor

---

## 43. Security

- HTTPS everywhere
- Secure headers
- CSRF protection
- XSS prevention
- SQL injection prevention
- Parameter validation
- Secret management
- No secrets committed to repository
- Token encryption
- Password hashing via trusted auth provider
- Role-based admin permissions
- Production access restrictions
- Audit log
- Dependency vulnerability scanning
- Rate limits
- Backup security
- Session invalidation
- Account lockout rules
- Principle of least privilege
- Production/staging separation
- Security contact
- Basic incident-response plan

---

## 44. Privacy

- Privacy Policy
- Define data collected
- Define why data is collected
- Define retention
- Define processors
- Define analytics vendors
- Define social-platform data use
- Define deletion process
- Cookie consent where applicable
- Marketing-email consent
- Data-access process
- Data-deletion process
- Minimize personal data
- Avoid precise location unless genuinely required
- Do not collect contacts unnecessarily
- Protect creator OAuth tokens

---

## 45. Terms and Product Rules

- Terms of Use
- Community rules
- Virtual-credit disclaimer
- W$ has no monetary value
- W$ cannot be redeemed
- W$ cannot be transferred outside platform
- Market rules
- Settlement rules
- Cancellation rules
- Manipulation prohibition
- Creator conflict rule
- Abuse prohibition
- Account suspension rights
- Content removal rights
- Age requirement
- Platform trademark disclaimers
- No affiliation claim with TikTok/Instagram unless actually partnered
- Contact details
- Governing law reviewed by counsel

---

## 46. Platform Compliance

- Review TikTok developer terms
- Review TikTok API restrictions
- Review Instagram/Meta developer terms
- Review thumbnail/metadata permissions
- Review OAuth rules
- Correct platform attribution
- Correct deep-link behavior
- No unauthorized scraping dependency
- No API use outside granted scopes
- Token deletion when user disconnects
- Platform-required privacy language
- App-review requirements
- Monitor policy changes

---

## 47. Legal Review Before Public Launch

- Confirm play-money structure
- Confirm W$ cannot accidentally be interpreted as redeemable value
- Confirm no prizes convert W$ into economic value
- Review market terminology
- Review gambling-related exposure
- Review sweepstakes law if rewards are ever introduced
- Review consumer-protection claims
- Review platform-data rights
- Review intellectual property
- Review creator attribution
- Review privacy
- Review Terms
- Review age gating
- Review jurisdiction of incorporation
- Review website disclosures
- Document what changes would trigger real-money regulatory analysis

---

## 48. Customer Support

- Support email
- Contact form
- FAQ
- Password-reset support
- Missing-W$ procedure
- Incorrect-trade procedure
- Market-dispute procedure
- Settlement-dispute procedure
- Account-deletion requests
- Abuse reports
- Creator takedown requests
- Response-time expectation
- Internal support dashboard or ticket system
- Canned responses for common issues
- Escalation process

---

## 49. Community Moderation

- If there are comments, moderate them
- Better option for V1: do not build comments
- Usernames must be moderatable
- Profile images must be moderatable
- Report user
- Report market
- Report inappropriate content
- Ban/suspend workflow
- Appeals process if needed

---

## 50. Email Infrastructure

- Verification email
- Password reset
- Welcome email
- Settlement email if enabled
- Market notification email if enabled
- Correct sender domain
- SPF
- DKIM
- DMARC
- Unsubscribe link for marketing
- Transactional versus marketing separation
- Test deliverability

---

## 51. Domains and Production Environment

- Wesify domain
- DNS
- SSL
- Production deployment
- Staging deployment
- Production environment variables
- Separate staging credentials
- Database connection pooling
- CDN
- Email domain
- Status page optional
- Backup domain/admin access recovery

---

## 52. Testing

- Unit tests
- Integration tests
- End-to-end tests
- Signup
- Login
- Reset password
- Trade
- Sell
- Settlement
- Cancellation
- Refund
- Portfolio
- Leaderboard
- Provider failure
- Network failure
- Duplicate trade
- Concurrent trade
- Duplicate settlement
- Invalid URL
- Deleted video
- Private video
- Broken thumbnail
- Suspicious metric
- Low W$ balance
- Account suspension
- Admin actions
- Mobile browser testing
- Desktop browser testing

---

## 53. Market Simulations

- Flat video
- Slow growth
- Normal growth
- Early viral spike
- Late viral spike
- Viral spike then decay
- Multiple spikes
- Data gap
- Incorrect metric
- Sudden fake-engagement spike
- Video deletion
- Market cancellation
- Very low liquidity
- Very high trading volume
- Extreme one-sided market
- Hundreds of simultaneous users
- Settlement under load

---

## 54. Load Testing

- Concurrent users
- Concurrent trades
- Feed requests
- Market-detail requests
- Metric refresh
- Settlement jobs
- Database contention
- Realtime connections
- Rate-limit behavior
- Ensure one popular video cannot crash the application

---

## 55. Data Backups

- Automated database backups
- Backup frequency
- Backup retention
- Test restore
- Document restore process
- Store critical configuration separately
- Verify backups actually work
- Recovery-time objective
- Recovery-point objective

---

## 56. Incident Response

- What happens if trading breaks
- What happens if pricing breaks
- What happens if balances are wrong
- What happens if the database is unavailable
- What happens if TikTok data stops
- What happens if a security issue appears
- Ability to pause all markets
- Ability to disable trading globally
- Emergency admin access
- Incident communication template
- User-notification process
- Postmortem process

---

## 57. Feature Flags

- Trading on/off
- Selling on/off
- New registrations on/off
- Provider on/off
- Market creation on/off
- Notifications on/off
- Leaderboard on/off
- Referrals on/off
- Ability to release features gradually

---

## 58. Beta-User Management

- Invite codes if private beta
- Maximum beta users
- Cohort tagging
- Early-user feedback form
- Discord/WhatsApp/Slack community optional
- Interview scheduling
- Record user feedback
- Prioritize bugs
- Identify power users
- Identify creators
- Contact users who churn
- Track why users stop using Wesify

---

## 59. Launch-Market Supply

- Do not launch with an empty feed
- Have 20 to 50 active markets ready
- Mix of different creators
- Mix of engagement levels
- Mix of market ages
- Ensure metrics are updating
- Ensure each market can settle
- Ensure thumbnail works
- Ensure source link works
- Ensure no prohibited or problematic content
- Ensure enough simulated or organic trading activity to make the product understandable

---

## 60. Content Safety

- Exclude illegal content
- Exclude graphic content if inappropriate for launch
- Exclude sexual content
- Exclude minors where market context creates risk
- Exclude content whose outcome is tied to dangerous behavior
- Exclude videos where trading could incentivize harassment
- Exclude manipulated content when known
- Admin market-approval process initially

---

## 61. Product Copy

- Every button finalized
- Every error message finalized
- Every onboarding sentence finalized
- Explain probability clearly
- Explain settlement clearly
- Explain W$
- Explain sell-before-settlement
- Explain market cancellation
- Avoid casino language
- Avoid investment-return claims for play money
- Keep copy concise
- Proofread everything

---

## 62. Mobile UX

- Thumb-friendly trade button
- Bottom navigation
- One-handed use
- Market cards readable at 375 px
- Modal does not overflow
- Keyboard does not cover amount field
- Safari safe-area support
- Proper scrolling
- Sticky trade button where useful
- Deep links work
- Share flow works

---

## 63. Accessibility

- Color contrast
- Focus states
- Keyboard navigation
- Semantic HTML
- Labels
- ARIA where necessary
- Reduced motion
- Alt text
- Error messages readable by assistive technologies
- Do not depend exclusively on red/green

---

## 64. SEO and Discoverability

- Public landing page indexed
- Market pages indexed only if desirable
- Correct canonical URLs
- Open Graph tags
- Social preview images
- Sitemap
- Robots.txt
- Basic structured metadata
- Do not expose private account pages

---

## 65. Analytics Consent and Cookies

- Cookie banner if legally required
- Necessary cookies separated
- Analytics consent where required
- Marketing cookies disabled without consent where required
- Consent stored
- Privacy preferences editable

---

## 66. Launch Communications

- One-sentence product explanation
- Short founder explanation
- Demo video
- Product screenshots
- Social launch posts
- Creator outreach message
- Beta invitation
- FAQ
- Feedback email
- Press/investor one-pager later
- No claims that cannot be substantiated

---

## 67. Founder Dashboard

- Users today
- Active traders
- First trades
- Repeat traders
- Trades today
- Virtual volume
- Markets live
- Markets settling
- Failed jobs
- Failed metrics
- Support tickets
- Suspicious users
- Retention
- Creator shares
- System status
- These numbers should be visible daily without SQL

---

## 68. Daily Operating Routine

- Check provider health
- Check failed jobs
- Check settling markets
- Review flagged markets
- Review support tickets
- Review suspicious accounts
- Review top markets
- Review retention
- Review new-user funnel
- Review creator participation
- Review outages/errors
- Review costs

---

## 69. Weekly Operating Routine

- Cohort retention
- Trades per user
- Market liquidity
- Market-model accuracy
- User interviews
- Creator interviews
- Most shared markets
- Best-performing acquisition source
- Worst-performing product flow
- Top bugs
- Platform-policy changes
- Infrastructure costs
- Decide one or two experiments for next week

---

## 70. Financial Controls Even for Play Money

- Cloud-budget alerts
- Database-cost alerts
- API-cost alerts
- Email-cost alerts
- Analytics-cost alerts
- Provider-cost alerts
- Monthly budget
- Spending permissions
- No unlimited third-party API loops
- Monitor cost per active user

---

## 71. Repository and Engineering Hygiene

- Git repository
- Branch protections
- Code review
- CI pipeline
- Automated tests on pull requests
- Linting
- Formatting
- Type checking
- Migration workflow
- Environment documentation
- Local setup instructions
- Deployment instructions
- Rollback instructions
- Dependency lockfile
- No secrets in git

---

## 72. Documentation

- README
- Architecture overview
- Database schema
- API documentation
- Market-engine documentation
- Virality-engine documentation
- Settlement rules
- Social-provider documentation
- Admin handbook
- Incident handbook
- Launch checklist
- Legal links
- Analytics taxonomy

---

## 73. Pre-Launch QA

- Fresh account created from scratch
- Email received
- W$ received
- User understands app without founder explanation
- Market feed loads
- Original link works
- Trade executes
- Balance correct
- Portfolio correct
- Price updates
- Sell works
- Settlement works
- Notification works
- Market cancellation works
- Account deletion works
- Terms links work
- Mobile works
- No obvious broken UI
- No placeholder text
- No fake test markets visible unless intentionally labeled
- No admin controls accessible to users

---

## 74. Private Alpha Before Public Beta

- 10 to 20 internal users
- Run for several days
- Force every major edge case
- Fix balance bugs
- Fix settlement bugs
- Fix confusing copy
- Fix provider failures
- Then invite 50 to 100 users
- Observe actual behavior
- Only then expand

---

## 75. Actual Launch Gate

- No known balance corruption
- No known settlement duplication
- No severe security issue
- Market data refresh is reliable
- At least 20 live markets
- Admin can pause everything
- Admin can cancel market
- Support channel is monitored
- Terms live
- Privacy Policy live
- W$ disclaimer visible
- Analytics functioning
- Error monitoring functioning
- Database backups functioning
- Core mobile UX functioning
- First-trade experience tested on people who did not build the app

---

## 76. What Can Wait Until After First Users

- Real-money deposits
- Real-money withdrawals
- KYC/AML
- Full regulated exchange stack
- Instagram and YouTube simultaneously
- B2B dashboard
- Advertising marketplace
- Creator fee share
- Advanced AI model
- Full order book
- Limit orders
- Options
- Leverage
- Complex social features
- Chat
- Following system
- Creator subscriptions
- Enterprise API
- Native iOS/Android apps if the mobile web experience is good enough
- Massive influencer campaign
- Paid acquisition at scale

---

# Minimum Real V1

The first real version is not just:

> Feed + trading

It is roughly six systems working together correctly:

1. **Identity**
2. **Video data**
3. **Market engine**
4. **W$ ledger**
5. **Settlement**
6. **Monitoring/admin**

If those six are robust, the first users can safely use Wesify.

Everything else improves growth, retention, and polish.

---

# Final Priority Rule

A wrong animation is a bug.

A wrong balance, wrong settlement, or wrong market result is a **trust-destroying failure**.

Those three systems should receive disproportionate engineering attention before launch.
