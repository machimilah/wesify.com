import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Loads `.env.local` before anything reads configuration.
 *
 * Imported for its side effect and imported first, because `db.mjs` decides whether BO has accounts
 * at all by looking at `DATABASE_URL`. A loader that runs after that check would leave the server
 * announcing it has no database while holding a perfectly good connection string.
 *
 * Nothing here overwrites a variable that is already set, so a real deployment's environment always
 * wins over a file someone left in the working copy.
 */

const root = process.cwd()

for (const name of ['.env.local', '.env']) {
  const file = path.join(root, name)
  if (!existsSync(file)) continue
  try {
    // Node's own parser, so there is no dotenv-shaped dependency and no second dialect to explain.
    process.loadEnvFile(file)
  } catch (error) {
    console.warn(`BO could not read ${name}: ${error?.message ?? error}`)
  }
}

// An empty value in a file means "not configured", not "configured as nothing". Without this, a
// blank ANTHROPIC_API_KEY line reads as a key and BO tries to run the interview on the server.
for (const [name, value] of Object.entries(process.env)) {
  if (value === '') delete process.env[name]
}
