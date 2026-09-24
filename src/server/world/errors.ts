/**
 * Errors carry a stable machine code (checklist §35 "consistent error codes"), user-facing copy
 * (§61) and an HTTP status. The client shows `message` as is, so every message is final copy.
 * The full list of codes is documented in docs/api.md.
 */
export class WesifyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

export const Errors = {
  unauthorized: () => new WesifyError("UNAUTHORIZED", "Create an account to trade.", 401),
  forbidden: () => new WesifyError("FORBIDDEN", "Not allowed.", 403),
  notFound: (what = "Market") => new WesifyError("NOT_FOUND", `${what} not found.`, 404),
  marketClosed: () => new WesifyError("MARKET_CLOSED", "Trading has ended. Settlement is in progress.", 409),
  marketFinished: () => new WesifyError("MARKET_FINISHED", "This market has ended.", 409),
  marketNotOpen: () => new WesifyError("MARKET_NOT_OPEN", "This market isn't open for trading yet.", 409),
  tradingPaused: (reason?: string | null) =>
    new WesifyError("TRADING_PAUSED", reason ? `Trading is paused: ${reason.replace(/\.$/, "")}.` : "Trading is paused on this market.", 409),
  tradingDisabled: () => new WesifyError("TRADING_DISABLED", "Trading is paused across Wesify for maintenance. Your positions are safe.", 503),
  sellingDisabled: () => new WesifyError("SELLING_DISABLED", "Selling is temporarily unavailable. Your positions are safe.", 503),
  insufficientCredits: () => new WesifyError("INSUFFICIENT_CREDITS", "Not enough W$ for this trade.", 400),
  tradeLimit: (max: number) =>
    new WesifyError("TRADE_LIMIT", `Max W$${Math.floor(max).toLocaleString("en-US")} per trade (20% of balance).`, 400, { max }),
  marketLimit: (max: number) =>
    new WesifyError("MARKET_LIMIT", `Max W$${Math.floor(Math.max(0, max)).toLocaleString("en-US")} more in this market (50% of portfolio).`, 400, { max }),
  exposureLimit: (max: number) =>
    new WesifyError("EXPOSURE_LIMIT", `You can win at most W$${max.toLocaleString("en-US")} on one outcome of a market. Try a smaller amount.`, 400, { max }),
  priceBound: () => new WesifyError("PRICE_BOUND", "This trade would push the price above 99%. Try a smaller amount.", 400),
  priceChanged: (from: number, to: number) =>
    new WesifyError("PRICE_CHANGED", `The price moved from ${pct(from)} to ${pct(to)}. Check the new price and try again.`, 409, { from, to }),
  tradeRate: () => new WesifyError("TRADE_RATE_LIMIT", "You've made a lot of trades in the last hour. Take a short break and try again.", 429),
  noPosition: () => new WesifyError("NO_POSITION", "You don't have enough shares to sell.", 400),
  selfTrading: () => new WesifyError("SELF_TRADING", "You can't bet on a market you created or on your own videos.", 403),
  accountFrozen: () => new WesifyError("ACCOUNT_FROZEN", "Your account is under review, so trading is paused. Contact support if you have questions.", 403),
  accountSuspended: () => new WesifyError("ACCOUNT_SUSPENDED", "This account is suspended. Contact support if you think this is a mistake.", 403),
  // ---- Video ingestion (§14) ----
  invalidUrl: () => new WesifyError("INVALID_URL", "That doesn't look like a video link. Paste the full link from the app's Share button.", 400),
  unsupportedPlatform: (name?: string) =>
    new WesifyError("UNSUPPORTED_PLATFORM", name ? `${name} videos aren't supported yet. Wesify works with TikTok links for now.` : "Wesify works with TikTok video links for now.", 422),
  videoUnavailable: () => new WesifyError("VIDEO_UNAVAILABLE", "We cannot track this video yet. Try another link.", 422),
  videoPrivate: () => new WesifyError("VIDEO_PRIVATE", "This video is private, so its likes can't be tracked.", 422),
  videoDeleted: () => new WesifyError("VIDEO_DELETED", "This video was deleted or doesn't exist.", 422),
  videoTooOld: () => new WesifyError("VIDEO_TOO_OLD", "This video is too old. Markets open within 6 hours of posting.", 422),
  videoTooNew: () => new WesifyError("VIDEO_TOO_NEW", "This video was just posted. Try again in a few minutes, once it has some likes.", 422),
  notEligible: (reason: string) => new WesifyError("NOT_ELIGIBLE", reason, 422),
  marketCapacity: () => new WesifyError("MARKET_CAPACITY", "Wesify has as many live markets as it can run right now. Try again later.", 503),
  marketCreationDisabled: () => new WesifyError("MARKET_CREATION_DISABLED", "New markets are paused right now. Try again later.", 503),
  // ---- Accounts (§4) ----
  invalid: (message: string) => new WesifyError("INVALID", message, 400),
  usernameTaken: () => new WesifyError("USERNAME_TAKEN", "That username is taken.", 409),
  usernameNotAllowed: () => new WesifyError("USERNAME_NOT_ALLOWED", "That username isn't allowed. Pick another one.", 400),
  emailTaken: () => new WesifyError("EMAIL_TAKEN", "An account with this email already exists. Log in instead.", 409),
  invalidCredentials: () => new WesifyError("INVALID_CREDENTIALS", "That email and password don't match.", 401),
  accountLocked: (minutes: number) =>
    new WesifyError("ACCOUNT_LOCKED", `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`, 429),
  weakPassword: (min: number) => new WesifyError("WEAK_PASSWORD", `Use at least ${min} characters, and avoid common passwords.`, 400),
  registrationsClosed: () => new WesifyError("REGISTRATIONS_CLOSED", "New sign-ups are paused right now. Try again soon.", 503),
  inviteRequired: () => new WesifyError("INVITE_REQUIRED", "Wesify is invite-only right now. Enter a valid invite code.", 403),
  betaFull: () => new WesifyError("BETA_FULL", "The beta is full right now. Try again soon.", 503),
  tokenInvalid: () => new WesifyError("TOKEN_INVALID", "This link is invalid or has expired. Request a new one.", 400),
  botSuspected: () => new WesifyError("VERIFICATION_FAILED", "We couldn't verify you're human. Refresh the page and try again.", 400),
  clerkManaged: () => new WesifyError("USE_CLERK", "Sign-in is handled by our identity provider. Use the sign-in page.", 409),
  rateLimited: () => new WesifyError("RATE_LIMITED", "Too many requests. Slow down a little.", 429),
  idempotencyInFlight: () => new WesifyError("DUPLICATE_REQUEST", "This order is already being processed.", 409),
};
