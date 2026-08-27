import { readStorage } from './shared'
import type { WorkspaceConfiguration } from './workspaceSchema'

/**
 * The two things Wesify asks for before it starts building: a name and a logo.
 *
 * Everything else about a Command Center is worked out from a description — that is the product, and
 * asking an operator to fill in a form about their own business would undo it. These two cannot be
 * worked out from anything. A company's name is not reliably in its description, and nobody's logo
 * is. So they are asked once, plainly, in the moment where the answers are cheap: before the
 * interview rather than after the workspace exists.
 *
 * Both are optional bar the name, and the name is offered pre-filled from the description wherever
 * the description happened to say it. An onboarding step that cannot be skipped is a wall in front
 * of the thing somebody came here to see.
 *
 * There is no third question about colleagues. A workspace has one owner and no other members, so
 * there is nobody left here to invite.
 */

export interface WorkspaceSetup {
  name: string
  /** A data URL. Held rather than a link, so a workspace's logo cannot break when a host does. */
  logo: string
}

const signedInAccountKey = 'bo-signed-in-account-id'

export function signedInAccountId() {
  return localStorage.getItem(signedInAccountKey) ?? ''
}

export function rememberSignedInAccount(userId: string | null) {
  const id = String(userId ?? '').trim()
  const current = signedInAccountId()
  if (id && current !== id) {
    for (const key of Object.keys(localStorage)) {
      if (key === 'bo-workspace-config' || key.startsWith('bo-workspace-config:') || key === 'bo-active-workspace-id' || key === 'bo-workspace-id' || key === 'bo-workspace-records' || key === 'bo-records' || key === 'bo-actions' || key === 'bo-role' || key === 'bo-ai-history') localStorage.removeItem(key)
    }
    localStorage.setItem(signedInAccountKey, id)
    return
  }
  if (!id) {
    for (const key of Object.keys(localStorage)) {
      if (key === 'bo-workspace-config' || key.startsWith('bo-workspace-config:') || key === 'bo-active-workspace-id' || key === 'bo-workspace-id' || key === 'bo-workspace-records' || key === 'bo-records' || key === 'bo-actions' || key === 'bo-role' || key === 'bo-ai-history' || key === signedInAccountKey) localStorage.removeItem(key)
    }
    return
  }
  localStorage.setItem(signedInAccountKey, id)
}

export const emptyWorkspaceSetup = (): WorkspaceSetup => ({ name: '', logo: '' })

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
  return {
    name: typeof candidate.name === 'string' ? candidate.name.slice(0, 120) : '',
    logo: typeof candidate.logo === 'string' && candidate.logo.startsWith('data:image/') ? candidate.logo : '',
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

/**
 * The description the interview actually receives.
 *
 * What onboarding learned is told to the architect rather than kept for the shell to display: a
 * company that has just said it is called Northwind should not be asked its name as question three,
 * and one that has just named four colleagues has said something real about its size.
 */
export function briefWithSetup(brief: string, setup: WorkspaceSetup) {
  const value = String(brief ?? '').trim()
  const name = setup.name.trim()
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, character => `\\${character}`)
  if (!name || new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i').test(value)) return value
  return `${value}\n\nOur company is called ${name}.`
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
