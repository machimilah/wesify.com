import { DOCUMENT_LINE_KEY } from './documentLines.mjs'

const roundQuantity = value => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
const systemMovement = movement => movement?._systemSourceEntityId && movement?._systemSourceRecordId

function signedQuantity(movement) {
  const quantity = Number(movement.quantity ?? 0)
  if (!Number.isFinite(quantity)) return 0
  if (/receipt|return/i.test(String(movement.type ?? ''))) return Math.abs(quantity)
  if (/issue|shipment|consume/i.test(String(movement.type ?? ''))) return -Math.abs(quantity)
  if (/transfer/i.test(String(movement.type ?? ''))) return 0
  return quantity
}

function movementTotals(data) {
  const totals = new Map()
  for (const movement of data['stock-movements'] ?? data['_stock-ledger'] ?? []) {
    const productId = String(movement.product ?? movement.productId ?? '')
    if (!productId) continue
    totals.set(productId, roundQuantity((totals.get(productId) ?? 0) + signedQuantity(movement)))
  }
  return totals
}

function sourceLines(data, entityId, recordId) {
  return (data[DOCUMENT_LINE_KEY] ?? []).filter(line => line.parentEntityId === entityId && line.parentRecordId === recordId && line.productId)
}

function derivedMovements(data) {
  const movements = []
  for (const receipt of data['goods-receipts'] ?? []) {
    if (!/received|part received/i.test(String(receipt.status ?? '')) || /returned|failed/i.test(String(receipt.status ?? ''))) continue
    const lines = sourceLines(data, 'purchase-orders', String(receipt.purchaseOrder ?? ''))
    const ordered = lines.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0)
    const received = Number(receipt.quantityReceived ?? 0)
    const ratio = /part received/i.test(String(receipt.status ?? '')) && ordered > 0 && received > 0 ? Math.min(1, received / ordered) : 1
    for (const line of lines) movements.push({
      id: `receipt-${receipt.id}-${line.id}`, workspaceId: receipt.workspaceId, reference: String(receipt.number ?? `Receipt ${receipt.id}`),
      product: line.productId, type: 'Receipt', quantity: roundQuantity(Number(line.quantity ?? 0) * ratio), date: receipt.receivedDate ?? receipt.updatedAt,
      _systemSourceEntityId: 'goods-receipts', _systemSourceRecordId: receipt.id, _systemLineId: line.id,
      createdAt: receipt.createdAt, updatedAt: receipt.updatedAt,
    })
  }
  for (const shipment of data.shipments ?? []) {
    if (!/in transit|delivered|exception/i.test(String(shipment.status ?? ''))) continue
    for (const line of sourceLines(data, 'orders', String(shipment.order ?? ''))) movements.push({
      id: `shipment-${shipment.id}-${line.id}`, workspaceId: shipment.workspaceId, reference: String(shipment.number ?? `Shipment ${shipment.id}`),
      product: line.productId, type: 'Issue', quantity: Math.abs(Number(line.quantity ?? 0)), date: shipment.deliveryDate ?? shipment.updatedAt,
      _systemSourceEntityId: 'shipments', _systemSourceRecordId: shipment.id, _systemLineId: line.id,
      createdAt: shipment.createdAt, updatedAt: shipment.updatedAt,
    })
  }
  return movements
}

function statusFor(quantity, allocated, reorderPoint) {
  const available = quantity - allocated
  if (available <= 0) return 'Out of stock'
  if (available <= reorderPoint) return 'Low stock'
  return 'Available'
}

/** Rebuilds on-hand balances from openings plus the complete ledger after any relevant mutation. */
export function reconcileInventory(nextData, manifest, previousData = nextData) {
  const stockEntity = manifest.entities.find(entity => entity.id === 'stock-items')
  const productEntity = manifest.entities.find(entity => entity.id === 'products')
  const movementEntity = manifest.entities.find(entity => entity.id === 'stock-movements')
  if (!stockEntity && !productEntity?.fields.some(field => field.id === 'stock')) return { data: nextData, changed: [], entityId: '' }

  const manualMovements = (nextData['stock-movements'] ?? []).filter(movement => !systemMovement(movement))
  const ledger = [...manualMovements, ...derivedMovements(nextData)]
  const dataWithLedger = movementEntity ? { ...nextData, 'stock-movements': ledger } : { ...nextData, '_stock-ledger': ledger }
  const previousTotals = movementTotals(previousData)
  const nextTotals = movementTotals(dataWithLedger)
  const products = dataWithLedger.products ?? []
  const changed = []

  if (stockEntity) {
    const existing = dataWithLedger['stock-items'] ?? []
    const byProduct = new Map(existing.filter(item => item.product).map(item => [String(item.product), item]))
    const productIds = new Set([...byProduct.keys(), ...nextTotals.keys()])
    const stockItems = [...existing.filter(item => !item.product)]
    for (const productId of productIds) {
      const before = byProduct.get(productId)
      const oldNet = previousTotals.get(productId) ?? 0
      const newNet = nextTotals.get(productId) ?? 0
      const directlyChanged = before && (previousData['stock-items'] ?? []).find(item => item.id === before.id)?.quantity !== before.quantity
      const opening = directlyChanged
        ? Number(before.quantity ?? 0) - newNet
        : Number(before?._openingQuantity ?? Number(before?.quantity ?? 0) - oldNet)
      const quantity = roundQuantity(opening + newNet)
      const product = products.find(item => item.id === productId)
      if (quantity < -0.000001) throw Object.assign(new Error(`This transaction would make ${product?.name ?? before?.name ?? 'an item'} negative in stock.`), { status: 409 })
      const allocated = Number(before?.allocated ?? 0)
      const reorderPoint = Number(before?.reorderPoint ?? 0)
      const item = {
        ...(before ?? { id: `stock-${productId}`, workspaceId: product?.workspaceId, product: productId, name: String(product?.name ?? product?.sku ?? 'Stock item'), createdAt: new Date().toISOString() }),
        quantity, allocated, reorderPoint, status: statusFor(quantity, allocated, reorderPoint), _openingQuantity: roundQuantity(opening), updatedAt: new Date().toISOString(),
      }
      stockItems.push(item)
      if (!before || before.quantity !== item.quantity || before.status !== item.status) changed.push(item)
    }
    return { data: { ...dataWithLedger, 'stock-items': stockItems }, changed, entityId: 'stock-items' }
  }

  const nextProducts = products.map(product => {
    const prior = (previousData.products ?? []).find(item => item.id === product.id)
    const oldNet = previousTotals.get(product.id) ?? 0
    const newNet = nextTotals.get(product.id) ?? 0
    const directlyChanged = prior && prior.stock !== product.stock
    const opening = directlyChanged ? Number(product.stock ?? 0) - newNet : Number(product._openingStock ?? Number(product.stock ?? 0) - oldNet)
    const stock = roundQuantity(opening + newNet)
    if (stock < -0.000001) throw Object.assign(new Error(`This transaction would make ${product.name ?? 'a product'} negative in stock.`), { status: 409 })
    const updated = { ...product, stock, _openingStock: roundQuantity(opening), updatedAt: new Date().toISOString() }
    if (stock !== product.stock) changed.push(updated)
    return updated
  })
  return { data: { ...dataWithLedger, products: nextProducts }, changed, entityId: 'products' }
}
