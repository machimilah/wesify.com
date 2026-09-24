import { Errors } from "../world/errors";

/**
 * Basic bot protection for sign-up, login and contact forms (checklist §4, §28):
 *  - a hidden "website" field humans never fill (honeypot),
 *  - a minimum time between rendering the form and submitting it,
 *  - Cloudflare Turnstile when TURNSTILE_SECRET_KEY is set (CAPTCHA where necessary).
 */
export async function assertHuman(input: { honeypot?: string | null; renderedAt?: number | null; turnstileToken?: string | null; ip?: string | null }, minMs = 1500) {
  if (input.honeypot) throw Errors.botSuspected();
  if (input.renderedAt && Date.now() - input.renderedAt < minMs) throw Errors.botSuspected();
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return;
  if (!input.turnstileToken) throw Errors.botSuspected();
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: input.turnstileToken, ...(input.ip ? { remoteip: input.ip } : {}) }),
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await res.json()) as { success?: boolean };
    if (!body.success) throw Errors.botSuspected();
  } catch (err) {
    throw err instanceof Error && "code" in err ? err : Errors.botSuspected();
  }
}
