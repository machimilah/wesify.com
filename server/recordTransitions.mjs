const targets = {
  opportunities: ['quotes'],
  quotes: ['orders', 'contracts', 'projects'],
  orders: ['shipments', 'projects', 'invoices'],
  contracts: ['projects', 'subscriptions', 'invoices'],
  projects: ['tasks', 'time-entries', 'invoices'],
  'work-orders': ['invoices'],
  invoices: ['payments', 'collection-cases'],
  requisitions: ['purchase-orders'],
  'purchase-orders': ['goods-receipts', 'supplier-invoices'],
  'goods-receipts': ['stock-movements'],
  candidates: ['employees', 'onboarding-cases'],
  employees: ['onboarding-cases'],
  'production-orders': ['quality-checks', 'stock-movements'],
}

export function transitionAllowed(sourceEntityId, targetEntityId) {
  return (targets[sourceEntityId] ?? []).includes(targetEntityId)
}
