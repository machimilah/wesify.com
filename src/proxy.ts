import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Next 16 proxy (formerly middleware). When Clerk is configured it runs Clerk's middleware so route
 * handlers can read the signed-in user; without Clerk keys it's a pass-through and the built-in
 * session cookie is used instead (decision: Clerk + local fallback).
 */
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
const clerk = clerkEnabled ? clerkMiddleware() : null;

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  if (clerk) return clerk(req, event);
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except static files and Next internals (Clerk's recommended matcher).
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
