/**
 * A test must never touch the real infrastructure.
 *
 * `noSpend.mjs` is about money: a model key in `.env.local` turns a suite into a bill. This is the
 * other hazard, and the worse one — a suite that reaches the live Supabase project is writing into
 * the place customers' work lives. The two are separate files because a suite can legitimately want
 * one and not the other: the research suites point a provider at their own stub rather than blanking
 * its key, and still have no business opening the production database.
 *
 * A suite that wants a database says so explicitly, with `useDatabase(...)` and pg-mem. That sets the
 * pool directly, so blanking the variable here takes nothing from it — `databaseAvailable()` asks for
 * either — while a suite that never mentions one gets the file-backed prototype path it was written
 * against.
 *
 * Set to empty rather than deleted, which is the whole trick: `server/env.mjs` loads `.env.local` in
 * every process including a spawned child, so a deleted variable comes straight back from the file.
 * An empty value survives that load — `process.loadEnvFile` does not overwrite what is already set —
 * and env.mjs then drops it, because empty in a file means "not configured".
 */

process.env.DATABASE_URL = ''

/**
 * Clerk goes with it, both halves.
 *
 * The secret key, because with a database and no way to verify a token the server falls back to
 * trust-on-first-use, which is not the mode any of these suites mean to exercise; `clerkStub.mjs` is
 * how a suite asks for accounts.
 *
 * The publishable key for a different reason: with it set, the browser suites mount the real Clerk
 * provider, which loads Clerk's script from Clerk's servers and renders their widget — so the suite
 * would depend on a network, on Clerk being up, and on whatever they shipped that morning.
 */
process.env.CLERK_SECRET_KEY = ''
process.env.VITE_CLERK_PUBLISHABLE_KEY = ''

/**
 * And the flag that actually stops the browser loading Clerk.
 *
 * Blanking the variable above is not enough on its own: Vite reads `.env.local` from disk itself,
 * whatever this process says, so the page under test would still be handed the developer's key —
 * mount Clerk, be told by it that nobody is signed in, and discard the session the suite had just
 * given it. vite.config.ts watches for this flag and defines the key as empty, which beats the file.
 */
process.env.BO_DISABLE_CLERK = '1'
