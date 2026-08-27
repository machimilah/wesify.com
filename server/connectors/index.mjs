import { checkKey as checkStripeKey, pull as pullStripe, verify as verifyStripe } from './stripe.mjs'
import { checkCredential as checkOdooCredential, introspect as introspectOdoo, pull as pullOdoo, verify as verifyOdoo } from './odoo.mjs'

/**
 * Every outside system Wesify knows how to read, in one place.
 *
 * The connections route used to name Stripe in a string comparison — `providerId !== 'stripe'` and a
 * 404 for everything else — which was honest while there was exactly one connector and became the
 * thing standing in front of the second. A registry is what lets a provider be added by writing a
 * module rather than by editing a route.
 *
 * Two things are deliberately absent from every entry:
 *
 * - **Writes.** Wesify reads a company's ERP, rebuilds their operation as its own workspace, and owns
 *   the records from then on. Nothing is ever written back. That is not a limitation waiting to be
 *   lifted: it is what removes the entire class of risk that makes ERP integrations dangerous — no
 *   duplicated purchase order, no corrupted ledger, no live dependency on an API that deprecates.
 * - **Credentials.** `connectableProviders()` returns the *shape* of a connect form and never a
 *   value, so the interface can be generated from what the connector actually parses instead of
 *   drifting away from it.
 */

/**
 * @typedef {object} CredentialField
 * @property {string} id
 * @property {string} label
 * @property {'text'|'password'|'url'} type
 * @property {string} [placeholder]
 * @property {boolean} [required]
 */

/**
 * @typedef {object} ConnectorDefinition
 * @property {string} id
 * @property {string} label
 * @property {'read'} mode
 * @property {boolean} incremental Whether `pull` can be given a `since` and return only what changed.
 * @property {CredentialField[]} credentialFields
 * @property {(input: Record<string, unknown>) => string} checkCredential Shape only. Never a network call.
 * @property {(credential: string) => Promise<{ account: string, credential?: string }>} verify
 * @property {(credential: string, options: { since?: string, full?: boolean }) => Promise<Record<string, unknown>>} pull
 * @property {(credential: string) => Promise<object>} [introspect] The structural read. Only an ERP has one.
 */

/** @type {ConnectorDefinition[]} */
const connectors = [
  {
    id: 'stripe',
    label: 'Stripe',
    mode: 'read',
    // Stripe's pull fetches the most recent page of each object every time. Saying so here is what
    // stops `syncProvider` handing it a cursor and then trusting the result as a complete picture.
    incremental: false,
    credentialFields: [
      { id: 'apiKey', label: 'Restricted key', type: 'password', placeholder: 'rk_live_…', required: true },
    ],
    checkCredential: input => checkStripeKey(input?.apiKey),
    verify: async credential => ({ account: (await verifyStripe(credential)).livemode ? 'Live' : 'Test' }),
    pull: credential => pullStripe(credential),
  },
  {
    id: 'odoo',
    label: 'Odoo',
    mode: 'read',
    incremental: true,
    credentialFields: [
      { id: 'url', label: 'Odoo address', type: 'url', placeholder: 'https://acme.odoo.com', required: true },
      { id: 'db', label: 'Database', type: 'text', placeholder: 'acme-prod', required: true },
      { id: 'login', label: 'User email', type: 'text', placeholder: 'ops@acme.com', required: true },
      { id: 'apiKey', label: 'API key', type: 'password', required: true },
    ],
    checkCredential: input => checkOdooCredential(input),
    verify: credential => verifyOdoo(credential),
    introspect: credential => introspectOdoo(credential),
    pull: (credential, options) => pullOdoo(credential, options),
  },
]

const byId = new Map(connectors.map(connector => [connector.id, connector]))

export function connectorFor(providerId) {
  return byId.get(String(providerId ?? '')) ?? null
}

/** What the interface needs to draw a connect form, and nothing that could leak. */
export function connectableProviders() {
  return connectors.map(({ id, label, mode, incremental, credentialFields, introspect }) => ({
    id, label, mode, incremental,
    introspects: Boolean(introspect),
    credentialFields: credentialFields.map(field => ({ ...field })),
  }))
}
