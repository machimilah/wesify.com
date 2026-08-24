/**
 * A test must never spend the operator's money.
 *
 * BO's suites spawn or import the real server, and the server decides whether to use a frontier model
 * by asking whether a key is configured. Once a real `ANTHROPIC_API_KEY` sat in `.env.local`, every
 * browser suite that reached the build screen made a real research call — Opus, adaptive thinking,
 * five web searches and three fetches, which is the most expensive thing BO does. Nothing failed.
 * Nothing looked different. The bill was the only signal, and it arrived after the fact.
 *
 * Importing this first removes the key from the environment the test and its child processes see, so
 * the frontier path reports itself unavailable and BO falls back to the local one — which is what
 * these suites were always testing. A suite that is genuinely about the frontier path sets
 * `ANTHROPIC_BASE_URL` to its own stub instead and never imports this.
 *
 * `structure.test.mjs` checks that every suite does one or the other.
 */

/**
 * Set to empty rather than deleted, which is the whole trick.
 *
 * Deleting is not enough: `server/env.mjs` loads `.env.local` from disk in every process, including
 * a spawned child, so a deleted key comes straight back from the file. An empty value survives that
 * load — `process.loadEnvFile` does not overwrite a variable that is already set — and env.mjs then
 * removes it, because an empty value in a file means "not configured" rather than "configured as
 * nothing". The key is gone by the time anything asks whether a frontier model is available.
 */
process.env.ANTHROPIC_API_KEY = ''
process.env.ANTHROPIC_AUTH_TOKEN = ''

/**
 * The free tier is blanked too.
 *
 * Free is not the same as harmless: a Gemini key in `.env.local` would have every browser suite that
 * reaches the build screen run real interview turns, burn the developer's daily quota, and — worse —
 * quietly test a live model instead of the fallback the suite is there to check.
 */
process.env.GEMINI_API_KEY = ''
process.env.GOOGLE_API_KEY = ''
