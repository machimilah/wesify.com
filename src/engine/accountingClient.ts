import { apiUrl } from './apiBase'
import { workspaceAccessHeaders } from './workspaceAccess'

export interface JournalLineInput { account: string; debit: number; credit: number; memo?: string }

export async function postJournal(workspaceId: string, input: { reference: string; date: string; memo?: string; idempotencyKey: string; lines: JournalLineInput[] }) {
  const response = await fetch(apiUrl(`/api/projects/${workspaceId}/accounting/journals`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await workspaceAccessHeaders(workspaceId)) },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error ?? 'Wesify could not post that journal.')
  }
  return response.json() as Promise<{ entries: Array<Record<string, string | number | boolean>>; batchId: string; total: number; existing: boolean }>
}
