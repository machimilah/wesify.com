import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import path from 'node:path'

/**
 * Credentials for the outside systems a workspace has connected.
 *
 * A stored API key is the most dangerous thing BO holds. It is not workspace data, so it is kept
 * outside the workspace directory that gets read, listed, versioned and rolled back; it is encrypted
 * at rest; and it is never returned by any endpoint, not even to the operator who set it. What the
 * interface gets back is the fact that a connection exists and when it last synced.
 *
 * Encryption uses BO_CONNECTION_SECRET. Without one set, BO refuses to store a key rather than
 * pretending a file of plaintext credentials is protected.
 */

const root = () => path.resolve(process.env.BO_GENERATED_ROOT || path.join(process.cwd(), 'generated-projects'), '.connections')
const fileFor = workspaceId => {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(String(workspaceId))) throw Object.assign(new Error('Invalid workspace id.'), { status: 400 })
  return path.join(root(), `${workspaceId.toLowerCase()}.json`)
}

function key() {
  const secret = process.env.BO_CONNECTION_SECRET
  if (!secret || secret.length < 16) {
    throw Object.assign(new Error('Connecting an app needs BO_CONNECTION_SECRET set on the server, so credentials are never stored in plain text.'), { status: 503 })
  }
  return createHash('sha256').update(secret).digest()
}

function seal(value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const sealed = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${sealed.toString('base64')}`
}

function open(value) {
  const [iv, tag, sealed] = String(value).split('.')
  if (!iv || !tag || !sealed) throw Object.assign(new Error('The stored credential is unreadable.'), { status: 500 })
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(sealed, 'base64')), decipher.final()]).toString('utf8')
}

async function readAll(workspaceId) {
  try { return JSON.parse(await readFile(fileFor(workspaceId), 'utf8')) }
  catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

async function writeAll(workspaceId, value) {
  const file = fileFor(workspaceId)
  await mkdir(path.dirname(file), { recursive: true })
  const candidate = `${file}.${randomBytes(8).toString('hex')}.next`
  await writeFile(candidate, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(candidate, file)
}

export async function saveConnection(workspaceId, providerId, { credential, mode = 'read', account = '' }) {
  const all = await readAll(workspaceId)
  all[providerId] = {
    providerId, mode, account,
    credential: seal(credential),
    connectedAt: new Date().toISOString(),
    lastSyncAt: all[providerId]?.lastSyncAt ?? '',
    lastSyncCounts: all[providerId]?.lastSyncCounts ?? null,
    lastError: '',
  }
  await writeAll(workspaceId, all)
  return publicConnection(all[providerId])
}

export async function credentialFor(workspaceId, providerId) {
  const stored = (await readAll(workspaceId))[providerId]
  if (!stored) throw Object.assign(new Error('That app is not connected.'), { status: 404 })
  return open(stored.credential)
}

export async function recordSync(workspaceId, providerId, { counts = null, error = '' }) {
  const all = await readAll(workspaceId)
  if (!all[providerId]) return null
  all[providerId] = { ...all[providerId], lastSyncAt: new Date().toISOString(), lastSyncCounts: counts, lastError: String(error).slice(0, 300) }
  await writeAll(workspaceId, all)
  return publicConnection(all[providerId])
}

export async function removeConnection(workspaceId, providerId) {
  const all = await readAll(workspaceId)
  if (!all[providerId]) return false
  delete all[providerId]
  if (Object.keys(all).length) await writeAll(workspaceId, all)
  else await unlink(fileFor(workspaceId)).catch(() => undefined)
  return true
}

/** Everything about a connection except the one field that must never leave the server. */
function publicConnection({ credential, ...rest }) {
  return { ...rest, hasCredential: Boolean(credential) }
}

export async function listConnections(workspaceId) {
  return Object.values(await readAll(workspaceId)).map(publicConnection)
}
