import { spawn } from 'node:child_process'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import './noSpend.mjs'

const generatedRoot = await mkdtemp(path.join(tmpdir(), 'bo-generated-projects-'))
const port = 8799
const workspaceId = 'construction-demo'
const accessToken = 'bo_test_workspace_access_token_1234567890'
const schedulerSecret = 'project-service-scheduler-secret-32-bytes'
const server = spawn(process.execPath, ['server/index.mjs', '--port', String(port)], { cwd: process.cwd(), env: { ...process.env, BO_GENERATED_ROOT: generatedRoot, BO_CONNECTION_SECRET: 'project-service-test-secret-32-bytes', BO_AUTOMATION_SCHEDULER_SECRET: schedulerSecret, BO_AUTOMATION_SCHEDULER: 'off', NODE_ENV: 'test' }, stdio: 'pipe' })

const base = `http://127.0.0.1:${port}`
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 50))
  if (attempt === 59) throw new Error('Project service did not start.')
}

const text = (id, label, required = false) => ({ id, label, type: 'text', required })
const relation = (id, label, to) => ({ id, label, type: 'relation', relationEntityId: to })
const status = (...options) => ({ id: 'status', label: 'Status', type: 'select', options })
const entity = (id, label, pluralLabel, module, fields) => ({ id, label, pluralLabel, module, primaryField: fields[0].id, fields })

const entities = [
  entity('customers', 'Client', 'Clients', 'customers', [text('name', 'Name', true), text('email', 'Email'), status('Active', 'Inactive')]),
  entity('projects', 'Project', 'Projects', 'projects', [text('name', 'Project', true), relation('customer', 'Client', 'customers'), status('Planned', 'Active', 'Complete'), { id: 'budget', label: 'Budget', type: 'currency' }]),
  entity('tasks', 'Task', 'Tasks', 'projects', [text('title', 'Task', true), relation('project', 'Project', 'projects'), status('To do', 'Done')]),
  entity('employees', 'Employee', 'Employees', 'team', [text('name', 'Name', true), text('role', 'Role')]),
  entity('suppliers', 'Supplier', 'Suppliers', 'inventory', [text('name', 'Supplier', true), text('contact', 'Contact')]),
  entity('materials', 'Material', 'Materials', 'inventory', [text('name', 'Material', true), relation('supplier', 'Supplier', 'suppliers'), { id: 'stock', label: 'Stock', type: 'number' }]),
  entity('products', 'Product', 'Products', 'inventory', [text('name', 'Product', true), text('sku', 'SKU'), { id: 'price', label: 'Price', type: 'currency' }]),
  entity('stock-items', 'Stock item', 'Inventory', 'inventory', [text('name', 'Item', true), relation('product', 'Product', 'products'), { id: 'quantity', label: 'On hand', type: 'number' }, { id: 'allocated', label: 'Allocated', type: 'number' }, { id: 'reorderPoint', label: 'Reorder point', type: 'number' }, status('Available', 'Low stock', 'Out of stock')]),
  entity('stock-movements', 'Stock movement', 'Stock movements', 'inventory', [text('reference', 'Reference', true), relation('product', 'Product', 'products'), { id: 'type', label: 'Movement', type: 'select', options: ['Receipt', 'Transfer', 'Issue', 'Adjustment'] }, { id: 'quantity', label: 'Quantity', type: 'number' }]),
  entity('orders', 'Order', 'Orders', 'sales', [text('number', 'Order number', true), relation('customer', 'Client', 'customers'), { id: 'amount', label: 'Amount', type: 'currency' }, status('Draft', 'Confirmed', 'Fulfilled')]),
  entity('shipments', 'Shipment', 'Shipments', 'logistics', [text('number', 'Shipment', true), relation('order', 'Order', 'orders'), status('Preparing', 'Ready', 'In transit', 'Delivered', 'Exception')]),
  entity('invoices', 'Invoice', 'Invoices', 'finance', [text('number', 'Invoice number', true), relation('customer', 'Client', 'customers'), relation('order', 'Order', 'orders'), { id: 'amount', label: 'Amount', type: 'currency' }, { id: 'balance', label: 'Balance', type: 'currency' }, status('Draft', 'Sent', 'Part paid', 'Paid', 'Overdue')]),
  entity('payments', 'Payment', 'Payments', 'finance', [text('reference', 'Payment reference', true), relation('invoice', 'Invoice', 'invoices'), { id: 'amount', label: 'Amount', type: 'currency' }, status('Pending', 'Completed', 'Failed', 'Refunded')]),
  entity('accounts', 'Account', 'Chart of accounts', 'accounting', [text('name', 'Account', true), text('code', 'Code'), { id: 'type', label: 'Type', type: 'select', options: ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'] }, status('Active', 'Archived')]),
  entity('journal-entries', 'Journal entry', 'Journal entries', 'accounting', [text('reference', 'Reference', true), { id: 'date', label: 'Date', type: 'date' }, relation('account', 'Account', 'accounts'), { id: 'debit', label: 'Debit', type: 'currency' }, { id: 'credit', label: 'Credit', type: 'currency' }, status('Draft', 'Posted'), text('memo', 'Memo')]),
  entity('expenses', 'Expense', 'Expenses', 'finance', [text('description', 'Description', true), { id: 'amount', label: 'Amount', type: 'currency' }, status('Draft', 'Submitted', 'Approved', 'Paid', 'Rejected')]),
  entity('project-costs', 'Project cost', 'Project Costs', 'finance', [text('description', 'Description', true), relation('project', 'Project', 'projects'), { id: 'amount', label: 'Amount', type: 'currency' }]),
]
const views = entities.map(item => ({ id: `${item.id}-table`, label: item.pluralLabel, entityId: item.id, type: item.id === 'projects' ? 'kanban' : 'table', groupBy: item.id === 'projects' ? 'status' : undefined, columns: item.fields.slice(0, 4).map(field => field.id) }))
const navigation = [{ id: 'home', label: 'Dashboard', kind: 'home' }, ...views.map(view => ({ id: view.entityId, label: view.label, kind: 'entity', viewId: view.id, module: entities.find(item => item.id === view.entityId).module })), { id: 'analytics', label: 'Analytics', kind: 'analytics' }, { id: 'links', label: 'Links', kind: 'links' }, { id: 'assistant', label: 'AI Assistant', kind: 'assistant' }, { id: 'settings', label: 'Settings', kind: 'settings' }]
const specification = { version: 1, id: workspaceId, profile: { companyName: 'BuildCo', description: 'Small construction company with seven employees, suppliers, and milestone invoices.', archetype: 'construction', industry: 'Construction Company', businessModel: 'Projects', revenueModel: 'Milestone invoices', teamStructure: 'Seven employees', customers: 'Clients', productsAndServices: 'Construction projects', operatingProcesses: ['Plan', 'Build', 'Inspect', 'Handover'], suppliers: 'Material suppliers', locations: '', goals: [], terminology: {} }, modules: ['customers', 'projects', 'team', 'inventory', 'finance'], capabilities: ['work.projects', 'finance.invoicing', 'finance.expenses'], entities, views, navigation, metrics: [], workflows: [], roles: [{ id: 'owner', label: 'Owner', permissions: ['view', 'create', 'edit', 'delete', 'approve', 'financial', 'people', 'admin'] }] }

async function api(pathname, init = {}) {
  const response = await fetch(`${base}${pathname}`, { ...init, headers: { 'x-bo-workspace-id': workspaceId, 'x-bo-access-token': accessToken, 'x-bo-role': 'owner', ...(init.body ? { 'content-type': 'application/json' } : {}) } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error ?? `Request failed: ${response.status}`)
  return payload
}

try {
  const [first, duplicate] = await Promise.all([
    api('/api/builds', { method: 'POST', body: JSON.stringify({ workspaceId, specification }) }),
    api('/api/builds', { method: 'POST', body: JSON.stringify({ workspaceId, specification }) }),
  ])
  if (first.version !== 1 || first.buildStatus !== 'HEALTHY') throw new Error('Initial generated project was not healthy.')
  if (duplicate.version !== 1 || duplicate.buildStatus !== 'HEALTHY') throw new Error('Concurrent initial build was not deduplicated.')
  if (!first.specializedComponents.some(item => item.id === 'receivables')) throw new Error('Capability-specific runtime component was not generated.')
  const generatedPlan = await api(`/api/projects/${workspaceId}/automations`)
  if (!generatedPlan.automations.some(item => item.planKey === 'collections-escalation' && item.enabled) || !generatedPlan.automations.some(item => item.planKey === 'expense-approval' && item.enabled)) throw new Error('Initial build did not start its inferred automation plan.')
  const dailyCollections = generatedPlan.automations.find(item => item.planKey === 'daily-collections-review')
  if (!dailyCollections?.enabled || dailyCollections.trigger.event !== 'scheduled' || dailyCollections.trigger.schedule?.cadence !== 'daily') throw new Error('Initial build did not provision its autonomous collections scan.')
  await stat(path.join(generatedRoot, workspaceId, 'versions', 'v1', 'runtime.mjs'))
  await stat(path.join(generatedRoot, workspaceId, 'versions', 'v1', 'database', 'schema.json'))
  await stat(path.join(generatedRoot, workspaceId, 'versions', 'v1', 'services', 'projects.mjs'))

  const projectA = await api(`/api/projects/${workspaceId}/records/projects`, { method: 'POST', body: JSON.stringify({ name: 'Project Atlas', status: 'Active', budget: 10000 }) })
  const projectB = await api(`/api/projects/${workspaceId}/records/projects`, { method: 'POST', body: JSON.stringify({ name: 'Project Borealis', status: 'Active', budget: 12000 }) })
  await api(`/api/projects/${workspaceId}/records/project-costs`, { method: 'POST', body: JSON.stringify({ description: 'Materials', project: projectA.id, amount: 4200 }) })
  await api(`/api/projects/${workspaceId}/records/project-costs`, { method: 'POST', body: JSON.stringify({ description: 'Labor', project: projectB.id, amount: 7300 }) })
  const query = await api(`/api/projects/${workspaceId}/query`, { method: 'POST', body: JSON.stringify({ query: 'most-expensive-project' }) })
  if (query.project?.name !== 'Project Borealis' || query.cost !== 7300) throw new Error('Cross-module project cost query failed.')

  const equipment = entity('equipment', 'Equipment', 'Equipment', 'equipment', [text('name', 'Equipment', true), status('Available', 'Assigned', 'Maintenance'), { id: 'nextMaintenance', label: 'Next maintenance', type: 'date' }])
  const maintenance = entity('maintenance', 'Maintenance record', 'Maintenance', 'equipment', [text('description', 'Maintenance', true), relation('equipment', 'Equipment', 'equipment'), status('Scheduled', 'Due', 'Complete'), { id: 'cost', label: 'Cost', type: 'currency' }])
  const secondSpec = { ...specification, modules: [...specification.modules, 'equipment'], entities: [...entities, equipment, maintenance], views: [...views, { id: 'equipment-table', label: 'Equipment', entityId: 'equipment', type: 'table', columns: ['name', 'status', 'nextMaintenance'] }, { id: 'maintenance-table', label: 'Maintenance', entityId: 'maintenance', type: 'table', columns: ['description', 'equipment', 'status', 'cost'] }], navigation: [...navigation.slice(0, -4), { id: 'equipment', label: 'Equipment', kind: 'entity', viewId: 'equipment-table', module: 'equipment' }, { id: 'maintenance', label: 'Maintenance', kind: 'entity', viewId: 'maintenance-table', module: 'equipment' }, ...navigation.slice(-4)] }
  const second = await api(`/api/projects/${workspaceId}/changes`, { method: 'POST', body: JSON.stringify({ specification: secondSpec, changeDescription: 'Added equipment management', changeType: 'activate_module' }) })
  if (second.version !== 2 || second.buildStatus !== 'PREVIEW_READY' || !second.entities.some(item => item.id === 'equipment')) throw new Error('Equipment project candidate failed.')
  const promotedSecond = await api(`/api/projects/${workspaceId}/promote`, { method: 'POST', body: JSON.stringify({ version: second.version }) })
  if (promotedSecond.buildStatus !== 'HEALTHY') throw new Error('Equipment project promotion failed.')

  const workflow = { id: 'maintenance-due', name: 'Remind me when equipment requires maintenance', enabled: true, trigger: { entityId: 'maintenance', event: 'updated', field: 'status', equals: 'Due' }, action: { type: 'notify', message: 'Equipment maintenance is due.' } }
  const third = await api(`/api/projects/${workspaceId}/changes`, { method: 'POST', body: JSON.stringify({ specification: { ...secondSpec, workflows: [workflow] }, changeDescription: 'Added maintenance reminder', changeType: 'create_workflow' }) })
  if (third.version !== 3 || third.workflows.length !== 1) throw new Error('Maintenance workflow generation failed.')
  await api(`/api/projects/${workspaceId}/promote`, { method: 'POST', body: JSON.stringify({ version: third.version }) })
  const excavator = await api(`/api/projects/${workspaceId}/records/equipment`, { method: 'POST', body: JSON.stringify({ name: 'Excavator 1', status: 'Available' }) })
  const maintenanceRecord = await api(`/api/projects/${workspaceId}/records/maintenance`, { method: 'POST', body: JSON.stringify({ description: 'Quarterly service', equipment: excavator.id, status: 'Scheduled', cost: 480 }) })
  await api(`/api/projects/${workspaceId}/records/maintenance/${maintenanceRecord.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Due' }) })
  const notifications = await api(`/api/projects/${workspaceId}/notifications`)
  if (notifications.length !== 1 || notifications[0].message !== 'Equipment maintenance is due.' || notifications[0].read) throw new Error('Workflow notification delivery failed.')
  const readNotification = await api(`/api/projects/${workspaceId}/notifications/${notifications[0].id}`, { method: 'PATCH', body: JSON.stringify({ read: true }) })
  if (!readNotification.read) throw new Error('Notification acknowledgement failed.')

  const supportProduct = await api(`/api/projects/${workspaceId}/records/products`, { method: 'POST', body: JSON.stringify({ name: 'Support seat', sku: 'SUP-1', price: 50 }) })
  await api(`/api/projects/${workspaceId}/records/stock-items`, { method: 'POST', body: JSON.stringify({ name: 'Support seat', product: supportProduct.id, quantity: 10, allocated: 0, reorderPoint: 2, status: 'Available' }) })
  const invoice = await api(`/api/projects/${workspaceId}/records/invoices`, { method: 'POST', body: JSON.stringify({ number: 'INV-100', amount: 2500, status: 'Sent' }) })
  const pricedInvoice = await api(`/api/projects/${workspaceId}/records/invoices/${invoice.id}/lines`, { method: 'PUT', body: JSON.stringify({ lines: [
    { description: 'Implementation', quantity: 2, unitPrice: 1000, discountPercent: 10, taxPercent: 20 },
    { description: 'Training', quantity: 1, unitPrice: 500, discountPercent: 0, taxPercent: 0 },
  ] }) })
  if (pricedInvoice.summary.subtotal !== 2300 || pricedInvoice.summary.taxAmount !== 360 || pricedInvoice.document.amount !== 2660) throw new Error('Invoice line arithmetic did not produce authoritative totals.')
  const invoiceLines = await api(`/api/projects/${workspaceId}/records/invoices/${invoice.id}/lines`)
  if (invoiceLines.length !== 2 || invoiceLines[0].total !== 2160) throw new Error('Invoice lines were not persisted or returned.')
  const order = await api(`/api/projects/${workspaceId}/records/orders`, { method: 'POST', body: JSON.stringify({ number: 'SO-100', amount: 0, status: 'Confirmed' }) })
  await api(`/api/projects/${workspaceId}/records/orders/${order.id}/lines`, { method: 'PUT', body: JSON.stringify({ lines: [{ productId: supportProduct.id, description: 'Support seats', quantity: 3, unitPrice: 50, discountPercent: 0, taxPercent: 20 }] }) })
  const converted = await api(`/api/projects/${workspaceId}/records/orders/${order.id}/convert`, { method: 'POST', body: JSON.stringify({ targetEntityId: 'invoices', values: { number: 'INV-SO-100', status: 'Draft', amount: 0 } }) })
  if (converted.existing || converted.copiedLines !== 1 || converted.record.order !== order.id || converted.record.amount !== 180) throw new Error('Order-to-invoice conversion lost lineage, lines, or calculated value.')
  const duplicateConversion = await api(`/api/projects/${workspaceId}/records/orders/${order.id}/convert`, { method: 'POST', body: JSON.stringify({ targetEntityId: 'invoices', values: { number: 'INV-SO-DUPLICATE', status: 'Draft', amount: 0 } }) })
  if (!duplicateConversion.existing || duplicateConversion.record.id !== converted.record.id) throw new Error('Retrying a document conversion created a duplicate downstream record.')
  await api(`/api/projects/${workspaceId}/records/payments`, { method: 'POST', body: JSON.stringify({ reference: 'PAY-1', invoice: converted.record.id, amount: 80, status: 'Completed' }) })
  let paidInvoice = (await api(`/api/projects/${workspaceId}/records/invoices`)).find(item => item.id === converted.record.id)
  if (paidInvoice.balance !== 100 || paidInvoice.status !== 'Part paid') throw new Error('A completed payment did not recalculate the invoice balance and state.')
  const finalPayment = await api(`/api/projects/${workspaceId}/records/payments`, { method: 'POST', body: JSON.stringify({ reference: 'PAY-2', invoice: converted.record.id, amount: 100, status: 'Completed' }) })
  paidInvoice = (await api(`/api/projects/${workspaceId}/records/invoices`)).find(item => item.id === converted.record.id)
  if (paidInvoice.balance !== 0 || paidInvoice.status !== 'Paid') throw new Error('A fully allocated invoice was not marked paid.')
  await api(`/api/projects/${workspaceId}/records/payments/${finalPayment.id}`, { method: 'DELETE' })
  paidInvoice = (await api(`/api/projects/${workspaceId}/records/invoices`)).find(item => item.id === converted.record.id)
  if (paidInvoice.balance !== 100 || paidInvoice.status !== 'Part paid') throw new Error('Removing a payment did not restore the receivable.')
  let overpaymentRefused = false
  try { await api(`/api/projects/${workspaceId}/records/payments`, { method: 'POST', body: JSON.stringify({ reference: 'PAY-TOO-MUCH', invoice: converted.record.id, amount: 101, status: 'Completed' }) }) }
  catch (error) { overpaymentRefused = /exceed the total/i.test(String(error.message)) }
  if (!overpaymentRefused) throw new Error('Receivables accepted payment allocation above the invoice total.')
  await api(`/api/projects/${workspaceId}/records/stock-movements`, { method: 'POST', body: JSON.stringify({ reference: 'ISSUE-1', product: supportProduct.id, type: 'Issue', quantity: 3 }) })
  let stock = (await api(`/api/projects/${workspaceId}/records/stock-items`)).find(item => item.product === supportProduct.id)
  if (stock.quantity !== 7 || stock.status !== 'Available') throw new Error('A manual stock issue did not update on-hand inventory.')
  const shipment = await api(`/api/projects/${workspaceId}/records/shipments`, { method: 'POST', body: JSON.stringify({ number: 'SHIP-100', order: order.id, status: 'Preparing' }) })
  await api(`/api/projects/${workspaceId}/records/shipments/${shipment.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'In transit' }) })
  stock = (await api(`/api/projects/${workspaceId}/records/stock-items`)).find(item => item.product === supportProduct.id)
  if (stock.quantity !== 4) throw new Error('Shipping an order did not issue its product lines from inventory.')
  await api(`/api/projects/${workspaceId}/records/shipments/${shipment.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Preparing' }) })
  stock = (await api(`/api/projects/${workspaceId}/records/stock-items`)).find(item => item.product === supportProduct.id)
  if (stock.quantity !== 7) throw new Error('Reversing a shipment did not reverse its derived stock movement.')
  let negativeRefused = false
  try { await api(`/api/projects/${workspaceId}/records/stock-movements`, { method: 'POST', body: JSON.stringify({ reference: 'ISSUE-TOO-MUCH', product: supportProduct.id, type: 'Issue', quantity: 20 }) }) }
  catch (error) { negativeRefused = /negative in stock/i.test(String(error.message)) }
  if (!negativeRefused) throw new Error('Inventory accepted a movement that drove on-hand stock negative.')
  const cashAccount = await api(`/api/projects/${workspaceId}/records/accounts`, { method: 'POST', body: JSON.stringify({ name: 'Bank', code: '1000', type: 'Asset', status: 'Active' }) })
  const revenueAccount = await api(`/api/projects/${workspaceId}/records/accounts`, { method: 'POST', body: JSON.stringify({ name: 'Service revenue', code: '4000', type: 'Revenue', status: 'Active' }) })
  const journalInput = { reference: 'SALE-100', date: '2026-08-26', memo: 'Recognise service revenue', idempotencyKey: 'journal-sale-100', lines: [{ account: cashAccount.id, debit: 180, credit: 0 }, { account: revenueAccount.id, debit: 0, credit: 180 }] }
  const journal = await api(`/api/projects/${workspaceId}/accounting/journals`, { method: 'POST', body: JSON.stringify(journalInput) })
  if (journal.entries.length !== 2 || journal.total !== 180 || journal.entries.some(entry => entry.status !== 'Posted')) throw new Error('Balanced journal posting did not create an immutable posted batch.')
  const journalRetry = await api(`/api/projects/${workspaceId}/accounting/journals`, { method: 'POST', body: JSON.stringify(journalInput) })
  if (!journalRetry.existing || journalRetry.batchId !== journal.batchId) throw new Error('Retrying a journal post created a duplicate batch.')
  let unbalancedRefused = false
  try { await api(`/api/projects/${workspaceId}/accounting/journals`, { method: 'POST', body: JSON.stringify({ ...journalInput, reference: 'BAD-1', idempotencyKey: 'bad-journal-1', lines: [{ account: cashAccount.id, debit: 100, credit: 0 }, { account: revenueAccount.id, debit: 0, credit: 90 }] }) }) }
  catch (error) { unbalancedRefused = /out of balance/i.test(String(error.message)) }
  if (!unbalancedRefused) throw new Error('Accounting accepted an unbalanced journal.')
  let postedEditRefused = false
  try { await api(`/api/projects/${workspaceId}/records/journal-entries/${journal.entries[0].id}`, { method: 'PATCH', body: JSON.stringify({ debit: 10 }) }) }
  catch (error) { postedEditRefused = /immutable/i.test(String(error.message)) }
  if (!postedEditRefused) throw new Error('A posted journal line could be edited in place.')
  await api(`/api/projects/${workspaceId}/records/invoices/${invoice.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Overdue' }) })
  const automatedNotifications = await api(`/api/projects/${workspaceId}/notifications`)
  if (!automatedNotifications.some(item => item.automationId === 'generated-collections-escalation')) throw new Error('Generated receivables automation did not execute its condition-aware notification.')

  const expense = await api(`/api/projects/${workspaceId}/records/expenses`, { method: 'POST', body: JSON.stringify({ description: 'Site materials', amount: 650, status: 'Draft' }) })
  await api(`/api/projects/${workspaceId}/records/expenses/${expense.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Submitted' }) })
  const approvalWorkspace = await api(`/api/projects/${workspaceId}/automations`)
  const pendingApproval = approvalWorkspace.approvals.find(item => item.automationId === 'generated-expense-approval' && item.recordId === expense.id && item.status === 'pending')
  if (!pendingApproval) throw new Error('Generated expense automation did not pause for human approval.')
  const decidedApproval = await api(`/api/projects/${workspaceId}/automations/approvals/${pendingApproval.id}`, { method: 'PATCH', body: JSON.stringify({ decision: 'approved', comment: 'Within project budget.' }) })
  if (decidedApproval.status !== 'approved' || decidedApproval.comment !== 'Within project budget.') throw new Error('Automation approval decision was not persisted.')

  const aiPlan = await api(`/api/projects/${workspaceId}/automations/plan`, { method: 'POST', body: JSON.stringify({ instruction: 'When a project is created, create a task and copy the project.' }) })
  if (aiPlan.source !== 'rules' || aiPlan.automation.origin !== 'ai' || aiPlan.automation.enabled || !aiPlan.automation.draftGraph.nodes.some(node => node.config.type === 'create-record' && node.config.entityId === 'tasks')) throw new Error('Natural-language workflow planning did not produce a validated inactive record-creation draft.')
  const scheduledAiPlan = await api(`/api/projects/${workspaceId}/automations/plan`, { method: 'POST', body: JSON.stringify({ instruction: 'Every day at 08:00, scan overdue invoices and notify finance.' }) })
  const scheduledAiTrigger = scheduledAiPlan.automation.draftGraph.nodes.find(node => node.type === 'trigger')
  if (scheduledAiTrigger?.config.event !== 'scheduled' || scheduledAiTrigger.config.schedule?.cadence !== 'daily' || scheduledAiTrigger.config.schedule?.time !== '08:00' || !scheduledAiPlan.automation.draftGraph.nodes.some(node => node.type === 'condition' && node.config.value === 'Overdue')) throw new Error('Natural-language workflow planning did not build an editable scheduled scan.')
  await api(`/api/projects/${workspaceId}/automations/${aiPlan.automation.id}`, { method: 'PATCH', body: JSON.stringify({ publish: true, enabled: true }) })
  const automatedProject = await api(`/api/projects/${workspaceId}/records/projects`, { method: 'POST', body: JSON.stringify({ name: 'Project Cygnus', status: 'Planned', budget: 9000 }) })
  const automatedTasks = await api(`/api/projects/${workspaceId}/records/tasks`)
  if (!automatedTasks.some(item => item.project === automatedProject.id && /Project Cygnus/.test(item.title))) throw new Error('A published AI-built workflow did not create its connected business record.')

  const guardedPlan = await api(`/api/projects/${workspaceId}/automations/plan`, { method: 'POST', body: JSON.stringify({ instruction: 'When an expense is submitted, mark it approved.' }) })
  const guardedGraph = guardedPlan.automation.draftGraph
  const writeNode = guardedGraph.nodes.find(node => node.config.type === 'update-record')
  const approvalNode = guardedGraph.nodes.find(node => node.config.type === 'approval')
  if (!writeNode || !approvalNode || guardedPlan.automation.risk !== 'high' || !guardedPlan.safeguards.length) throw new Error('Consequential AI workflow changes were not placed behind a human approval gate.')

  const connector = await api(`/api/projects/${workspaceId}/connectors`, { method: 'POST', body: JSON.stringify({ name: 'Make operations', type: 'make-webhook', endpointUrl: 'https://hook.eu2.make.com/bo-test-endpoint' }) })
  if (connector.endpointHost !== 'hook.eu2.make.com' || connector.endpointUrl) throw new Error('Webhook connector was not created with its secret URL redacted.')
  const n8nConnector = await api(`/api/projects/${workspaceId}/connectors`, { method: 'POST', body: JSON.stringify({ name: 'n8n operations', type: 'n8n-webhook', endpointUrl: 'https://automation.example.com/webhook/n8n-secret-path' }) })
  const disconnected = await api(`/api/projects/${workspaceId}/connectors/${n8nConnector.id}`, { method: 'DELETE' })
  if (!disconnected.removed || (await api(`/api/projects/${workspaceId}/automations`)).connectors.some(item => item.id === n8nConnector.id)) throw new Error('An unused n8n webhook connection could not be safely disconnected.')
  const storedAutomations = await readFile(path.join(generatedRoot, workspaceId, 'automations.json'), 'utf8')
  const storedCredentials = await readFile(path.join(generatedRoot, '.connections', `${workspaceId}.json`), 'utf8')
  if (storedAutomations.includes('bo-test-endpoint') || storedCredentials.includes('bo-test-endpoint') || storedCredentials.includes('n8n-secret-path')) throw new Error('A webhook credential was stored in plain text.')
  const automation = await api(`/api/projects/${workspaceId}/automations`, { method: 'POST', body: JSON.stringify({ name: 'Send new clients to Make', entityId: 'customers', event: 'created', connectorId: connector.id }) })
  if (automation.enabled) throw new Error('New external automation should start paused.')
  const simulation = await api(`/api/projects/${workspaceId}/automations/${automation.id}/test`, { method: 'POST', body: JSON.stringify({ dryRun: true }) })
  if (simulation.status !== 'simulated') throw new Error('Webhook dry-run simulation failed.')
  const enabledAutomation = await api(`/api/projects/${workspaceId}/automations/${automation.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: true }) })
  if (!enabledAutomation.enabled) throw new Error('Automation enablement failed.')
  await api(`/api/projects/${workspaceId}/automations/${automation.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) })

  const graph = {
    version: 1,
    nodes: [
      { id: 'customer-created', type: 'trigger', position: { x: 60, y: 180 }, config: { entityId: 'customers', event: 'created' } },
      { id: 'active-check', type: 'condition', position: { x: 340, y: 180 }, config: { field: 'status', operator: 'equals', value: 'Active' } },
      { id: 'notify-owner', type: 'action', position: { x: 640, y: 100 }, config: { type: 'notification', message: 'An active client was created.' } },
      { id: 'review-client', type: 'action', position: { x: 640, y: 270 }, config: { type: 'approval', message: 'Review this inactive client.' } },
    ],
    edges: [
      { id: 'customer-check', source: 'customer-created', target: 'active-check' },
      { id: 'active-notify', source: 'active-check', target: 'notify-owner', sourceHandle: 'true' },
      { id: 'inactive-review', source: 'active-check', target: 'review-client', sourceHandle: 'false' },
    ],
  }
  const graphAutomation = await api(`/api/projects/${workspaceId}/automations`, { method: 'POST', body: JSON.stringify({ name: 'Route new clients', graph }) })
  if (graphAutomation.version !== 1 || graphAutomation.graph.nodes.length !== 4) throw new Error('Workflow graph creation failed.')
  const editedGraph = structuredClone(graph)
  editedGraph.nodes.find(node => node.id === 'notify-owner').config.message = 'A new active client is ready.'
  const draft = await api(`/api/projects/${workspaceId}/automations/${graphAutomation.id}`, { method: 'PATCH', body: JSON.stringify({ draftGraph: editedGraph }) })
  if (!draft.hasUnpublishedChanges || draft.version !== 1 || draft.graph.nodes.find(node => node.id === 'notify-owner').config.message !== 'An active client was created.') throw new Error('Workflow drafts changed the live graph before publication.')
  const draftSimulation = await api(`/api/projects/${workspaceId}/automations/${graphAutomation.id}/test`, { method: 'POST', body: JSON.stringify({ dryRun: true }) })
  if (draftSimulation.status !== 'simulated' || draftSimulation.nodeRuns.length !== 3 || draftSimulation.nodeRuns[1].output.result !== false) throw new Error('Draft graph simulation did not record its branch and node trace.')
  const publishedGraph = await api(`/api/projects/${workspaceId}/automations/${graphAutomation.id}`, { method: 'PATCH', body: JSON.stringify({ publish: true, enabled: true }) })
  if (publishedGraph.version !== 2 || publishedGraph.hasUnpublishedChanges || !publishedGraph.enabled) throw new Error('Workflow publication did not create and activate a new version.')
  await api(`/api/projects/${workspaceId}/records/customers`, { method: 'POST', body: JSON.stringify({ name: 'Active Client', status: 'Active' }) })
  await api(`/api/projects/${workspaceId}/records/customers`, { method: 'POST', body: JSON.stringify({ name: 'Inactive Client', status: 'Inactive' }) })
  const graphWorkspace = await api(`/api/projects/${workspaceId}/automations`)
  if (!graphWorkspace.runs.some(run => run.automationId === graphAutomation.id && run.status === 'success' && run.nodeRuns?.some(node => node.output?.result === true))) throw new Error('The true workflow branch did not execute.')
  const branchApproval = graphWorkspace.approvals.find(item => item.automationId === graphAutomation.id && item.status === 'pending')
  if (!branchApproval) throw new Error('The false workflow branch did not pause for approval.')
  await api(`/api/projects/${workspaceId}/automations/approvals/${branchApproval.id}`, { method: 'PATCH', body: JSON.stringify({ decision: 'approved' }) })
  const continuedWorkspace = await api(`/api/projects/${workspaceId}/automations`)
  if (!continuedWorkspace.runs.some(run => run.id === branchApproval.runId && run.status === 'success')) throw new Error('An approved workflow did not continue and complete its execution.')

  const retryGraph = {
    version: 1,
    nodes: [
      { id: 'retry-customer-created', type: 'trigger', position: { x: 60, y: 180 }, config: { entityId: 'customers', event: 'created' } },
      { id: 'retry-create-task', type: 'action', position: { x: 340, y: 180 }, config: { type: 'create-record', entityId: 'tasks', fields: { title: 'Review {{record.name}}', status: 'To do' } } },
      { id: 'retry-approval', type: 'action', position: { x: 640, y: 180 }, config: { type: 'approval', message: 'Approve the follow-up task.' } },
    ],
    edges: [
      { id: 'retry-create', source: 'retry-customer-created', target: 'retry-create-task' },
      { id: 'retry-review', source: 'retry-create-task', target: 'retry-approval' },
    ],
  }
  const retryAutomation = await api(`/api/projects/${workspaceId}/automations`, { method: 'POST', body: JSON.stringify({ name: 'Create one reviewed follow-up', graph: retryGraph }) })
  await api(`/api/projects/${workspaceId}/automations/${retryAutomation.id}`, { method: 'PATCH', body: JSON.stringify({ publish: true, enabled: true }) })
  const retryCustomer = await api(`/api/projects/${workspaceId}/records/customers`, { method: 'POST', body: JSON.stringify({ name: 'Retry Client', status: 'Active' }) })
  const retryWaiting = await api(`/api/projects/${workspaceId}/automations`)
  const retryApproval = retryWaiting.approvals.find(item => item.automationId === retryAutomation.id && item.recordId === retryCustomer.id && item.status === 'pending')
  if (!retryApproval) throw new Error('The retry test workflow did not reach its approval gate.')
  await api(`/api/projects/${workspaceId}/automations/approvals/${retryApproval.id}`, { method: 'PATCH', body: JSON.stringify({ decision: 'rejected' }) })
  const retryResult = await api(`/api/projects/${workspaceId}/automations/runs/${retryApproval.runId}/retry`, { method: 'POST', body: JSON.stringify({ mode: 'original' }) })
  const retryTasks = (await api(`/api/projects/${workspaceId}/records/tasks`)).filter(item => item.title === 'Review Retry Client')
  if (retryResult.status !== 'waiting' || retryTasks.length !== 1 || !retryResult.nodeRuns.some(node => node.nodeId === 'retry-create-task' && node.output?.reused)) throw new Error('Retrying a partially completed workflow repeated an earlier side effect.')

  const scheduleGraph = {
    version: 1,
    nodes: [
      { id: 'scheduled-customer-scan', type: 'trigger', position: { x: 60, y: 180 }, config: { entityId: 'customers', event: 'scheduled', schedule: { cadence: 'daily', time: '00:00', timezone: 'UTC' } } },
      { id: 'scheduled-customer-notification', type: 'action', position: { x: 340, y: 180 }, config: { type: 'notification', message: 'Daily account review: {{record.name}}.' } },
    ],
    edges: [{ id: 'scheduled-notify', source: 'scheduled-customer-scan', target: 'scheduled-customer-notification' }],
  }
  const scheduledAutomation = await api(`/api/projects/${workspaceId}/automations`, { method: 'POST', body: JSON.stringify({ name: 'Daily account review', graph: scheduleGraph }) })
  await api(`/api/projects/${workspaceId}/automations/${scheduledAutomation.id}`, { method: 'PATCH', body: JSON.stringify({ publish: true, enabled: true }) })
  const customerCount = (await api(`/api/projects/${workspaceId}/records/customers`)).length
  const firstScheduleScan = await api(`/api/projects/${workspaceId}/automations/schedules/run-due`, { method: 'POST' })
  const firstScheduledRun = firstScheduleScan.runs.find(item => item.automationId === scheduledAutomation.id)
  if (firstScheduledRun?.status !== 'success' || firstScheduledRun.records !== customerCount) throw new Error('A due scheduled workflow did not run across its configured records.')
  const secondScheduleScan = await api(`/api/projects/${workspaceId}/automations/schedules/run-due`, { method: 'POST' })
  const repeatedScheduledRun = secondScheduleScan.runs.find(item => item.automationId === scheduledAutomation.id)
  const scheduledNotifications = (await api(`/api/projects/${workspaceId}/notifications`)).filter(item => item.automationId === scheduledAutomation.id)
  if (repeatedScheduledRun?.status !== 'already-run' || scheduledNotifications.length !== customerCount) throw new Error('Repeating a scheduled scan duplicated business side effects.')
  const deniedScheduleCall = await fetch(`${base}/api/system/automations/run-due`, { method: 'POST', headers: { authorization: 'Bearer incorrect-scheduler-secret' } })
  if (deniedScheduleCall.status !== 401) throw new Error('The deployment scheduler endpoint accepted an invalid secret.')
  const deploymentScheduleCall = await fetch(`${base}/api/system/automations/run-due`, { method: 'POST', headers: { authorization: `Bearer ${schedulerSecret}` } })
  const deploymentSchedule = await deploymentScheduleCall.json()
  if (!deploymentScheduleCall.ok || !deploymentSchedule.runs.some(item => item.automationId === scheduledAutomation.id && item.status === 'already-run')) throw new Error('The authenticated deployment scheduler endpoint did not scan built workspaces.')

  const cycleGraph = structuredClone(graph)
  cycleGraph.edges.push({ id: 'cycle', source: 'notify-owner', target: 'active-check' })
  const cycleResponse = await fetch(`${base}/api/projects/${workspaceId}/automations`, { method: 'POST', headers: { 'x-bo-workspace-id': workspaceId, 'x-bo-access-token': accessToken, 'x-bo-role': 'owner', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Invalid cycle', graph: cycleGraph }) })
  if (cycleResponse.status !== 400 || !/loops are not supported/i.test((await cycleResponse.json()).error)) throw new Error('Circular workflow validation failed.')

  const automationWorkspace = await api(`/api/projects/${workspaceId}/automations`)
  if (automationWorkspace.connectors[0]?.endpointUrl || !automationWorkspace.runs.some(run => run.status === 'simulated')) throw new Error('Automation management view exposed a secret or lost run history.')

  const denied = await fetch(`${base}/api/projects/${workspaceId}/automations`, { headers: { 'x-bo-workspace-id': workspaceId, 'x-bo-access-token': 'wrong_workspace_access_token_123456789', 'x-bo-role': 'owner' } })
  if (denied.status !== 403) throw new Error('A different workspace session token was not rejected.')
  const audit = await api(`/api/projects/${workspaceId}/audit`)
  if (!audit.some(item => item.event === 'record.updated') || !audit.some(item => item.event === 'notification.updated') || !audit.some(item => item.event === 'connector.created') || !audit.some(item => item.event === 'automation.tested') || !audit.some(item => item.event === 'automation.published') || !audit.some(item => item.event === 'automation.approval.approved')) throw new Error('Security audit history failed.')
  const history = await api(`/api/projects/${workspaceId}/versions`)
  if (history.length !== 3) throw new Error('Generated project version history failed.')
  console.log('Project service test passed: generated automation plans, versioned node graphs, scheduled scans, branching, execution traces, approval gates, webhook connectors, audit history, and cross-module query.')
} finally {
  server.kill()
}
