import { describe, expect, it } from "vitest";
import { CREATOR_CONTRACT_VERSION, CREATOR_REAPPLY_COOLDOWN_MS, creatorLikeThreshold } from "@/lib/shared/constants";
import { decryptToken, encryptToken } from "@/server/crypto";
import {
  completeConnect,
  creatorLimit,
  disconnectAccount,
  openCreatorMarket,
  simulateUpload,
  startConnect,
  syncAccount,
} from "@/server/world/creators";
import type { Ctx } from "@/server/world/context";
import { applyToProgram, programState, reviewApplication, signContract } from "@/server/world/creatorProgram";
import { approveSubmission, createMarketFromUrl } from "@/server/world/ingestion";
import { buy, isOwnMarket } from "@/server/world/trading";
import { createUser } from "@/server/world/users";
import { HOUR, testWorld } from "../helpers";

const REDIRECT = "http://localhost:3100/api/social/tiktok/callback";

/** Runs the invite-only path: apply → admin approves → sign the agreement. */
function admitted(ctx: Ctx, username: string) {
  const user = createUser(ctx, { username });
  const app = applyToProgram(ctx, user.id, {
    platform: "TikTok",
    handle: username,
    profileUrl: `https://www.tiktok.com/@${username}`,
    followerCount: 50_000,
    about: "I post skate clips most days and usually land a few thousand likes.",
  });
  reviewApplication(ctx, { applicationId: app.id, action: "approve", actor: "admin" });
  signContract(ctx, user.id, { fullName: "Real Name", version: CREATOR_CONTRACT_VERSION });
  return user;
}

async function connected(t = testWorld(), username = "creator1") {
  const user = admitted(t.ctx, username);
  const { url } = startConnect(t.ctx, user.id, "tiktok", REDIRECT);
  const state = new URL(url).searchParams.get("state")!;
  const account = await completeConnect(t.ctx, { state, code: "simulated", redirectUri: REDIRECT, wesifyUserId: user.id });
  account.followerCount = 50_000; // deterministic threshold: 500 likes
  return { ...t, user, account, state };
}

describe("token encryption", () => {
  it("round-trips and rejects tampering", () => {
    const sealed = encryptToken("secret-access-token");
    expect(sealed).not.toContain("secret");
    expect(decryptToken(sealed)).toBe("secret-access-token");
    const [iv, tag, body] = sealed.split(".");
    const flipped = body.slice(0, -2) + (body.endsWith("A") ? "B" : "A") + body.slice(-1);
    expect(() => decryptToken([iv, tag, flipped].join("."))).toThrow();
  });
});

describe("creator program", () => {
  const application = {
    platform: "YouTube Shorts", // free text: any platform can apply
    handle: "hopeful",
    profileUrl: "https://www.tiktok.com/@hopeful",
    followerCount: 24_000,
    about: "Daily cooking shorts, usually 3-8K likes each.",
  };

  it("lets anyone connect an account, but keeps opening markets closed until approved and signed", async () => {
    const { ctx } = testWorld();
    const user = createUser(ctx, { username: "outsider" });
    expect(programState(ctx, user.id)).toBe("none");
    // Connecting from the profile is open to everyone (it powers the self-trading ban).
    const { url } = startConnect(ctx, user.id, "tiktok", REDIRECT);
    const account = await completeConnect(ctx, { state: new URL(url).searchParams.get("state")!, code: "simulated", redirectUri: REDIRECT, wesifyUserId: user.id });
    account.followerCount = 50_000;
    const cv = simulateUpload(ctx, user.id, account.id);
    await syncAccount(ctx, account.id);
    // Not a creator yet: the upload is tracked but never offered as a market.
    expect(cv.status).toBe("tracking");
    expect(() => openCreatorMarket(ctx, user.id, cv.id)).toThrow(/Apply to the creator program/);

    const app = applyToProgram(ctx, user.id, application);
    expect(programState(ctx, user.id)).toBe("pending");
    expect(() => openCreatorMarket(ctx, user.id, cv.id)).toThrow(/under review/);

    reviewApplication(ctx, { applicationId: app.id, action: "approve", actor: "admin" });
    expect(programState(ctx, user.id)).toBe("unsigned");
    expect(() => openCreatorMarket(ctx, user.id, cv.id)).toThrow(/Sign the creator agreement/);

    signContract(ctx, user.id, { fullName: "Dana Cook", version: CREATOR_CONTRACT_VERSION });
    expect(programState(ctx, user.id)).toBe("active");
    await syncAccount(ctx, account.id);
    expect(cv.status).toBe("eligible");
  });

  it("notifies the applicant of the decision and keeps the reason", () => {
    const { ctx } = testWorld();
    const user = createUser(ctx, { username: "rejected_one" });
    const app = applyToProgram(ctx, user.id, application);
    reviewApplication(ctx, { applicationId: app.id, action: "reject", note: "Not enough recent posts.", actor: "admin" });
    expect(programState(ctx, user.id)).toBe("rejected");
    const note = ctx.state.notifications.filter((n) => n.userId === user.id && n.kind === "CREATOR_DECISION");
    expect(note).toHaveLength(1);
    expect(note[0].body).toContain("Not enough recent posts.");
  });

  it("holds a rejected applicant to the cooldown, then lets them reapply", () => {
    const t = testWorld();
    const user = createUser(t.ctx, { username: "patient" });
    const app = applyToProgram(t.ctx, user.id, application);
    reviewApplication(t.ctx, { applicationId: app.id, action: "reject", actor: "admin" });
    expect(() => applyToProgram(t.ctx, user.id, application)).toThrow(/apply again in/);
    t.advance(CREATOR_REAPPLY_COOLDOWN_MS + 1000);
    expect(() => applyToProgram(t.ctx, user.id, application)).not.toThrow();
    expect(programState(t.ctx, user.id)).toBe("pending");
  });

  it("only one application is under review at a time, and signing needs approval", () => {
    const { ctx } = testWorld();
    const user = createUser(ctx, { username: "eager" });
    applyToProgram(ctx, user.id, application);
    expect(() => applyToProgram(ctx, user.id, application)).toThrow(/already under review/);
    expect(() => signContract(ctx, user.id, { fullName: "Eager One", version: CREATOR_CONTRACT_VERSION })).toThrow(/approved creators/);
  });

  it("revoking a creator stops new markets and clears their signature", async () => {
    const { ctx } = testWorld();
    const user = admitted(ctx, "revoked_one");
    const app = Object.values(ctx.state.creatorApplications).find((a) => a.userId === user.id)!;
    reviewApplication(ctx, { applicationId: app.id, action: "revoke", note: "Bought likes.", actor: "admin" });
    expect(programState(ctx, user.id)).toBe("revoked");
    expect(app.contractSignedAt).toBeNull();
    expect(() => openCreatorMarket(ctx, user.id, "any")).toThrow(/removed/);
  });
});

describe("eligibility threshold", () => {
  it("is 1% of followers with a 100-like floor", () => {
    expect(creatorLikeThreshold(50_000)).toBe(500);
    expect(creatorLikeThreshold(100_000)).toBe(1_000);
    expect(creatorLikeThreshold(5_000)).toBe(100);
  });
});

describe("connecting an account", () => {
  it("uses the simulated flow without API keys and creates an active account", async () => {
    const { ctx, account, user } = await connected();
    expect(account.mode).toBe("simulated");
    expect(account.status).toBe("active");
    expect(account.userId).toBe(user.id);
    expect(account.accessTokenEncrypted).toBeNull();
    expect(ctx.state.auditLogs.some((a) => a.action === "creator.connect")).toBe(true);
  });

  it("OAuth state is single use and bound to the user who started it", async () => {
    const { ctx, user, state } = await connected();
    await expect(completeConnect(ctx, { state, code: "simulated", redirectUri: REDIRECT, wesifyUserId: user.id })).rejects.toThrow(/expired/);

    const other = admitted(ctx, "someone_else");
    const { url } = startConnect(ctx, other.id, "instagram", REDIRECT);
    const s2 = new URL(url).searchParams.get("state")!;
    await expect(completeConnect(ctx, { state: s2, code: "simulated", redirectUri: REDIRECT, wesifyUserId: user.id })).rejects.toThrow(/Not allowed/);
  });

  it("refuses a second account on the same platform", async () => {
    const { ctx, user } = await connected();
    expect(() => startConnect(ctx, user.id, "tiktok", REDIRECT)).toThrow(/already connected/);
    expect(() => startConnect(ctx, user.id, "instagram", REDIRECT)).not.toThrow();
  });
});

describe("detecting uploads and eligibility", () => {
  it("marks a video eligible once likes reach 1% of followers, and notifies the creator", async () => {
    const { ctx, user, account } = await connected();
    const cv = simulateUpload(ctx, user.id, account.id);
    await syncAccount(ctx, account.id);
    expect(cv.likes).toBeGreaterThanOrEqual(500);
    expect(cv.status).toBe("eligible");
    const note = ctx.state.notifications.find((n) => n.userId === user.id && n.kind === "CREATOR_ELIGIBLE");
    expect(note).toBeDefined();
  });

  it("never qualifies accounts under 1,000 followers", async () => {
    const { ctx, user, account } = await connected();
    account.followerCount = 800;
    const cv = simulateUpload(ctx, user.id, account.id);
    cv.threshold = 100;
    await syncAccount(ctx, account.id);
    expect(cv.likes).toBeGreaterThanOrEqual(100);
    expect(cv.status).toBe("tracking");
  });

  it("expires videos that pass the 6-hour window", async () => {
    const { ctx, user, account, advance } = await connected();
    const cv = simulateUpload(ctx, user.id, account.id);
    await syncAccount(ctx, account.id);
    advance(6 * HOUR);
    await syncAccount(ctx, account.id);
    expect(cv.status).toBe("expired");
    expect(() => openCreatorMarket(ctx, user.id, cv.id)).toThrow(/6-hour/);
  });
});

describe("opening a market", () => {
  it("opens a creator market from an eligible video", async () => {
    const { ctx, user, account } = await connected();
    const cv = simulateUpload(ctx, user.id, account.id);
    await syncAccount(ctx, account.id);
    const { marketId, created } = openCreatorMarket(ctx, user.id, cv.id);
    const market = ctx.state.markets[marketId];
    const video = ctx.state.videos[market.videoId];
    expect(created).toBe(true);
    expect(market.status).toBe("OPEN");
    expect(market.creatorUserId).toBe(user.id);
    expect(video.provider).toBe("creator");
    expect(video.socialAccountId).toBe(account.id);
    expect(cv.status).toBe("market_created");
    expect(ctx.state.snapshots[video.id].length).toBeGreaterThan(1);
  });

  it("rejects videos that aren't eligible yet, or belong to someone else", async () => {
    const { ctx, user, account } = await connected();
    const cv = simulateUpload(ctx, user.id, account.id); // not synced yet → still tracking
    expect(() => openCreatorMarket(ctx, user.id, cv.id)).toThrow(/1% of your followers/);
    const stranger = admitted(ctx, "stranger"); // in the program, but not this video's creator
    expect(() => openCreatorMarket(ctx, stranger.id, cv.id)).toThrow(/not found/);
  });

  it("allows one market per rolling 24 hours across all accounts", async () => {
    const { ctx, user, account, advance } = await connected();
    const first = simulateUpload(ctx, user.id, account.id);
    await syncAccount(ctx, account.id);
    openCreatorMarket(ctx, user.id, first.id);

    advance(2 * HOUR);
    const second = simulateUpload(ctx, user.id, account.id);
    await syncAccount(ctx, account.id);
    expect(second.status).toBe("eligible");
    expect(() => openCreatorMarket(ctx, user.id, second.id)).toThrow(/every 24 hours/);
    expect(creatorLimit(ctx, user.id).remaining).toBe(0);

    advance(22 * HOUR + 60_000);
    expect(creatorLimit(ctx, user.id).remaining).toBe(1);
    const third = simulateUpload(ctx, user.id, account.id);
    await syncAccount(ctx, account.id);
    expect(() => openCreatorMarket(ctx, user.id, third.id)).not.toThrow();
  });

  it("stops creators trading their own market", async () => {
    const { ctx, user, account } = await connected();
    const cv = simulateUpload(ctx, user.id, account.id);
    await syncAccount(ctx, account.id);
    const { marketId } = openCreatorMarket(ctx, user.id, cv.id);
    const outcomeId = ctx.state.outcomes[marketId][0].id;
    expect(() => buy(ctx, { userId: user.id, marketId, outcomeId, credits: 10 })).toThrow(/own videos/);
    const fan = createUser(ctx, { username: "a_fan" });
    expect(() => buy(ctx, { userId: fan.id, marketId, outcomeId, credits: 10 })).not.toThrow();
  });

  it("stops whoever created a market from a pasted link betting on it", async () => {
    const { ctx } = testWorld();
    const maker = createUser(ctx, { username: "link_maker" });
    const publishedSec = BigInt(Math.floor((ctx.now() - HOUR / 2) / 1000));
    const url = `https://www.tiktok.com/@someone_else/video/${(publishedSec << 32n).toString()}`;
    const { marketId, status } = await createMarketFromUrl(ctx, url, maker.id);
    // Submissions wait for an admin before trading opens.
    expect(status).toBe("DRAFT");
    approveSubmission(ctx, marketId, { actor: "admin" });
    expect(ctx.state.markets[marketId].status).toBe("OPEN");
    expect(ctx.state.markets[marketId].createdByUserId).toBe(maker.id);
    expect(isOwnMarket(ctx, maker.id, marketId)).toBe(true);
    const outcomeId = ctx.state.outcomes[marketId][0].id;
    expect(() => buy(ctx, { userId: maker.id, marketId, outcomeId, credits: 10 })).toThrow(/market you created/);
    const fan = createUser(ctx, { username: "b_fan" });
    expect(isOwnMarket(ctx, fan.id, marketId)).toBe(false);
    expect(() => buy(ctx, { userId: fan.id, marketId, outcomeId, credits: 10 })).not.toThrow();
  });

  it("prices creator markets from the account's likes as the world ticks", async () => {
    const { ctx, world, user, account, advance } = await connected();
    const cv = simulateUpload(ctx, user.id, account.id);
    await syncAccount(ctx, account.id);
    const { marketId } = openCreatorMarket(ctx, user.id, cv.id);
    const market = ctx.state.markets[marketId];
    const before = ctx.state.snapshots[market.videoId].length;
    advance(2 * HOUR);
    await world.tick();
    expect(ctx.state.snapshots[market.videoId].length).toBeGreaterThanOrEqual(before + 20);
    expect(market.status).toBe("OPEN");

    advance(23 * HOUR);
    await world.tick();
    expect(market.status).toBe("SETTLED");
  });
});

describe("disconnecting", () => {
  it("is blocked while a market from the account is running, and clears tokens afterwards", async () => {
    const { ctx, world, user, account, advance } = await connected();
    const cv = simulateUpload(ctx, user.id, account.id);
    await syncAccount(ctx, account.id);
    openCreatorMarket(ctx, user.id, cv.id);
    expect(() => disconnectAccount(ctx, user.id, account.id)).toThrow(/still running/);

    advance(25 * HOUR);
    await world.tick();
    disconnectAccount(ctx, user.id, account.id);
    expect(account.status).toBe("revoked");
    expect(account.accessTokenEncrypted).toBeNull();
  });
});
