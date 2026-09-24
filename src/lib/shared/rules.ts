import type { CancelReason } from "./types";

/**
 * The market rules in plain English (checklist §1, §45). Markets store the version they opened
 * under, so a later wording change never rewrites the rules of a running market. Bump the version
 * whenever the meaning of a rule changes.
 */
export const RULES_VERSION = "2026-09-v1";
export const TERMS_VERSION = "2026-09-v1";
export const PRIVACY_VERSION = "2026-09-v1";

/** Hours after a market's scheduled settlement before an unresolvable market is cancelled. */
export const SETTLEMENT_METRIC_DEADLINE_HOURS = 12;
/** Hours a video can stay deleted/private before its market is cancelled. */
export const UNAVAILABLE_GRACE_HOURS = 1;

export type RuleSection = { id: string; title: string; points: string[] };

export const MARKET_RULES: RuleSection[] = [
  {
    id: "what",
    title: "What a market is",
    points: [
      "Each market asks one question about one video: how many likes will it have 24 hours after the market opened?",
      "Wesify only counts likes. Views, comments and shares don't affect the result.",
      "Each market has four like ranges. Exactly one of them will win.",
    ],
  },
  {
    id: "ranges",
    title: "How the ranges are chosen",
    points: [
      "The ranges are sized to the creator. We start from how many likes their videos usually get and how many followers they have.",
      "We blend the two (average likes counts most), then make sure the video's current likes sit well below the top of the contest, so every range can still win when the market opens.",
      "The middle of the contest is the larger of that blend and 2.5× the likes the video already has. The boundaries are half of that middle, the middle itself, and double it, rounded to easy numbers.",
      "Ranges are fixed when the market opens and never change afterwards.",
    ],
  },
  {
    id: "prices",
    title: "Prices and payouts",
    points: [
      "A share of a range costs between W$0.01 and W$0.99. The price is the market's current estimate of the chance that range wins: W$0.40 means about 40%.",
      "Prices move when people trade and when the video's likes change.",
      "When the market settles, each share of the winning range pays W$1.00. Shares of every other range pay W$0.",
      "You can sell your shares at the current price any time before trading closes.",
    ],
  },
  {
    id: "timing",
    title: "When trading closes and when it settles",
    points: [
      "Trading closes 1 minute before the 24-hour mark.",
      "At the 24-hour mark we record the video's like count from the data source shown on the market page.",
      "A Wesify reviewer checks that number before the market settles. Settlement usually follows within a few hours, and winnings are paid automatically when it does.",
    ],
  },
  {
    id: "boundaries",
    title: "Ties, boundaries and rounding",
    points: [
      "A like count exactly on a boundary belongs to the higher range. For example, exactly 50,000 likes wins \"50K–100K\", not \"25K–50K\".",
      "Balances are kept to the cent (W$0.01). Payouts and sale proceeds are rounded down to the cent; refunds are rounded to the nearest cent.",
      "Shares are shown to two decimals but kept at full precision.",
    ],
  },
  {
    id: "problems",
    title: "When something goes wrong",
    points: [
      "If a video is deleted or made private, trading pauses right away. If it isn't back within 1 hour, the market is cancelled.",
      "If like counts stop arriving, trading pauses until fresh data comes in. If we can't get a reliable final count within 12 hours of the settlement time, the market is cancelled.",
      "If like counts disappear or drop in a way that looks like a data error, those readings are ignored for pricing and a reviewer checks them.",
      "If a market was set up with wrong information (wrong video, wrong times), it is cancelled.",
      "If we suspect the likes or the trading were manipulated, trading pauses while we review. If manipulation is confirmed, the market is cancelled.",
    ],
  },
  {
    id: "cancellation",
    title: "Cancellations and refunds",
    points: [
      "When a market is cancelled, every open position is refunded at what you paid for the shares you still hold.",
      "Shares you already sold stay sold: the sale price you got is final.",
      "The market page explains why it was cancelled, and everyone with a position gets a notification.",
    ],
  },
  {
    id: "credits",
    title: "Wesify Credits (W$)",
    points: [
      "W$ is play money. It has no monetary value, can't be bought, redeemed, withdrawn or transferred, and can't be exchanged for prizes.",
      "Creators can't trade in markets about their own videos.",
    ],
  },
];

export const CANCEL_REASONS: Record<CancelReason, { label: string; explanation: string }> = {
  DELETED_CONTENT: { label: "Video deleted", explanation: "The video was deleted, so its final like count can't be measured." },
  PRIVATE_CONTENT: { label: "Video made private", explanation: "The video was made private, so its final like count can't be measured." },
  PLATFORM_OUTAGE: { label: "Platform data unavailable", explanation: "We couldn't get a reliable like count from the platform in time to settle." },
  METRIC_CORRUPTION: { label: "Unreliable like data", explanation: "The like counts we received were inconsistent, so the result couldn't be trusted." },
  MANIPULATION: { label: "Manipulation", explanation: "We found signs that the likes or the trading on this market were manipulated." },
  INCORRECT_SETUP: { label: "Set up incorrectly", explanation: "This market was created with incorrect information." },
  CONTENT_REMOVED: { label: "Content removed", explanation: "This video was removed from Wesify at the request of its creator or for breaking our content rules." },
  ADMIN: { label: "Cancelled by Wesify", explanation: "Wesify cancelled this market." },
};

/** Short plain-English definition shown on every market page (§7 "Settlement definition"). */
export function settlementDefinition(platformName: string): string {
  return `Resolves to the range containing the video's ${platformName} like count 24 hours after the market opened, as recorded by Wesify and confirmed by a reviewer.`;
}
