// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyWorkspaceSetup, briefWithSetup, emptyWorkspaceSetup, inviteRejection, logoRejection,
  normalizeWorkspaceSetup, readWorkspaceSetup, rememberSignedInAccount, saveWorkspaceSetup,
  signedInAccountId, suggestCompanyName, withInvite, withInviteRole, withoutInvite,
  workspaceSetupKey,
} from './workspaceSetup'
import type { WorkspaceConfiguration } from './workspaceSchema'

const pngLogo = 'data:image/png;base64,AAAA'

beforeEach(() => localStorage.clear())

describe('the name onboarding offers', () => {
  it('takes a name the description actually said', () => {
    expect(suggestCompanyName('We run a bakery called Pao Bom in Lisbon.')).toBe('Pao Bom')
    expect(suggestCompanyName('A logistics firm named Northwind Freight Group works out of Leeds.')).toBe('Northwind Freight Group')
    expect(suggestCompanyName('We run a company called Atlas Facilities. We manage service contracts.')).toBe('Atlas Facilities')
  })

  it('takes a quoted name when there is no "called"', () => {
    expect(suggestCompanyName('We are "Blue Harbour Dental" and we see 40 patients a day.')).toBe('Blue Harbour Dental')
  })

  it('offers nothing rather than guessing from the trade', () => {
    expect(suggestCompanyName('We are a plumbing company with six vans.')).toBe('')
    expect(suggestCompanyName('')).toBe('')
  })
})

describe('what may be a logo', () => {
  it('refuses a file that is not an image, and says why', () => {
    expect(logoRejection({ type: 'application/pdf', size: 1000 })).toMatch(/not an image/)
  })

  it('refuses an image too large to be worth resizing', () => {
    expect(logoRejection({ type: 'image/png', size: 30_000_000 })).toMatch(/too large/)
  })

  it('accepts an ordinary logo', () => {
    expect(logoRejection({ type: 'image/svg+xml', size: 4_000 })).toBe('')
  })
})

describe('the people invited', () => {
  it('refuses an empty box, a bad address, and a repeat', () => {
    const setup = withInvite(emptyWorkspaceSetup(), 'ana@company.com', 'manager')
    expect(inviteRejection(setup, '  ')).toMatch(/Type an email/)
    expect(inviteRejection(setup, 'ana@company')).toMatch(/does not look like/)
    expect(inviteRejection(setup, 'ANA@company.com')).toMatch(/already on the list/)
    expect(inviteRejection(setup, 'luis@company.com')).toBe('')
  })

  it('stops at twenty five, and says where the rest go', () => {
    let setup = emptyWorkspaceSetup()
    for (let index = 0; index < 25; index += 1) setup = withInvite(setup, `person${index}@company.com`)
    expect(setup.invites).toHaveLength(25)
    expect(inviteRejection(setup, 'one-more@company.com')).toMatch(/up to 25 people/)
    expect(withInvite(setup, 'one-more@company.com').invites).toHaveLength(25)
  })

  it('keeps addresses lowercase, changes a role, and removes somebody', () => {
    const invited = withInvite(emptyWorkspaceSetup(), '  Ana@Company.com ', 'employee')
    expect(invited.invites).toEqual([{ email: 'ana@company.com', role: 'employee' }])
    expect(withInviteRole(invited, 'ANA@company.com', 'admin').invites[0].role).toBe('admin')
    expect(withoutInvite(invited, 'ana@company.com').invites).toEqual([])
    expect(withoutInvite(invited, 'someone-else@company.com').invites).toHaveLength(1)
  })
})

describe('what survives storage', () => {
  it('reads back exactly what was saved', () => {
    const setup = withInvite({ name: 'Northwind', logo: pngLogo, invites: [] }, 'ana@company.com', 'manager')
    saveWorkspaceSetup('workspace-1', setup)
    expect(readWorkspaceSetup('workspace-1')).toEqual(setup)
    expect(localStorage.getItem(workspaceSetupKey('workspace-1'))).toContain('Northwind')
  })

  it('clears cached workspaces when the signed-in account changes', () => {
    localStorage.setItem('bo-workspace-config', JSON.stringify({ id: 'workspace-1', profile: { companyName: 'Old company' } }))
    localStorage.setItem('bo-workspace-config:workspace-1', JSON.stringify({ id: 'workspace-1', profile: { companyName: 'Old company' } }))
    localStorage.setItem('bo-active-workspace-id', 'workspace-1')
    rememberSignedInAccount('user-1')
    rememberSignedInAccount('user-2')

    expect(signedInAccountId()).toBe('user-2')
    expect(localStorage.getItem('bo-workspace-config')).toBeNull()
    expect(localStorage.getItem('bo-workspace-config:workspace-1')).toBeNull()
    expect(localStorage.getItem('bo-active-workspace-id')).toBeNull()
  })

  it('is empty for a workspace that never went through onboarding', () => {
    expect(readWorkspaceSetup('never-set-up')).toEqual(emptyWorkspaceSetup())
  })

  it('throws away everything malformed rather than rendering it', () => {
    const normalized = normalizeWorkspaceSetup({
      name: 42,
      logo: 'https://example.com/logo.png',
      invites: [
        { email: 'ANA@company.com', role: 'director' },
        { email: 'ana@company.com', role: 'admin' },
        { email: 'not-an-address', role: 'admin' },
        null,
        'luis@company.com',
      ],
    })
    expect(normalized).toEqual({ name: '', logo: '', invites: [{ email: 'ana@company.com', role: 'employee' }] })
    expect(normalizeWorkspaceSetup(null)).toEqual(emptyWorkspaceSetup())
    expect(normalizeWorkspaceSetup({ name: 'Northwind' }).invites).toEqual([])
  })
})

describe('what the interview is told', () => {
  it('adds the name and the head count the description did not have', () => {
    const setup = withInvite({ name: 'Northwind', logo: '', invites: [] }, 'ana@company.com')
    expect(briefWithSetup('We ship pallets around Yorkshire.', setup))
      .toBe('We ship pallets around Yorkshire.\n\nOur company is called Northwind. 2 of us will be working in this system.')
  })

  it('does not repeat a name the description already gave', () => {
    const setup = { name: 'Northwind', logo: '', invites: [] }
    expect(briefWithSetup('Northwind ships pallets.', setup)).toBe('Northwind ships pallets.')
  })

  it('leaves a description alone when onboarding was skipped', () => {
    expect(briefWithSetup('  We ship pallets.  ', emptyWorkspaceSetup())).toBe('We ship pallets.')
  })
})

describe('what onboarding does to the built workspace', () => {
  const configuration = { version: 1, id: 'workspace-1', profile: { companyName: 'Freight business', description: '' } } as unknown as WorkspaceConfiguration

  it('overrides the name the interview inferred, and keeps the logo', () => {
    const applied = applyWorkspaceSetup(configuration, { name: ' Northwind ', logo: pngLogo, invites: [] })
    expect(applied.profile.companyName).toBe('Northwind')
    expect(applied.profile.logo).toBe(pngLogo)
    expect(configuration.profile.companyName).toBe('Freight business')
  })

  it('keeps the inferred name when onboarding was given no name', () => {
    expect(applyWorkspaceSetup(configuration, { name: '', logo: pngLogo, invites: [] }).profile.companyName).toBe('Freight business')
  })

  it('changes nothing at all when onboarding was skipped', () => {
    expect(applyWorkspaceSetup(configuration, emptyWorkspaceSetup())).toBe(configuration)
  })
})
