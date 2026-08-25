// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { workspaceAccessHeaders, workspaceAccessToken } from './workspaceAccess'

/**
 * The token that identifies a browser to a workspace when there is no account.
 *
 * It is what Wesify used before accounts existed and what it still uses with no database configured, so
 * two properties matter: it is stable for a workspace across reloads, and it is different for every
 * workspace. A token that regenerated would lock somebody out of their own prototype workspace; a
 * token shared between workspaces would be one workspace's key opening another.
 */
describe('workspace access', () => {
  beforeEach(() => localStorage.clear())

  it('mints a token once and returns the same one afterwards', () => {
    const first = workspaceAccessToken('ws-1')
    expect(first.length).toBeGreaterThanOrEqual(32)
    expect(workspaceAccessToken('ws-1')).toBe(first)
  })

  it('gives a different token to every workspace', () => {
    expect(workspaceAccessToken('ws-1')).not.toBe(workspaceAccessToken('ws-2'))
  })

  it('survives a reload, because it lives in storage rather than in memory', () => {
    const token = workspaceAccessToken('ws-1')
    expect(localStorage.getItem('bo-workspace:ws-1:access-token')).toBe(token)
  })

  it('sends the workspace id alongside the token, which is what the server checks them against', async () => {
    const headers = await workspaceAccessHeaders('ws-1')
    expect(headers['x-bo-workspace-id']).toBe('ws-1')
    expect(headers['x-bo-access-token']).toBe(workspaceAccessToken('ws-1'))
    // Nobody signed in: the account header is simply absent rather than sent empty, which the
    // server would read as a token that failed rather than as no token at all.
    expect(headers.authorization).toBeUndefined()
  })

  /**
   * The session half comes from Clerk, which mints a short-lived token per request rather than
   * leaving one in storage — so this asks Clerk the way the app does, through `window.Clerk`.
   */
  it('adds the account session when there is one, so the server can prefer it', async () => {
    window.Clerk = { session: { getToken: async () => 'a-real-session' } }
    expect((await workspaceAccessHeaders('ws-1')).authorization).toBe('Bearer a-real-session')
    window.Clerk = undefined
  })

  it('sends no session when Clerk cannot mint one, rather than an empty bearer', async () => {
    window.Clerk = { session: { getToken: async () => { throw new Error('offline') } } }
    expect((await workspaceAccessHeaders('ws-1')).authorization).toBeUndefined()
    window.Clerk = undefined
  })

  it('contains no separators, so it cannot be confused for two values', () => {
    expect(workspaceAccessToken('ws-1')).toMatch(/^[a-zA-Z0-9]+$/)
  })
})
