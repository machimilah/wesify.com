// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { humanize, moduleLabel, readStorage, saysSignal, slug } from './shared'

/**
 * The helpers everything else is built on.
 *
 * `slug` decides entity and navigation ids, so a change in it silently renames every route in a
 * workspace. `saysSignal` decides which business systems a company is given. Both are small enough
 * to look obviously correct and important enough that "looks correct" is not good enough.
 */
describe('readStorage', () => {
  beforeEach(() => localStorage.clear())

  it('falls back rather than throwing on missing or corrupt values', () => {
    expect(readStorage('nothing', { a: 1 })).toEqual({ a: 1 })
    localStorage.setItem('broken', '{not json')
    expect(readStorage('broken', 'fallback')).toBe('fallback')
    localStorage.setItem('empty', '')
    expect(readStorage('empty', 'fallback')).toBe('fallback')
  })

  it('returns what was stored when it is valid', () => {
    localStorage.setItem('good', JSON.stringify({ id: 'ws-1', pages: [1, 2] }))
    expect(readStorage('good', null)).toEqual({ id: 'ws-1', pages: [1, 2] })
  })
})

describe('slug', () => {
  it('turns a business label into a stable id', () => {
    expect(slug('Work Orders')).toBe('work-orders')
    expect(slug('  Bills of Materials  ')).toBe('bills-of-materials')
    expect(slug('Clients & Contacts')).toBe('clients-contacts')
    expect(slug('Q1 2026 Targets')).toBe('q1-2026-targets')
  })

  it('never leaves a leading or trailing separator, whatever it is given', () => {
    for (const value of ['—Invoices—', '  ...Parts...  ', '???', 'Ünicode Wörk']) {
      const result = slug(value)
      expect(result.startsWith('-'), `${value} produced ${result}`).toBe(false)
      expect(result.endsWith('-'), `${value} produced ${result}`).toBe(false)
    }
  })

  it('caps the length, because an id ends up in a URL', () => {
    expect(slug('a'.repeat(200)).length).toBe(50)
  })
})

describe('humanize and moduleLabel', () => {
  it('reads an id back as words', () => {
    expect(humanize('work-orders')).toBe('Work Orders')
    expect(humanize('bills_of_materials')).toBe('Bills Of Materials')
  })

  it('calls a module what an operator calls it, not what BO calls it', () => {
    expect(moduleLabel('finance')).toBe('Money')
    expect(moduleLabel('processes')).toBe('Operations')
    expect(moduleLabel('inventory')).toBe('Stock')
    expect(moduleLabel('hr')).toBe('People')
  })

  it('falls back to the readable form of an unknown module rather than showing the raw id', () => {
    expect(moduleLabel('something-new')).toBe('Something New')
  })
})

describe('saysSignal', () => {
  it('matches whole words, and the plural of them', () => {
    expect(saysSignal('we send invoices monthly', 'invoice')).toBe(true)
    expect(saysSignal('we track an invoice per job', 'invoice')).toBe(true)
    expect(saysSignal('classes run every week', 'class')).toBe(true)
  })

  /**
   * The regression this function exists for.
   *
   * Signal matching was once a bare substring test, which reads a description as a bag of letters.
   * "We publish posts" selected point-of-sale because "posts" contains "pos", and point of sale
   * dragged products and payments in behind it — a social media agency was given a till, a chart of
   * accounts and a compliance register from three matches like that.
   */
  it('does not find a signal buried inside a longer word', () => {
    expect(saysSignal('we publish posts for clients', 'pos')).toBe(false)
    expect(saysSignal('we run a therapy practice', 'rap')).toBe(false)
    expect(saysSignal('our team manages campaigns', 'ai')).toBe(false)
  })

  it('ignores case, since operators write however they write', () => {
    expect(saysSignal('We Handle SHIPPING ourselves', 'shipping')).toBe(true)
  })

  it('treats a signal with regex characters as text, not as a pattern', () => {
    // A catalog signal is data. If it were compiled as a pattern, "c++" would be a syntax error and
    // "b.o" would match "boo" — a matcher that quietly matches the wrong companies.
    expect(saysSignal('we teach c++ courses', 'c++')).toBe(true)
    expect(saysSignal('we sell boots', 'b.o')).toBe(false)
  })
})