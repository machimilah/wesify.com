import {
  Banknote, Check, CircleDollarSign, FolderKanban, Headphones,
  Search, ShoppingCart, Users, UsersRound, Wrench, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { providers, type ProviderDefinition } from '../data/providers'

const providerCategoryMeta: Record<ProviderDefinition['category'], { label: string; icon: LucideIcon }> = {
  accounting: { label: 'Accounting', icon: Banknote },
  payments: { label: 'Payments', icon: CircleDollarSign },
  commerce: { label: 'Commerce', icon: ShoppingCart },
  crm: { label: 'CRM', icon: UsersRound },
  people: { label: 'People', icon: Users },
  work: { label: 'Projects', icon: FolderKanban },
  support: { label: 'Support', icon: Headphones },
  'field-service': { label: 'Field service', icon: Wrench },
}

export function ToolConnectionsDialog({ open, selected, onClose, onSave }: {
  open: boolean
  selected: string[]
  onClose: () => void
  onSave: (providerIds: string[]) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState(selected)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!open) {
      if (dialog.open) dialog.close()
      return
    }

    setDraft(selected)
    setQuery('')
    if (!dialog.open) dialog.showModal()
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => searchRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.documentElement.style.overflow = previousOverflow
    }
  }, [open, selected])

  const normalizedQuery = query.trim().toLowerCase()
  const visibleProviders = normalizedQuery
    ? providers.filter(provider => `${provider.label} ${providerCategoryMeta[provider.category].label}`.toLowerCase().includes(normalizedQuery))
    : providers

  const toggle = (providerId: string) => setDraft(current => current.includes(providerId)
    ? current.filter(id => id !== providerId)
    : [...current, providerId])

  return <dialog
    ref={dialogRef}
    className="bo-tool-dialog"
    aria-labelledby="tool-connections-title"
    data-testid="tool-connections-dialog"
    onCancel={event => { event.preventDefault(); onClose() }}
    onClose={onClose}
    onMouseDown={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
    }}
  >
    <header>
      <div><small>CONNECTED SYSTEMS</small><h2 id="tool-connections-title">Connect your tools</h2></div>
      <button type="button" onClick={onClose} aria-label="Close tool connections"><X size={18}/></button>
    </header>
    <div className="bo-tool-dialog__body">
      <label className="bo-tool-search">
        <Search size={16}/>
        <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tools" aria-label="Search tools"/>
      </label>
      <div className="bo-tool-grid">
        {visibleProviders.map(provider => {
          const category = providerCategoryMeta[provider.category]
          const Icon = category.icon
          const isSelected = draft.includes(provider.id)
          return <button
            type="button"
            key={provider.id}
            className={isSelected ? 'selected' : ''}
            aria-pressed={isSelected}
            onClick={() => toggle(provider.id)}
            data-testid={`tool-option-${provider.id}`}
          >
            <span><Icon size={18}/></span>
            <span><strong>{provider.label}</strong><small>{category.label}</small></span>
            <i>{isSelected && <Check size={13}/>}</i>
          </button>
        })}
        {!visibleProviders.length && <p>No matching connection.</p>}
      </div>
    </div>
    <footer>
      <span>{draft.length ? `${draft.length} selected` : 'No tools selected'}</span>
      <div><button type="button" onClick={onClose}>Cancel</button><button type="button" onClick={() => onSave(draft)}>Add to build</button></div>
    </footer>
  </dialog>
}
