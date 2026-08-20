import { describe, expect, it } from 'vitest'
import { saysSignal } from './shared'

/**
 * Signal matching decides what BO builds, so a loose match is a page nobody asked for.
 *
 * These are the exact matches that put a till, a chart of accounts and a compliance register into a
 * social media agency's workspace.
 */
describe('a signal has to actually be said', () => {
  it('does not find a word inside another word', () => {
    expect(saysSignal('we publish posts and report on engagement', 'pos')).toBe(false)
    expect(saysSignal('transposed the data', 'pos')).toBe(false)
    expect(saysSignal('a caseload of matters', 'case')).toBe(false)
    expect(saysSignal('classroom bookings', 'class')).toBe(false)
  })

  it('finds the word when it is genuinely there', () => {
    expect(saysSignal('we run a point of sale system', 'point of sale')).toBe(true)
    expect(saysSignal('POS terminal in every store', 'pos')).toBe(true)
    expect(saysSignal('customers pay at the till', 'till')).toBe(true)
  })

  it('accepts the plural an operator would actually write', () => {
    expect(saysSignal('we send invoices monthly', 'invoice')).toBe(true)
    expect(saysSignal('our technicians carry parts', 'technician')).toBe(true)
    expect(saysSignal('we manage several classes', 'class')).toBe(true)
  })

  it('matches whole phrases, not their pieces', () => {
    expect(saysSignal('we hold money in a trust account', 'trust account')).toBe(true)
    expect(saysSignal('we manage client accounts on social media', 'trust account')).toBe(false)
  })

  it('is case-insensitive and survives punctuation in a signal', () => {
    expect(saysSignal('We use QuickBooks.', 'quickbooks')).toBe(true)
    expect(saysSignal('our b2b saas product', 'b2b saas')).toBe(true)
  })
})
