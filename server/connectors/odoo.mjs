import { safeExternalUrl } from '../safeUrl.mjs'

/**
 * Odoo, read-only, in both directions that matter.
 *
 * Wesify does not run on top of an ERP. It reads one, rebuilds the operation it describes as a
 * workspace of its own, imports the records, and owns them from then on. Nothing here writes, and
 * that is the decision the whole design rests on: no duplicated purchase order, no corrupted ledger,
 * no live dependency on an endpoint somebody else deprecates.
 *
 * Two reads, and the first is the interesting one:
 *
 * - `introspect` asks Odoo what this company *is*. Which modules are installed, which of those hold
 *   any records at all, what fields somebody added to make it fit, what states their work moves
 *   through, who is allowed to do what. This is better evidence than an interview — a module with
 *   zero records is a module this company does not use, whatever anybody remembers about it, and no
 *   question Wesify could ask would surface that.
 * - `pull` brings the records across, using a mapping the client derived from that introspection.
 *   The mapping is not held here on purpose: what an Odoo field *means* is an architecture decision,
 *   it is made where the workspace is compiled, and a second copy of it on this side would drift.
 *
 * No SDK and no XML parser. Both dialects below speak JSON.
 */

const TIMEOUT_MS = 20_000
const PAGE = 200
const MAX_PAGES = 5
/** Enough of a large Odoo to describe the company, few enough to stay one quick crawl. */
const MAX_MODELS = 60

const allowInsecure = () => process.env.BO_CONNECTOR_ALLOW_INSECURE_URL === '1'

/**
 * The credential is JSON, because Odoo needs four things where Stripe needed one.
 *
 * The vault stores bytes and asks no questions, so the format belongs to the connector rather than
 * to `connections.mjs`. `dialect` and `uid` are filled in by `verify` so that every later call skips
 * re-authenticating.
 */
export function checkCredential(input) {
  const text = (value, max) => String(value ?? '').trim().slice(0, max)
  const baseUrl = text(input?.url, 300)
  const db = text(input?.db, 120)
  const login = text(input?.login, 200)
  const apiKey = text(input?.apiKey, 300)

  if (!baseUrl || !db || !login || !apiKey) {
    throw Object.assign(new Error('Wesify needs the address of your Odoo, its database name, your user email and an API key.'), { status: 400 })
  }
  // Refuses a private or loopback address for the same reason the webhook guard does: a server that
  // will call any URL it is given is a way to reach things only that server can reach.
  const safe = safeExternalUrl(baseUrl, { allowInsecure: allowInsecure() })
  return JSON.stringify({ baseUrl: safe.replace(/\/$/, ''), db, login, apiKey, dialect: '', uid: 0, verifiedAt: '' })
}

const open = credential => {
  try { return JSON.parse(credential) } catch { throw Object.assign(new Error('The stored Odoo connection is unreadable. Reconnect it.'), { status: 500 }) }
}

async function post(url, { headers = {}, body }) {
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    throw Object.assign(new Error(`Wesify could not reach that Odoo (${error?.message ?? 'no answer'}).`), { status: 502 })
  }
  return response
}

/**
 * One call, whichever dialect this Odoo speaks.
 *
 * The single seam. Everything above it — introspection, the import — is written once and knows
 * nothing about which endpoint answered, which is what keeps a two-dialect connector from becoming
 * two connectors.
 *
 * JSON-2 arrived in Odoo 19 and is where this is going. The legacy `/jsonrpc` path is the deployed
 * reality of 17 and 18 and is on a clock: Odoo has it scheduled for removal in 22 (autumn 2028) and
 * Online 21.1 (winter 2027). Treat it as a dated liability, not as architecture.
 */
async function call(credential, model, method, kwargs = {}) {
  const { baseUrl, db, apiKey, dialect, uid } = credential

  if (dialect === 'json2') {
    const response = await post(`${baseUrl}/json/2/${model}/${method}`, {
      headers: { authorization: `bearer ${apiKey}`, 'x-odoo-database': db },
      body: kwargs,
    })
    if (!response.ok) throw odooHttpError(response.status, await response.text().catch(() => ''))
    return response.json()
  }

  const response = await post(`${baseUrl}/jsonrpc`, {
    body: {
      jsonrpc: '2.0',
      method: 'call',
      params: { service: 'object', method: 'execute_kw', args: [db, uid, apiKey, model, method, [], kwargs] },
    },
  })
  if (!response.ok) throw odooHttpError(response.status, '')
  const payload = await response.json()
  if (payload.error) throw odooRpcError(payload.error)
  return payload.result
}

function odooHttpError(status, detail) {
  if (status === 401) return Object.assign(new Error('Odoo rejected the API key. Check it is correct and still active.'), { status: 401 })
  if (status === 403) return Object.assign(new Error('That Odoo user is not allowed to read this. Check its access rights.'), { status: 403 })
  if (status === 404) return Object.assign(new Error('That address does not look like an Odoo server.'), { status: 502 })
  return Object.assign(new Error(`Odoo returned ${status}. ${String(detail).slice(0, 200)}`.trim()), { status: 502 })
}

function odooRpcError(error) {
  const name = String(error?.data?.name ?? '')
  const message = String(error?.data?.message ?? error?.message ?? 'Odoo refused the request.').slice(0, 300)
  if (/AccessDenied/.test(name)) return Object.assign(new Error('Odoo rejected the API key. Check it is correct and still active.'), { status: 401 })
  if (/AccessError/.test(name)) return Object.assign(new Error(`That Odoo user is not allowed to read this. ${message}`), { status: 403 })
  return Object.assign(new Error(message), { status: 502 })
}

/**
 * Which dialect, and who the key belongs to — worked out once and stored.
 *
 * Detection order is deliberate: JSON-2 is tried first because it is where Odoo is going, and its
 * absence is a clean 404 rather than an error that needs interpreting.
 */
export async function verify(credentialString) {
  const credential = open(credentialString)
  const { baseUrl, db, login, apiKey } = credential

  const json2 = await post(`${baseUrl}/json/2/res.users/search_count`, {
    headers: { authorization: `bearer ${apiKey}`, 'x-odoo-database': db },
    body: { domain: [] },
  })
  if (json2.ok) {
    return {
      account: `${db} · ${new URL(baseUrl).hostname}`,
      credential: JSON.stringify({ ...credential, dialect: 'json2', uid: 0, verifiedAt: new Date().toISOString() }),
    }
  }
  if (json2.status === 401 || json2.status === 403) throw odooHttpError(json2.status, '')

  const legacy = await post(`${baseUrl}/jsonrpc`, {
    body: { jsonrpc: '2.0', method: 'call', params: { service: 'common', method: 'authenticate', args: [db, login, apiKey, {}] } },
  })
  if (!legacy.ok) throw odooHttpError(legacy.status, '')
  const payload = await legacy.json()
  if (payload.error) throw odooRpcError(payload.error)
  const uid = Number(payload.result)
  if (!Number.isInteger(uid) || uid <= 0) {
    throw Object.assign(new Error('Odoo did not accept that database, user and API key together. Check all three.'), { status: 401 })
  }
  return {
    account: `${db} · ${new URL(baseUrl).hostname}`,
    credential: JSON.stringify({ ...credential, dialect: 'rpc', uid, verifiedAt: new Date().toISOString() }),
  }
}

/**
 * The models worth asking about.
 *
 * A curated list rather than everything Odoo has, because `ir.model` on a live instance returns
 * hundreds of rows that describe Odoo rather than the company. Anything an operator or a consultant
 * added themselves is picked up separately, by its `x_` prefix.
 */
const RELEVANT_MODELS = [
  'res.partner', 'res.users', 'res.company',
  'product.product', 'product.template',
  'crm.lead', 'sale.order', 'sale.order.line',
  'purchase.order', 'purchase.order.line',
  'stock.quant', 'stock.picking', 'stock.warehouse', 'stock.lot',
  'account.move', 'account.payment',
  'mrp.production', 'mrp.bom',
  'quality.check', 'maintenance.request', 'maintenance.equipment',
  'project.project', 'project.task',
  'hr.employee', 'fleet.vehicle', 'helpdesk.ticket',
]

const searchRead = (credential, model, kwargs) => call(credential, model, 'search_read', kwargs)
const searchCount = (credential, model, domain = []) => call(credential, model, 'search_count', { domain })

/** A field worth carrying into a rebuilt workspace: not plumbing, not a one-to-many back-reference. */
const IGNORED_FIELDS = new Set(['id', 'create_uid', 'create_date', 'write_uid', 'write_date', '__last_update', 'display_name', 'message_ids', 'message_follower_ids', 'activity_ids', 'access_token', 'access_url', 'access_warning'])
const usableField = field => !IGNORED_FIELDS.has(field.name) && !['one2many', 'many2many', 'binary'].includes(field.ttype)

export async function introspect(credentialString) {
  const credential = open(credentialString)

  const [modules, company, models] = await Promise.all([
    searchRead(credential, 'ir.module.module', { domain: [['state', '=', 'installed']], fields: ['name', 'shortdesc'], limit: 200, order: 'name asc' }),
    searchRead(credential, 'res.company', { domain: [], fields: ['name', 'country_id', 'currency_id'], limit: 1 }),
    searchRead(credential, 'ir.model', { domain: [], fields: ['model', 'name'], limit: 2000, order: 'model asc' }),
  ])

  const installed = new Set(modules.map(item => item.name))
  const candidates = models
    .filter(item => RELEVANT_MODELS.includes(item.model) || item.model.startsWith('x_'))
    .slice(0, MAX_MODELS)

  /**
   * The count is the whole point.
   *
   * An Odoo with Manufacturing installed and no production orders in it does not manufacture. That
   * is the most common way an ERP misrepresents a business, it is invisible to any interview
   * question, and it is one integer per model to find out.
   */
  const counted = await Promise.all(candidates.map(async item => {
    const count = await searchCount(credential, item.model).catch(() => -1)
    return { ...item, count }
  }))

  const described = counted.filter(item => item.count > 0 || item.model.startsWith('x_'))
  const withFields = await Promise.all(described.map(async item => {
    const fields = await searchRead(credential, 'ir.model.fields', {
      domain: [['model', '=', item.model]],
      fields: ['name', 'field_description', 'ttype', 'required', 'relation', 'selection'],
      limit: 200,
      order: 'name asc',
    }).catch(() => [])
    return {
      model: item.model,
      label: item.name,
      count: item.count,
      custom: item.model.startsWith('x_'),
      fields: fields.filter(usableField).map(field => ({
        name: field.name,
        label: field.field_description || field.name,
        type: field.ttype,
        required: Boolean(field.required),
        relation: field.relation || '',
        // Odoo hands selection options back in more than one spelling across versions; both are a
        // list of [value, label] pairs once parsed, and an unparseable one is simply not a lifecycle.
        selection: parseSelection(field.selection),
        custom: field.name.startsWith('x_'),
      })),
    }
  }))

  const groups = await searchRead(credential, 'res.groups', { domain: [], fields: ['name', 'full_name'], limit: 100, order: 'name asc' }).catch(() => [])

  return {
    provider: 'odoo',
    at: new Date().toISOString(),
    company: {
      name: String(company[0]?.name ?? ''),
      country: Array.isArray(company[0]?.country_id) ? String(company[0].country_id[1] ?? '') : '',
      currency: Array.isArray(company[0]?.currency_id) ? String(company[0].currency_id[1] ?? '') : '',
    },
    modules: modules.map(item => ({ name: item.name, label: item.shortdesc || item.name })).filter(item => installed.has(item.name)),
    models: withFields,
    roles: groups.map(item => ({ name: String(item.full_name || item.name) })).slice(0, 60),
  }
}

/**
 * The states a record moves through, in the company's own words.
 *
 * `ir.model.fields.selection` comes back as a Python repr — `[('draft','RFQ'),('done','Locked')]` —
 * which is not JSON and never will be: the tuples are parentheses and the strings are single-quoted.
 * Swapping quote characters and hoping is what breaks on the first label containing an apostrophe,
 * so the pairs are matched out directly instead.
 *
 * Newer instances hand back a real array over JSON-2, which needs none of this.
 */
const QUOTED = /'((?:[^'\\]|\\.)*)'/g
const unescape = value => value.replace(/\\(.)/g, '$1')

function parseSelection(value) {
  if (Array.isArray(value)) return value.filter(pair => Array.isArray(pair) && pair.length >= 2).map(pair => ({ value: String(pair[0]), label: String(pair[1]) }))
  if (typeof value !== 'string' || !value.trim()) return []
  // Every quoted string in order, then paired up: value, label, value, label. Reading them as a flat
  // sequence rather than matching whole tuples is what survives a label like 'Customer\'s order'.
  const quoted = [...value.matchAll(QUOTED)].map(match => unescape(match[1]))
  const options = []
  for (let index = 0; index + 1 < quoted.length; index += 2) options.push({ value: quoted[index], label: quoted[index + 1] })
  return options
}

/**
 * Odoo wants `'YYYY-MM-DD HH:MM:SS'` in UTC, with no `T` and no `Z`.
 *
 * An ISO string here matches nothing at all, so the import returns zero rows for ever and looks
 * exactly like a company where nothing has changed since the day it was connected.
 */
export const odooDatetime = value => {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 19).replace('T', ' ') : ''
}

/**
 * The records, shaped by a mapping the client derived from the introspection.
 *
 * The mapping arrives rather than living here because what an Odoo field *means* to a business is an
 * architecture decision — made where the workspace is compiled, from the same introspection that
 * built the entity in the first place. A second copy of that judgement on this side would drift from
 * the schema it is supposed to be filling.
 *
 * @param {{ model: string, entityId: string, primary?: string, fields: Array<{ from: string, to: string, kind?: string }> }[]} mapping
 */
export async function pull(credentialString, { since = {}, full = false, mapping = [] } = {}) {
  const credential = open(credentialString)
  const pulled = {}
  const cursor = {}

  for (const entry of mapping) {
    if (!entry?.model || !entry?.entityId || !Array.isArray(entry.fields)) continue
    const fields = ['id', 'write_date', ...entry.fields.map(field => field.from).filter(Boolean)]
    const from = full ? '' : odooDatetime(since?.[entry.entityId] ?? '')
    const domain = from ? [['write_date', '>', from]] : []

    const rows = []
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const batch = await searchRead(credential, entry.model, {
        domain, fields: [...new Set(fields)], limit: PAGE, offset: page * PAGE, order: 'write_date asc',
      })
      rows.push(...batch)
      if (batch.length < PAGE) break
    }

    pulled[entry.entityId] = [...(pulled[entry.entityId] ?? []), ...rows.map(row => ({
      externalId: `${entry.model}:${row.id}`,
      values: Object.fromEntries(entry.fields.map(field => [field.to, odooValue(row[field.from], field.kind)]).filter(([, value]) => value !== undefined)),
      remoteUpdatedAt: row.write_date ? new Date(`${row.write_date.replace(' ', 'T')}Z`).toISOString() : '',
    }))]

    /**
     * The cursor moves to the newest row actually seen, never to now.
     *
     * An Odoo whose clock runs behind Wesify's would otherwise have every row written in the gap
     * skipped for ever, and nothing about the result would look wrong.
     */
    const newest = rows.map(row => String(row.write_date ?? '')).filter(Boolean).sort().at(-1)
    if (newest) cursor[entry.entityId] = new Date(`${newest.replace(' ', 'T')}Z`).toISOString()
  }

  return { ...pulled, _cursor: cursor }
}

/** Odoo's shapes, flattened into what a Wesify field holds. */
function odooValue(value, kind) {
  if (value === false || value === null || value === undefined) return kind === 'boolean' ? false : ''
  // A many2one arrives as [id, "Display name"]. The name is what a person reads; resolving it to a
  // local record id is a second pass over merged data, and not something v1 does.
  if (Array.isArray(value)) return String(value[1] ?? '')
  if (kind === 'number' || kind === 'currency') return Number(value) || 0
  if (kind === 'boolean') return Boolean(value)
  if (kind === 'date') return String(value).slice(0, 10)
  return String(value)
}
