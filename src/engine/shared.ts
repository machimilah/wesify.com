/**
 * Small helpers that more than one module needs.
 *
 * Each of these existed in two or three places, byte-identical. Copies drift: a fix to one `slug`
 * would have silently left the other producing different ids for the same label.
 */

/** Reads JSON from localStorage, falling back rather than throwing on missing or corrupt values. */
export function readStorage<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T } catch { return fallback }
}

/** Turns a business label into a stable id. Entity ids and navigation ids both depend on this. */
export function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
}

/** Turns an id back into something a person can read. */
export function humanize(value: string) {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

/** What a module is called in the sidebar, in the operator's words rather than BO's internal id. */
const MODULE_LABELS: Record<string, string> = {
  customers: 'Customers', sales: 'Sales', marketing: 'Marketing', commerce: 'Products',
  subscriptions: 'Subscriptions', projects: 'Projects', processes: 'Operations', scheduling: 'Schedule',
  'field-service': 'Field service', procurement: 'Purchasing', inventory: 'Stock', manufacturing: 'Production',
  quality: 'Quality', maintenance: 'Maintenance', logistics: 'Logistics', finance: 'Money',
  accounting: 'Accounting', documents: 'Documents', support: 'Support', team: 'Team',
  hr: 'People', payroll: 'Payroll', compliance: 'Compliance', analytics: 'Reporting',
}
export const moduleLabel = (module: string) => MODULE_LABELS[module] ?? humanize(module)

/**
 * Does this text actually say this signal?
 *
 * Signal matching used to be a bare substring test, which reads a business description as a bag of
 * letters rather than words. "We publish posts" selected point-of-sale, because "posts" contains
 * "pos" — and point of sale dragged in products and payments behind it. One social media agency was
 * given a till, a chart of accounts and a compliance register from three matches like that.
 *
 * So: whole words only, with a plural allowed on the end, because operators write "we send invoices"
 * and the catalog says "invoice".
 */
const signalPatterns = new Map<string, RegExp>()
export function saysSignal(text: string, signal: string) {
  let pattern = signalPatterns.get(signal)
  if (!pattern) {
    const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, character => `\\${character}`)
    // `\b` is a transition between a word character and a non-word one, so it can only be used at an
    // end of the signal that is itself a word character. A signal like "c++" or "node.js" ends in
    // punctuation, and a trailing `\b` there asks for a boundary that never occurs — the signal
    // would silently never match anything. Every catalog signal today is plain words; this is here
    // so that adding one that is not does not quietly stop selecting the capability behind it.
    const opening = /^\w/.test(signal) ? String.raw`\b` : String.raw`(?<!\w)`
    // The plural is only offered where it means something: "invoices" for "invoice", not "c++s".
    const closing = /\w$/.test(signal) ? String.raw`(?:e?s)?\b` : String.raw`(?!\w)`
    pattern = new RegExp(`${opening}${escaped}${closing}`, 'i')
    signalPatterns.set(signal, pattern)
  }
  return pattern.test(text)
}
