import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enrichBriefWithTools, loadSelectedTools, saveSelectedTools, toolSelectionStorageKey } from './toolSelection'

const stored = new Map<string, string>()

beforeEach(() => {
  stored.clear()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  })
})

describe('tool selection', () => {
  it('merges valid saved tools with tools named in the brief', () => {
    stored.set(toolSelectionStorageKey, JSON.stringify(['quickbooks', 'unknown-provider', 42]))
    expect(loadSelectedTools('Our sales team already uses HubSpot.')).toEqual(['quickbooks', 'hubspot'])
  })

  it('falls back to inferred tools when saved state is malformed', () => {
    stored.set(toolSelectionStorageKey, '{not json')
    expect(loadSelectedTools('Orders come from Shopify.')).toEqual(['shopify'])
  })

  it('persists the current selection', () => {
    saveSelectedTools(['xero', 'stripe'])
    expect(JSON.parse(stored.get(toolSelectionStorageKey) ?? '[]')).toEqual(['xero', 'stripe'])
  })

  it('adds selected tools without repeating ones already named', () => {
    expect(enrichBriefWithTools('We manage sales in HubSpot.', ['hubspot', 'quickbooks']))
      .toBe('We manage sales in HubSpot.\n\nWe currently use QuickBooks.')
  })
})
