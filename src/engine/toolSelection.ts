import { detectProviders, providerById, providers } from '../data/providers'

export const toolSelectionStorageKey = 'bo-home-selected-tools'

export function loadSelectedTools(initialValue = '') {
  const inferred = detectProviders(initialValue).map(item => item.provider.id)
  try {
    const stored = JSON.parse(sessionStorage.getItem(toolSelectionStorageKey) ?? '[]')
    if (!Array.isArray(stored)) return inferred
    const validStored = stored.filter((id): id is string => typeof id === 'string' && providerById.has(id))
    return [...new Set([...validStored, ...inferred])]
  } catch {
    return inferred
  }
}

export function saveSelectedTools(providerIds: string[]) {
  sessionStorage.setItem(toolSelectionStorageKey, JSON.stringify(providerIds))
}

export function enrichBriefWithTools(brief: string, selectedTools: string[]) {
  const value = brief.trim()
  const mentionedTools = new Set(detectProviders(value).map(item => item.provider.id))
  const additionalTools = providers.filter(provider => selectedTools.includes(provider.id) && !mentionedTools.has(provider.id))
  return additionalTools.length
    ? `${value}\n\nWe currently use ${additionalTools.map(provider => provider.label).join(', ')}.`
    : value
}
