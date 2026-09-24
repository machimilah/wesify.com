# Design system (§2)

Keep every new screen consistent with these tokens and components. Tokens live in `src/app/globals.css` (`@theme` and `:root`); components live in `src/components/ui.tsx` plus the CSS component classes.

## Brand

- **Logo:** `public/brand/wesify-logo.png`, the supplied asset, used unchanged (black on transparent). On dark backgrounds the header applies a CSS invert; generated images (favicon `app/icon.tsx`, iOS icon `app/apple-icon.tsx`, social card `app/opengraph-image.tsx`, market cards `app/markets/[id]/opengraph-image.tsx`) place it on white. Never redraw it.
  - **Still needed from design:** a high-resolution master (SVG or ≥ 2048 px PNG) and an official light-on-dark version. The current PNG is enough for the web.
- **App look:** dark background with a crimson accent (decision confirmed 2026-09). The blue → light-purple gradient from the spec is the **secondary brand gradient**, used on social cards and marketing surfaces: `--gradient-brand: linear-gradient(90deg, #2F80FF, #6C63FF 55%, #A56EFF)`, utility `.text-brand-gradient`.

## Color tokens

| Token | Value | Use |
|---|---|---|
| `bg` | #080809 | page background |
| `surface` | #121214 | cards, sheets |
| `wash` | #1c1c1f | raised tint, hover, inputs |
| `line` / `line-strong` | #26262a / #38383e | borders, dividers |
| `ink` / `ink-soft` / `muted` | #f4f4f5 / #c4c4ca / #8a8a93 | text: primary / secondary / tertiary |
| `crimson` / `crimson-soft` | #dc143c / #f2647f | primary actions, leader line, accents |
| `brand-blue` / `brand-purple` | #2f80ff / #a56eff | secondary brand gradient |
| `success` | #3ecf8e | confirmations, reconciled |
| `warning` | #f5b547 | paused, stale data, review |
| `danger` | #ff5a5f | errors, destructive actions |
| `info` | #4c8dff | neutral notices, in review |
| `up` / `down` | crimson-soft / grey-blue | price moves, always with ▲ ▼ arrows and an sr-only "up/down" |

Contrast: body text on `bg` and `surface` meets WCAG AA (ink ≈ 17:1, muted ≈ 5.6:1).

## Typography

Google Sans via `next/font/google`, which self-hosts it from Google Fonts at build time under Google's web license. The fallback stack is Google Sans Text, Product Sans, system-ui, Segoe UI, Roboto, Arial. Use tabular numbers (`.tabular`) for every price, balance and count.

| Role | Style |
|---|---|
| Display | `text-4xl font-semibold tracking-tight` |
| H1 | `text-[28px] font-semibold tracking-tight` |
| H2 | `text-lg font-semibold` |
| Body | `text-sm`, inputs `text-base` (16 px stops iOS zoom) |
| Caption | `text-xs text-muted` |

## Spacing, radius, shadow

- Spacing: Tailwind's 4 px scale. Page gutters are `px-3 md:px-4`; card padding `p-4`, `p-5` for heroes.
- Radius: `--radius-sm` 6 · `md` 8 (buttons, inputs) · `lg` 12 (cards) · `xl` 16 (sheets, dialogs) · `pill`.
- Shadow: `--shadow-sm` (subtle), `--shadow-md` (hover), `--shadow-lg` (dialogs). Surfaces are mostly flat; shadows only for floating layers.
- Touch targets: at least 44 px (`--touch-target`).

## Components

| Component | Where | Notes |
|---|---|---|
| Buttons | `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-danger`; `PrimaryButton`, `SecondaryButton` | 44 px min height, disabled at 45% opacity |
| Outcome buttons | `.btn-outcome`, `.btn-outcome-alt`, `aria-pressed` for selected | |
| Inputs | `.input`, `Field` (label + hint + error with `role="alert"`) | |
| Cards | `.card`, `.card-hover` | |
| Badges | `.badge` + `-success/-warning/-danger/-info`; `PlatformBadge`, `MomentumBadge`, `StatusBadge` | always text, never color alone |
| Notices | `.notice` + variants | inline status and errors |
| Dialog | `Dialog` | focus trap, Escape, returns focus, bottom sheet on mobile |
| Loading | `Skeleton` blocks shaped like the content, `aria-busy` on the container | |
| Empty state | `Empty title + one helpful sentence + action` | |
| Error state | `ErrorState` with message and "Try again" | route errors: `app/error.tsx` |
| Charts | `PriceChart`: simple lines, leader in crimson, others neutral | |
| Mobile navigation | fixed bottom bar, 4 tabs (Markets, Portfolio, Leaders, Profile), safe-area padding | desktop uses the top nav |

## Copy (§61)

Short, direct, plain English. Say "chance" or "%" for prices; W$ is "play money". Never use casino words (bet big, jackpot, cash out, win real money) or investment words (returns, profit guaranteed). Errors say what happened and what to do next. All user-facing error copy is in `server/world/errors.ts`; the rules are in `lib/shared/rules.ts`.

## Motion and accessibility

- Animations are 180 ms or less and turn off under `prefers-reduced-motion`.
- Visible focus rings; skip link; landmarks (`header`, `main`, labelled `nav`s and regions).
- Screen-reader text for arrows and statuses.
- No information conveyed by color alone.
