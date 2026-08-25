import path from 'node:path'
import { databaseAvailable } from './db.mjs'

/**
 * Whether anything BO writes will still be there tomorrow.
 *
 * BO has always had a disk fallback: with no `DATABASE_URL`, records, interviews and builds are JSON
 * files under `BO_GENERATED_ROOT`. On a laptop that is the whole point — the prototype runs with no
 * infrastructure at all. On a serverless platform it is a trap. The filesystem is read-only apart
 * from `/tmp`, `/tmp` belongs to one instance, and that instance is discarded when it goes cold. So
 * an operator can answer twelve questions, watch a Command Center get built, type real records into
 * it, and find all of it gone — with nothing having failed, and no error anywhere to explain it.
 *
 * Silence is the problem worth fixing. BO cannot refuse to run: a deployment mid-configuration is a
 * normal state and taking the product away would be worse than the risk. What it can do is say so,
 * in the logs at cold start and in the health endpoint, so nobody ships this state without knowing.
 */

/** A filesystem that does not outlive the process writing to it. */
export function ephemeralStorage() {
  // The platforms name themselves. `/tmp` is the giveaway everywhere else: nothing durable lives there.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.FUNCTIONS_WORKER_RUNTIME) return true
  const root = process.env.BO_GENERATED_ROOT
  return Boolean(root && path.resolve(root).replace(/\\/g, '/').toLowerCase().startsWith('/tmp'))
}

/**
 * What is true about this deployment that somebody would want to know before trusting it.
 *
 * Returned by `/api/health` and printed once at start. Empty is the normal answer: a laptop, a
 * container with a volume, or any deployment that has a database.
 */
export function durabilityWarnings() {
  if (!ephemeralStorage() || databaseAvailable()) return []
  return [{
    id: 'ephemeral-storage',
    message: 'This deployment stores workspaces on a filesystem that does not survive between requests, and has no DATABASE_URL. Interviews, Command Centers and every record typed into them will be lost without warning. Set DATABASE_URL to a Postgres connection string — and run supabase/schema.sql once first, because migrations do not run on this platform.',
  }]
}
