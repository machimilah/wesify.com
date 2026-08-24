import {
  ArrowLeftRight, BadgeCheck, Banknote, BarChart3, BookOpen, Boxes, Building2, CalendarCheck, CalendarDays,
  CircleDollarSign, ClipboardList, Contact, Factory, FileText, Flag, FolderKanban, Handshake, HardHat, Headphones,
  Layers, LayoutDashboard, ListChecks, Megaphone, Package, Receipt, RefreshCw, ScanLine, ScrollText, ShieldCheck,
  ShoppingCart, Target, TrendingUp, Truck, Users, UsersRound, Wallet, Warehouse, Workflow, Wrench,
} from 'lucide-react'
import type { WorkspaceConfiguration } from '../engine/workspaceSchema'

/**
 * What a page looks like, before its label is read.
 *
 * Shared because the same workspace is drawn twice: once as the live preview while BO is still
 * building, and once as the finished Command Center. Two copies of this map would drift, and the
 * drift would be visible — the same page wearing two different icons on two screens.
 */

/**
 * A face for every module.
 *
 * The launcher has to be readable at a glance, before any label is read — so each module gets its own
 * icon and its own tint. The tints are soft rather than saturated: with twenty-odd tiles on screen,
 * full-strength colour stops being information and becomes noise.
 */
export const moduleFace: Record<string, { icon: typeof LayoutDashboard; tint: string }> = {
  customers: { icon: Users, tint: 'sky' },
  sales: { icon: TrendingUp, tint: 'indigo' },
  marketing: { icon: Megaphone, tint: 'pink' },
  commerce: { icon: ShoppingCart, tint: 'violet' },
  subscriptions: { icon: RefreshCw, tint: 'cyan' },
  projects: { icon: FolderKanban, tint: 'indigo' },
  processes: { icon: Workflow, tint: 'slate' },
  scheduling: { icon: CalendarDays, tint: 'amber' },
  'field-service': { icon: Truck, tint: 'amber' },
  procurement: { icon: ClipboardList, tint: 'sand' },
  inventory: { icon: Boxes, tint: 'sand' },
  manufacturing: { icon: Factory, tint: 'slate' },
  quality: { icon: BadgeCheck, tint: 'stone' },
  maintenance: { icon: Wrench, tint: 'slate' },
  logistics: { icon: Truck, tint: 'cyan' },
  finance: { icon: CircleDollarSign, tint: 'stone' },
  accounting: { icon: BookOpen, tint: 'stone' },
  documents: { icon: FileText, tint: 'slate' },
  support: { icon: Headphones, tint: 'sky' },
  team: { icon: UsersRound, tint: 'violet' },
  hr: { icon: Contact, tint: 'violet' },
  payroll: { icon: Banknote, tint: 'stone' },
  compliance: { icon: ShieldCheck, tint: 'rose' },
  analytics: { icon: BarChart3, tint: 'indigo' },
}

/**
 * A face for the common record types.
 *
 * The module is too coarse on its own: quotes and orders are both "sales", and inventory, warehouses,
 * stock movements and lots are all "inventory" — four tiles wearing the same icon, which is exactly
 * what a launcher must not do. Anything not listed falls back to its module.
 */
export const entityFace: Record<string, typeof LayoutDashboard> = {
  customers: Users, opportunities: TrendingUp, activities: CalendarCheck, quotes: ScrollText, contracts: Handshake,
  orders: ShoppingCart, 'store-orders': ShoppingCart, partners: Handshake, products: Package, 'price-lists': Receipt,
  'stock-items': Boxes, warehouses: Warehouse, 'stock-movements': ArrowLeftRight, lots: ScanLine, bins: Warehouse,
  'bills-of-material': Layers, 'production-orders': Factory, 'work-centers': Factory, 'quality-checks': BadgeCheck,
  equipment: Wrench, 'maintenance-orders': Wrench, shipments: Truck, vehicles: Truck, 'purchase-orders': ClipboardList,
  suppliers: Building2, requisitions: ClipboardList, invoices: Receipt, payments: CircleDollarSign, expenses: Wallet,
  budgets: Target, employees: UsersRound, projects: FolderKanban, tasks: ListChecks, milestones: Flag,
  'time-entries': CalendarCheck, tickets: Headphones, subscriptions: RefreshCw, appointments: CalendarCheck,
  'work-orders': HardHat, documents: FileText, approvals: BadgeCheck, controls: ShieldCheck, campaigns: Megaphone,
}

export const faceFor = (module?: string, entityId?: string) => ({
  icon: entityFace[entityId ?? ''] ?? moduleFace[module ?? '']?.icon ?? FileText,
  tint: moduleFace[module ?? '']?.tint ?? 'slate',
})

/**
 * The face of a navigation entry, resolved through the entity it opens.
 *
 * A navigation item carries only a view id, so the record type — the thing that actually decides the
 * icon — has to be looked up. Without this every page falls back to the generic document icon, and a
 * twenty-page sidebar becomes twenty identical glyphs.
 */
export function faceForNavigation(config: WorkspaceConfiguration, item: { viewId?: string; module?: string }) {
  const view = config.views.find(candidate => candidate.id === item.viewId)
  const entity = config.entities.find(candidate => candidate.id === view?.entityId)
  return faceFor(entity?.module ?? item.module, entity?.id)
}
