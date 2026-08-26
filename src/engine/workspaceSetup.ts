import { readStorage } from './shared'
import type { WorkspaceConfiguration, WorkspaceRoleId } from './workspaceSchema'

/**
 * The three things Wesify asks for before it starts building: a name, a logo, and who else works here.
 *
 * Everything else about a Command Center is worked out from a description — that is the product, and
 * asking an operator to fill in a form about their own business would undo it. These three cannot be
 * worked out from anything. A company's name is not reliably in its description, nobody's logo is,
 * and no model can guess a colleague's email address. So they are asked once, plainly, in the moment
 * where the answers are cheap: before the interview rather than after the workspace exists.
 *
 * All three are optional bar the name, and the name is offered pre-filled from the description
 * wherever the description happened to say it. An onboarding step that cannot be skipped is a wall
 * in front of the thing somebody came here to see.
 */

export type TeamRole = Exclude<WorkspaceRoleId, 'owner'>

export interface TeamInvite {
  email: string
  role: TeamRole
}

export interface WorkspaceSetup {
  name: string
  /** A data URL. Held rather than a link, so a workspace's logo cannot break when a host does. */
  logo: string
  invites: TeamInvite[]
}

/** What an invited colleague can be. `owner` is missing on purpose: it comes from building, not from a list. */
export const teamRoles: Array<{ id: TeamRole; label: string; detail: string }> = [
  { id: 'admin', label: 'Admin', detail: 'Can change the workspace and invite people' },
  { id: 'manager', label: 'Manager', detail: 'Runs the day to day and approves work' },
  { id: 'employee', label: 'Team member', detail: 'Works in the records they are given' },
  { id: 'accountant', label: 'Accountant', detail: 'Sees the money, not the people' },
]

const teamRoleIds = new Set<string>(teamRoles.map(role => role.id))

export const emptyWorkspaceSetup = (): WorkspaceSetup => ({ name: '', logo: '', invites: [] })

export const workspaceSetupKey = (workspaceId: string) => `bo-workspace-setup:${workspaceId}`

/** Image formats a browser will actually render, and the ceiling before one is worth resizing. */
export const logoImageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
export const maxLogoFileBytes = 8_000_000
/** What may be stored once resized — the server refuses more, since a logo travels on every page load. */
export const maxLogoDataUrlLength = 96_000

/**
 * Why this file cannot be a logo, or '' when it can.
 *
 * A message rather than a boolean because the dialog has to say something: "that is a PDF" and "that
 * photo is 30 MB" are different problems with different fixes, and one greyed-out button explains
 * neither.
 */
export function logoRejection(file: { type: string; size: number }) {
  if (!logoImageTypes.includes(file.type)) return 'That file is not an image. PNG, JPG, WEBP or SVG.'
  if (file.size > maxLogoFileBytes) return 'That image is too large. Anything up to 8 MB.'
  return ''
}

export function isTeamEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
}

/**
 * A company name, if the description gave one away.
 *
 * Only where it was actually said — "called Pao Bom", "named Northwind", a quoted name — never
 * inferred from the industry. A guessed name is worse than an empty box: the box is one word of
 * typing, and the guess is something an operator has to notice, disagree with, and clear.
 */
export function suggestCompanyName(brief: string) {
  const text = String(brief ?? '')
  const patterns = [
    /\b(?:called|named)\s+([\p{Lu}\p{N}][\p{L}\p{N}&'-]*(?:\s+[\p{Lu}\p{N}][\p{L}\p{N}&'-]*){0,3})/u,
    /["“']([\p{L}\p{N}][^"“”']{1,39})["”']/u,
  ]
  for (const pattern of patterns) {
    const found = text.match(pattern)?.[1]?.trim().replace(/[.,;:]$/, '')
    if (found) return found.slice(0, 60)
  }
  return ''
}

/** Whatever came out of storage or the server, made into something the dialog can render. */
export function normalizeWorkspaceSetup(value: unknown): WorkspaceSetup {
  if (!value || typeof value !== 'object') return emptyWorkspaceSetup()
  const candidate = value as Partial<WorkspaceSetup>
  const invites = Array.isArray(candidate.invites) ? candidate.invites : []
  return {
    name: typeof candidate.name === 'string' ? candidate.name.slice(0, 120) : '',
    logo: typeof candidate.logo === 'string' && candidate.logo.startsWith('data:image/') ? candidate.logo : '',
    invites: invites
      .filter((invite): invite is TeamInvite => Boolean(invite) && typeof invite === 'object' && typeof (invite as TeamInvite).email === 'string' && isTeamEmail((invite as TeamInvite).email))
      .map(invite => ({ email: invite.email.trim().toLowerCase(), role: teamRoleIds.has(invite.role) ? invite.role : 'employee' }))
      .filter((invite, index, all) => all.findIndex(other => other.email === invite.email) === index)
      .slice(0, 25),
  }
}

export function readWorkspaceSetup(workspaceId: string) {
  return normalizeWorkspaceSetup(readStorage<unknown>(workspaceSetupKey(workspaceId), null))
}

export function saveWorkspaceSetup(workspaceId: string, setup: WorkspaceSetup) {
  localStorage.setItem(workspaceSetupKey(workspaceId), JSON.stringify(setup))
  return setup
}

/**
 * Erases every trace of one workspace from this browser.
 *
 * Swept by key rather than listed one by one on purpose: a workspace's local state is spread across
 * modules that each own their own key — the built configuration, the onboarding answers, the
 * discovery session, the access token, the role — and a list here would go stale the first time one
 * of them was added. Every one of those keys is `bo-`-prefixed and carries the workspace id, which
 * is what makes the sweep safe.
 */
const deletedWorkspacesKey = 'bo-deleted-workspaces'

/**
 * Workspaces this browser has deleted, remembered by id.
 *
 * Sweeping the keys is not enough on its own. Several modules write a workspace's configuration back
 * to storage from state they are already holding — a tab left open on the deleted workspace, a save
 * that was in flight — and any one of them puts the workspace back in the dashboard's list as though
 * it had never gone. The tombstone is what the list checks, so a deleted workspace stays deleted
 * however many times something else writes its name down again.
 */
export function deletedWorkspaceIds(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(deletedWorkspacesKey) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function forgetWorkspaceLocally(workspaceId: string) {
  const id = String(workspaceId ?? '')
  if (!id) return
  // Written first: whatever else fails below, the dashboard has been told never to show this again.
  localStorage.setItem(deletedWorkspacesKey, JSON.stringify([...new Set([...deletedWorkspaceIds(), id])].slice(-200)))
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('bo-') && key.includes(id)) localStorage.removeItem(key)
  }
  if (localStorage.getItem('bo-active-workspace-id') === id) localStorage.removeItem('bo-active-workspace-id')
  // The legacy single-workspace keys name no id at all, so they are checked by what they contain.
  try {
    const legacy = JSON.parse(localStorage.getItem('bo-workspace-config') ?? 'null') as { id?: string } | null
    if (legacy?.id === id) localStorage.removeItem('bo-workspace-config')
  } catch {
    // A cache too broken to parse is a cache nobody can be using.
  }
}

/** Why this address cannot be added, or '' when it can. Same shape, and same reason, as `logoRejection`. */
export function inviteRejection(setup: WorkspaceSetup, email: string) {
  const address = email.trim().toLowerCase()
  if (!address) return 'Type an email address first.'
  if (!isTeamEmail(address)) return 'That does not look like an email address.'
  if (setup.invites.some(invite => invite.email === address)) return 'That person is already on the list.'
  if (setup.invites.length >= 25) return 'Wesify invites up to 25 people at a time. The rest can be added from the workspace.'
  return ''
}

export function withInvite(setup: WorkspaceSetup, email: string, role: TeamRole = 'employee'): WorkspaceSetup {
  if (inviteRejection(setup, email)) return setup
  return { ...setup, invites: [...setup.invites, { email: email.trim().toLowerCase(), role }] }
}

export function withoutInvite(setup: WorkspaceSetup, email: string): WorkspaceSetup {
  return { ...setup, invites: setup.invites.filter(invite => invite.email !== email.trim().toLowerCase()) }
}

export function withInviteRole(setup: WorkspaceSetup, email: string, role: TeamRole): WorkspaceSetup {
  return { ...setup, invites: setup.invites.map(invite => invite.email === email.trim().toLowerCase() ? { ...invite, role } : invite) }
}

/**
 * The description the interview actually receives.
 *
 * What onboarding learned is told to the architect rather than kept for the shell to display: a
 * company that has just said it is called Northwind should not be asked its name as question three,
 * and one that has just named four colleagues has said something real about its size.
 */
export function briefWithSetup(brief: string, setup: WorkspaceSetup) {
  const value = String(brief ?? '').trim()
  const additions: string[] = []
  const name = setup.name.trim()
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, character => `\\${character}`)
  if (name && !new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i').test(value)) additions.push(`Our company is called ${name}.`)
  if (setup.invites.length) additions.push(`${setup.invites.length + 1} of us will be working in this system.`)
  return additions.length ? `${value}\n\n${additions.join(' ')}` : value
}

/**
 * The operator's answers beat the architect's.
 *
 * The interview infers a company name from whatever was said, and it is usually right — but it is an
 * inference either way, and somebody who typed their own name into the onboarding box has settled
 * the question. Applied at the end so nothing upstream has to know onboarding exists.
 */
export function applyWorkspaceSetup(config: WorkspaceConfiguration, setup: WorkspaceSetup): WorkspaceConfiguration {
  const name = setup.name.trim()
  if (!name && !setup.logo) return config
  return {
    ...config,
    profile: {
      ...config.profile,
      companyName: name || config.profile.companyName,
      ...(setup.logo ? { logo: setup.logo } : {}),
    },
  }
}
