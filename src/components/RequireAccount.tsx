"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useApp } from "./AppProvider";
import { Skeleton } from "./ui";

export function RequireAccount({ children, title }: { children: ReactNode; title: string }) {
  const { me, meLoaded } = useApp();
  if (!meLoaded) return <Skeleton className="mt-4 h-40" />;
  if (!me) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted">Start with W$10,000 in play money.</p>
        <Link href="/welcome" className="bg-gradient-main mt-6 inline-flex min-h-12 items-center rounded-lg px-6 font-semibold">
          Create account
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
