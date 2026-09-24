import { z } from "zod";

/**
 * Environment validation (checklist §35, §43). Runs once at startup (src/instrumentation.ts).
 * Production refuses to boot with a missing secret or a half-configured integration; development
 * only warns, so the app runs with no setup at all.
 */
const optional = z.string().trim().min(1).optional();
const pair = (a: string, b: string) => (env: Record<string, unknown>) => Boolean(env[a]) === Boolean(env[b]);

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    APP_ENV: z.enum(["development", "staging", "production"]).optional(),
    APP_URL: z.string().url().optional(),
    ADMIN_TOKEN: z.string().min(24, "ADMIN_TOKEN must be at least 24 characters").optional(),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters").optional(),
    TOKEN_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "TOKEN_ENCRYPTION_KEY must be 32 bytes, base64")
      .optional(),
    CRON_SECRET: z.string().min(24).optional(),
    WESIFY_DATA_DIR: optional,
    BACKUP_DIR: optional,
    BACKUP_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "BACKUP_ENCRYPTION_KEY must be 32 bytes, base64")
      .optional(),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: optional,
    CLERK_SECRET_KEY: optional,
    RESEND_API_KEY: optional,
    EMAIL_FROM: optional,
    SUPPORT_EMAIL: z.string().email().optional(),
    SECURITY_EMAIL: z.string().email().optional(),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: optional,
    TURNSTILE_SECRET_KEY: optional,
    POSTHOG_API_KEY: optional,
    POSTHOG_HOST: z.string().url().optional(),
    ALERT_WEBHOOK_URL: z.string().url().optional(),
    TIKTOK_CLIENT_KEY: optional,
    TIKTOK_CLIENT_SECRET: optional,
    INSTAGRAM_CLIENT_ID: optional,
    INSTAGRAM_CLIENT_SECRET: optional,
    YOUTUBE_CLIENT_ID: optional,
    YOUTUBE_CLIENT_SECRET: optional,
    METRICS_PROVIDER: z.enum(["mock", "manual"]).optional(),
    MONTHLY_BUDGET_USD: z.coerce.number().positive().optional(),
  })
  .refine(pair("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"), "Set both Clerk keys or neither")
  .refine(pair("RESEND_API_KEY", "EMAIL_FROM"), "Set RESEND_API_KEY and EMAIL_FROM together")
  .refine(pair("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"), "Set both Turnstile keys or neither")
  .refine(pair("TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"), "Set both TikTok credentials or neither")
  .refine(pair("INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"), "Set both Instagram credentials or neither")
  .refine(pair("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"), "Set both YouTube credentials or neither");

/** Required only in production. */
const PRODUCTION_REQUIRED = ["APP_URL", "ADMIN_TOKEN", "SESSION_SECRET", "TOKEN_ENCRYPTION_KEY", "CRON_SECRET", "SUPPORT_EMAIL"] as const;

export type EnvReport = { ok: boolean; errors: string[]; warnings: string[] };

export function validateEnv(env: Record<string, string | undefined> = process.env): EnvReport {
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = schema.safeParse(clean);
  const errors = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`);
  const warnings: string[] = [];
  const prod = env.NODE_ENV === "production" && env.APP_ENV !== "development";
  for (const key of PRODUCTION_REQUIRED) {
    if (!clean[key]) (prod ? errors : warnings).push(`${key} is not set${prod ? "" : " (required in production)"}`);
  }
  if (prod && !clean.RESEND_API_KEY) warnings.push("RESEND_API_KEY is not set: verification and reset emails are only logged");
  if (prod && !clean.ALERT_WEBHOOK_URL) warnings.push("ALERT_WEBHOOK_URL is not set: alerts only appear in /admin");
  if (prod && !clean.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) warnings.push("Clerk is not configured: using the built-in email/password login");
  return { ok: errors.length === 0, errors, warnings };
}

export const appEnv = (): "development" | "staging" | "production" =>
  (process.env.APP_ENV as "development" | "staging" | "production") ?? (process.env.NODE_ENV === "production" ? "production" : "development");

export const isProductionEnv = () => appEnv() === "production";
