import type { NextRequest } from "next/server";

/**
 * Clerk integration (checklist §4). Clerk is used when both keys are set; otherwise the built-in
 * email/password login in server/world/users.ts handles accounts. With Clerk on, Clerk owns
 * credentials, email verification, password reset, sessions and bot protection; Wesify keeps a local
 * profile (username, W$ ledger, terms acceptance) linked by `clerkUserId`.
 */
export function clerkEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

/** The signed-in Clerk user id for this request, or null. Requires clerkMiddleware in proxy.ts. */
export async function clerkUserId(req: NextRequest): Promise<string | null> {
  if (!clerkEnabled()) return null;
  try {
    const { getAuth } = await import("@clerk/nextjs/server");
    return getAuth(req).userId ?? null;
  } catch {
    return null;
  }
}

/** Primary email for a Clerk user (used when creating the local profile). */
export async function clerkPrimaryEmail(userId: string): Promise<{ email: string | null; verified: boolean }> {
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ?? user.emailAddresses[0];
  return { email: primary?.emailAddress?.toLowerCase() ?? null, verified: primary?.verification?.status === "verified" };
}

/** Deletes the Clerk identity when a user deletes their Wesify account. */
export async function deleteClerkUser(userId: string) {
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  await client.users.deleteUser(userId);
}

/** Signs a Clerk user out of every device (admin suspension, §43 session invalidation). */
export async function revokeClerkSessions(userId: string) {
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  const sessions = await client.sessions.getSessionList({ userId, status: "active" });
  for (const s of sessions.data) await client.sessions.revokeSession(s.id);
}
