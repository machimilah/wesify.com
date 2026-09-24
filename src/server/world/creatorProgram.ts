import { CREATOR_CONTRACT_TERMS, CREATOR_CONTRACT_VERSION, CREATOR_REAPPLY_COOLDOWN_MS } from "@/lib/shared/constants";
import { duration } from "@/lib/shared/format";
import { newId } from "@/lib/shared/random";
import type { CreatorProgramDTO } from "@/lib/shared/dto";
import type { CreatorApplicationRow } from "@/lib/shared/types";
import { audit, notify, track, type Ctx } from "./context";
import { Errors, WesifyError } from "./errors";

/**
 * Creator program (§51): opening markets is invite-only. A user applies, an admin approves or
 * rejects, and an approved creator signs the current agreement before connecting an account or
 * opening a market. Approval can be revoked later, which stops both.
 */

export type ProgramState = "none" | "pending" | "rejected" | "unsigned" | "active" | "revoked";

/** Applications table, created on first use so a state loaded before this feature still works. */
export function applications(ctx: Ctx): Record<string, CreatorApplicationRow> {
  return (ctx.state.creatorApplications ??= {});
}

/** The row that decides what a user can do now: their newest application. */
export function latestApplication(ctx: Ctx, userId: string): CreatorApplicationRow | null {
  return (
    Object.values(applications(ctx))
      .filter((a) => a.userId === userId)
      .sort((a, b) => b.submittedAt - a.submittedAt)[0] ?? null
  );
}

export function programState(ctx: Ctx, userId: string): ProgramState {
  const app = latestApplication(ctx, userId);
  if (!app) return "none";
  if (app.status === "pending") return "pending";
  if (app.status === "rejected") return "rejected";
  if (app.status === "revoked") return "revoked";
  return app.contractVersion === CREATOR_CONTRACT_VERSION && app.contractSignedAt ? "active" : "unsigned";
}

/** Throws unless the user is an approved creator who has signed the current agreement. */
export function assertActiveCreator(ctx: Ctx, userId: string) {
  const state = programState(ctx, userId);
  if (state === "active") return;
  const message = {
    none: "Apply to the creator program to open markets on your videos.",
    pending: "Your creator application is still under review.",
    rejected: "Your creator application was not approved.",
    revoked: "Your place in the creator program was removed.",
    unsigned: "Sign the creator agreement to continue.",
  }[state];
  throw new WesifyError("CREATOR_NOT_APPROVED", message, 403);
}

export function applyToProgram(
  ctx: Ctx,
  userId: string,
  input: { platform: string; handle: string; profileUrl: string; followerCount: number; about: string },
) {
  const now = ctx.now();
  const previous = latestApplication(ctx, userId);
  if (previous) {
    if (previous.status === "pending") throw Errors.invalid("Your application is already under review.");
    if (previous.status === "approved") throw Errors.invalid("You're already in the creator program.");
    if (previous.status === "revoked") throw Errors.forbidden();
    const waitUntil = (previous.decidedAt ?? previous.submittedAt) + CREATOR_REAPPLY_COOLDOWN_MS;
    if (now < waitUntil) throw Errors.invalid(`You can apply again in ${duration(waitUntil - now)}.`);
  }

  const application: CreatorApplicationRow = {
    id: newId("app"),
    userId,
    status: "pending",
    platform: input.platform.trim(),
    handle: input.handle.replace(/^@/, "").trim(),
    profileUrl: input.profileUrl.trim(),
    followerCount: Math.max(0, Math.floor(input.followerCount)),
    about: input.about.trim(),
    submittedAt: now,
    decidedAt: null,
    decisionNote: null,
    decidedBy: null,
    contractVersion: null,
    contractSignedAt: null,
    contractSignedName: null,
  };
  applications(ctx)[application.id] = application;
  audit(ctx, { actor: userId, action: "creator.apply", entityType: "creator_application", entityId: application.id, metadata: { platform: application.platform, handle: application.handle } });
  track(ctx, "creator_applied", userId, { platform: application.platform });
  return application;
}

/** Admin decision. `note` is shown to the applicant. */
export function reviewApplication(
  ctx: Ctx,
  input: { applicationId: string; action: "approve" | "reject" | "revoke"; note?: string; actor: string },
) {
  const app = applications(ctx)[input.applicationId];
  if (!app) throw Errors.notFound("Application");
  if (input.action === "revoke" && app.status !== "approved") throw Errors.invalid("Only an approved creator can be removed.");
  if (input.action !== "revoke" && app.status !== "pending") throw Errors.invalid("This application was already reviewed.");

  const now = ctx.now();
  app.status = input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "revoked";
  app.decidedAt = now;
  app.decidedBy = input.actor;
  app.decisionNote = input.note?.trim() || null;
  if (input.action !== "approve") {
    // A removed or rejected creator signs again if they are ever approved later.
    app.contractVersion = null;
    app.contractSignedAt = null;
    app.contractSignedName = null;
  }

  notify(ctx, {
    userId: app.userId,
    kind: "CREATOR_DECISION",
    title:
      input.action === "approve"
        ? "You're in the creator program."
        : input.action === "reject"
          ? "Your creator application wasn't approved."
          : "You were removed from the creator program.",
    body:
      input.action === "approve"
        ? "Sign the creator agreement to start opening markets."
        : app.decisionNote ?? (input.action === "reject" ? "You can apply again later." : "Contact us if you think this is a mistake."),
    marketId: null,
  });
  audit(ctx, { actor: input.actor, action: `creator.${input.action}`, entityType: "creator_application", entityId: app.id, metadata: { userId: app.userId, note: app.decisionNote } });
  track(ctx, "creator_reviewed", app.userId, { action: input.action });
  return app;
}

export function signContract(ctx: Ctx, userId: string, input: { fullName: string; version: string }) {
  const app = latestApplication(ctx, userId);
  if (!app || app.status !== "approved") throw new WesifyError("CREATOR_NOT_APPROVED", "Only approved creators can sign the agreement.", 403);
  if (input.version !== CREATOR_CONTRACT_VERSION) throw Errors.invalid("The agreement changed. Reload the page and read it again.");
  const name = input.fullName.trim();
  if (name.length < 2) throw Errors.invalid("Type your full name to sign.");

  app.contractVersion = CREATOR_CONTRACT_VERSION;
  app.contractSignedAt = ctx.now();
  app.contractSignedName = name;
  audit(ctx, { actor: userId, action: "creator.sign_contract", entityType: "creator_application", entityId: app.id, metadata: { version: CREATOR_CONTRACT_VERSION, name } });
  track(ctx, "creator_contract_signed", userId, { version: CREATOR_CONTRACT_VERSION });
  return app;
}

export function programDTO(ctx: Ctx, userId: string): CreatorProgramDTO {
  const app = latestApplication(ctx, userId);
  const state = programState(ctx, userId);
  return {
    state,
    canApplyAt:
      state === "rejected" && app ? (app.decidedAt ?? app.submittedAt) + CREATOR_REAPPLY_COOLDOWN_MS : null,
    application: app
      ? {
          id: app.id,
          platform: app.platform,
          handle: app.handle,
          followerCount: app.followerCount,
          submittedAt: app.submittedAt,
          decidedAt: app.decidedAt,
          decisionNote: app.decisionNote,
        }
      : null,
    contract: {
      version: CREATOR_CONTRACT_VERSION,
      terms: [...CREATOR_CONTRACT_TERMS],
      signedAt: app?.contractSignedAt ?? null,
      signedName: app?.contractSignedName ?? null,
      signedVersion: app?.contractVersion ?? null,
    },
  };
}

/** Admin queue: newest first, pending first. */
export function listApplications(ctx: Ctx) {
  const rank = { pending: 0, approved: 1, revoked: 2, rejected: 3 };
  return Object.values(applications(ctx))
    .sort((a, b) => rank[a.status] - rank[b.status] || b.submittedAt - a.submittedAt)
    .slice(0, 100)
    .map((a) => ({
      id: a.id,
      userId: a.userId,
      username: ctx.state.users[a.userId]?.username ?? "(deleted)",
      status: a.status,
      platform: a.platform,
      handle: a.handle,
      profileUrl: a.profileUrl,
      followerCount: a.followerCount,
      about: a.about,
      submittedAt: a.submittedAt,
      decidedAt: a.decidedAt,
      decisionNote: a.decisionNote,
      contractSignedAt: a.contractSignedAt,
      contractVersion: a.contractVersion,
    }));
}
