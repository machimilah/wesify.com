import { spawn } from 'node:child_process'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const generatedRoot = await mkdtemp(path.join(tmpdir(), 'bo-generated-projects-'))
const port = 8799
const workspaceId = 'construction-demo'
const accessToken = 'bo_test_workspace_access_token_1234567890'
const server = spawn(process.execPath, ['server/index.mjs', '--port', String(port)], { cwd: process.cwd(), env: { ...process.env, BO_GENERATED_ROOT: generatedRoot, NODE_ENV: 'test' }, stdio: 'pipe' })

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
  entity('invoices', 'Invoice', 'Invoices', 'finance', [text('number', 'Invoice number', true), relation('customer', 'Client', 'customers'), { id: 'amount', label: 'Amount', type: 'currency' }, status('Draft', 'Sent', 'Paid', 'Overdue')]),
  entity('expenses', 'Expense', 'Expenses', 'finance', [text('description', 'Description', true), { id: 'amount', label: 'Amount', type: 'currency' }]),
  entity('project-costs', 'Project cost', 'Project Costs', 'finance', [text('description', 'Description', true), relation('project', 'Project', 'projects'), { id: 'amount', label: 'Amount', type: 'currency' }]),
]
const views = entities.map(item => ({ id: `${item.id}-table`, label: item.pluralLabel, entityId: item.id, type: item.id === 'projects' ? 'kanban' : 'table', groupBy: item.id === 'projects' ? 'status' : undefined, columns: item.fields.slice(0, 4).map(field => field.id) }))
const navigation = [{ id: 'home', label: 'Dashboard', kind: 'home' }, ...views.map(view => ({ id: view.entityId, label: view.label, kind: 'entity', viewId: view.id, module: entities.find(item => item.id === view.entityId).module })), { id: 'analytics', label: 'Analytics', kind: 'analytics' }, { id: 'links', label: 'Links', kind: 'links' }, { id: 'assistant', label: 'AI Assistant', kind: 'assistant' }, { id: 'settings', label: 'Settings', kind: 'settings' }]
const specification = { version: 1, id: workspaceId, profile: { companyName: 'BuildCo', description: 'Small construction company with seven employees, suppliers, and milestone invoices.', archetype: 'construction', industry: 'Construction Company', businessModel: 'Projects', revenueModel: 'Milestone invoices', teamStructure: 'Seven employees', customers: 'Clients', productsAndServices: 'Construction projects', operatingProcesses: ['Plan', 'Build', 'Inspect', 'Handover'], suppliers: 'Material suppliers', locations: '', goals: [], terminology: {} }, modules: ['customers', 'projects', 'team', 'inventory', 'finance'], capabilities: ['work.projects', 'finance.invoicing'], entities, views, navigation, metrics: [], workflows: [], roles: [{ id: 'owner', label: 'Owner', permissions: ['view', 'create', 'edit', 'delete', 'approve', 'financial', 'people', 'admin'] }] }

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

  const connector = await api(`/api/projects/${workspaceId}/connectors`, { method: 'POST', body: JSON.stringify({ name: 'Make operations', type: 'make-webhook', endpointUrl: 'https://hook.eu2.make.com/bo-test-endpoint' }) })
  if (connector.endpointHost !== 'hook.eu2.make.com' || connector.endpointUrl) throw new Error('Webhook connector was not created with its secret URL redacted.')
  const automation = await api(`/api/projects/${workspaceId}/automations`, { method: 'POST', body: JSON.stringify({ name: 'Send new clients to Make', entityId: 'customers', event: 'created', connectorId: connector.id }) })
  if (automation.enabled) throw new Error('New external automation should start paused.')
  const simulation = await api(`/api/projects/${workspaceId}/automations/${automation.id}/test`, { method: 'POST', body: JSON.stringify({ dryRun: true }) })
  if (simulation.status !== 'simulated') throw new Error('Webhook dry-run simulation failed.')
  const enabledAutomation = await api(`/api/projects/${workspaceId}/automations/${automation.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: true }) })
  if (!enabledAutomation.enabled) throw new Error('Automation enablement failed.')
  await api(`/api/projects/${workspaceId}/automations/${automation.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) })
  const automationWorkspace = await api(`/api/projects/${workspaceId}/automations`)
  if (automationWorkspace.connectors[0]?.endpointUrl || automationWorkspace.runs[0]?.status !== 'simulated') throw new Error('Automation management view exposed a secret or lost run history.')

  const denied = await fetch(`${base}/api/projects/${workspaceId}/automations`, { headers: { 'x-bo-workspace-id': workspaceId, 'x-bo-access-token': 'wrong_workspace_access_token_123456789', 'x-bo-role': 'owner' } })
  if (denied.status !== 403) throw new Error('A different workspace session token was not rejected.')
  const audit = await api(`/api/projects/${workspaceId}/audit`)
  if (!audit.some(item => item.event === 'record.updated') || !audit.some(item => item.event === 'notification.updated') || !audit.some(item => item.event === 'connector.created') || !audit.some(item => item.event === 'automation.tested')) throw new Error('Security audit history failed.')
  const history = await api(`/api/projects/${workspaceId}/versions`)
  if (history.length !== 3) throw new Error('Generated project version history failed.')
  console.log('Project service test passed: workspace access, code generation, CRUD, workflow alerts, webhook connectors, automation simulation, audit history, versioned changes, and cross-module query.')
} finally {
  server.kill()
}
