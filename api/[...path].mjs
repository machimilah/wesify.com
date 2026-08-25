/**
 * BO's API, as a Vercel function.
 *
 * Without this file Vercel serves only `dist`: it detects Vite, runs the build, and never starts
 * `server/index.mjs`. Every key set on that deployment then belongs to a process that does not exist,
 * and every `/api` call lands on the CDN and comes back as the index page — which reads, from the
 * outside, exactly like a deployment ignoring its environment variables.
 *
 * A catch-all rather than a file per route, because BO already has a router: `handleRequest` takes
 * the same `(request, response)` pair Node's http server does, and Vercel hands a Node function that
 * same pair. So this is an adapter, not a second server, and there is no copy of the routing table
 * to drift out of step with the real one.
 *
 * Two things differ on this platform and are set below rather than left to be discovered:
 *
 * - The filesystem is read-only apart from `/tmp`, and `/tmp` does not survive between invocations.
 *   BO writes generated Command Centers there, so `DATABASE_URL` stops being optional here: records,
 *   the interview and the build description all live in Postgres, and the disk holds only the
 *   regenerable output of the build that is running right now.
 * - Each invocation is its own process. Anything BO keeps in memory — rate-limit counters, the note
 *   that a model is out of quota — starts empty rather than being shared, which costs a repeated
 *   discovery, never correctness.
 */

// Before any module reads configuration: on a read-only filesystem the default path cannot be used,
// and a module that resolves it at import time would have already chosen wrong.
process.env.BO_GENERATED_ROOT ||= '/tmp/bo-generated'

const { handleRequest } = await import('../server/index.mjs')

export default async function handler(request, response) {
  return handleRequest(request, response)
}
