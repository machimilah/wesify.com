import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { databaseAvailable, query } from './db.mjs'

const execFileAsync = promisify(execFile)
function workspaceRoot() { return path.resolve(process.env.BO_GENERATED_ROOT || path.join(process.cwd(), 'generated-projects')) }

export const BUILD_STATES = ['PLANNING', 'GENERATING', 'INSTALLING', 'MIGRATING', 'TESTING', 'REPAIRING', 'PREVIEW_READY', 'DEPLOYING', 'HEALTHY', 'FAILED']

function safeId(value) {
  const id = String(value ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80)
  if (!id) throw new Error('A valid workspace id is required.')
  return id
}

function projectRoot(workspaceId) { return path.join(workspaceRoot(), safeId(workspaceId)) }
function versionRoot(workspaceId, version) { return path.join(projectRoot(workspaceId), 'versions', `v${version}`) }
async function readJson(file, fallback = null) { try { return JSON.parse(await readFile(file, 'utf8')) } catch { return fallback } }
async function writeJson(file, value) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }

function specializedWidgets(specification) {
  const capabilities = new Set(specification.capabilities ?? [])
  const capabilityWidgets = [
    ['manufacturing.production', { id: 'production-throughput', kind: 'metric', label: 'Production throughput', entityId: 'production-orders' }],
    ['quality.inspections', { id: 'quality-results', kind: 'breakdown', label: 'Quality results', entityId: 'quality-checks' }],
    ['maintenance.assets', { id: 'maintenance-schedule', kind: 'timeline', label: 'Maintenance schedule', entityId: 'maintenance-orders' }],
    ['service.field-work', { id: 'field-service-schedule', kind: 'timeline', label: 'Service schedule', entityId: 'work-orders' }],
    ['subscriptions.billing', { id: 'recurring-revenue', kind: 'metric', label: 'Recurring revenue', entityId: 'subscriptions' }],
    ['subscriptions.success', { id: 'customer-health', kind: 'breakdown', label: 'Customer health', entityId: 'success-plans' }],
    ['vertical.construction-controls', { id: 'change-order-value', kind: 'metric', label: 'Change order value', entityId: 'change-orders' }],
    ['vertical.healthcare', { id: 'claims-status', kind: 'breakdown', label: 'Claims status', entityId: 'claims' }],
    ['logistics.shipping', { id: 'delivery-status', kind: 'timeline', label: 'Delivery status', entityId: 'shipments' }],
    ['work.resources', { id: 'team-capacity', kind: 'breakdown', label: 'Team capacity', entityId: 'allocations' }],
    ['finance.invoicing', { id: 'receivables', kind: 'metric', label: 'Receivables', entityId: 'invoices' }],
  ].filter(([id]) => capabilities.has(id)).map(([, widget]) => widget)
  if (capabilityWidgets.length) return capabilityWidgets.slice(0, 4)
  const archetype = specification.profile?.archetype
  if (archetype === 'construction') return [
    { id: 'project-budget-variance', kind: 'metric', label: 'Project budget variance', entityId: 'projects' },
    { id: 'project-cost-tracker', kind: 'breakdown', label: 'Project costs', entityId: 'project-costs' },
    { id: 'project-timeline', kind: 'timeline', label: 'Project timeline', entityId: 'projects' },
  ]
  if (archetype === 'agency') return [
    { id: 'campaign-performance', kind: 'metric', label: 'Campaign performance', entityId: 'campaigns' },
    { id: 'client-health', kind: 'breakdown', label: 'Client health', entityId: 'customers' },
    { id: 'monthly-retainer', kind: 'metric', label: 'Monthly retainers', entityId: 'invoices' },
  ]
  if (archetype === 'field-service') return [
    { id: 'job-schedule', kind: 'timeline', label: 'Job schedule', entityId: 'projects' },
    { id: 'crew-capacity', kind: 'metric', label: 'Crew capacity', entityId: 'employees' },
    { id: 'equipment-status', kind: 'breakdown', label: 'Equipment status', entityId: 'equipment' },
  ]
  return [{ id: 'operating-overview', kind: 'metric', label: 'Operating overview', entityId: specification.entities[0]?.id ?? '' }]
}

function actionRegistry(specification) {
  return specification.entities.flatMap(entity => ['create', 'list', 'update', 'delete'].map(operation => ({ id: `${entity.id}.${operation}`, entityId: entity.id, operation })))
}

function relationships(specification) {
  return specification.entities.flatMap(entity => entity.fields.filter(field => field.type === 'relation' && field.relationEntityId).map(field => ({ from: entity.id, field: field.id, to: field.relationEntityId })))
}

function runtimeSource(manifest) {
  const widgetJson = JSON.stringify(manifest.specializedComponents)
  const entityJson = JSON.stringify(manifest.entities.map(entity => ({ id: entity.id, primaryField: entity.primaryField })))
  return `// Generated internally by Wesify. Not exposed in the customer interface.\nexport const workspaceId = ${JSON.stringify(manifest.workspaceId)};\nexport const version = ${manifest.version};\nexport const widgets = ${widgetJson};\nexport const entities = ${entityJson};\nexport function projectCost(records, projectId) {\n  return (records['project-costs'] ?? []).filter(item => item.project === projectId).reduce((sum, item) => sum + Number(item.amount ?? 0), 0);\n}\nexport function mostExpensiveProject(records) {\n  const projects = records.projects ?? [];\n  return projects.map(project => ({ project, cost: projectCost(records, project.id) })).sort((a, b) => b.cost - a.cost)[0] ?? null;\n}\nexport function selfTest() { return Array.isArray(widgets) && Array.isArray(entities) && version > 0; }\n`
}

function serviceSource(entity) {
  const required = entity.fields.filter(field => field.required).map(field => field.id)
  return `// Generated ${entity.label} service contract.\nexport const entityId = ${JSON.stringify(entity.id)};\nexport const requiredFields = ${JSON.stringify(required)};\nexport function validate(input) {\n  const missing = requiredFields.filter(field => input[field] === undefined || input[field] === '');\n  return { valid: missing.length === 0, missing };\n}\nexport function scopeToWorkspace(record, workspaceId) { return { ...record, workspaceId }; }\n`
}

function pageSource(page, view, entity) {
  return `// Generated ${page.label} page definition.\nexport const page = ${JSON.stringify({ id: page.id, label: page.label, route: `/company/:workspaceId/${page.id}`, view: view?.type ?? page.kind, entityId: entity?.id ?? null }, null, 2)};\nexport function mount(context) { return { ...page, context: { workspaceId: context.workspaceId, role: context.role } }; }\n`
}

function validateSpecification(specification) {
  if (!specification || !Array.isArray(specification.entities) || !Array.isArray(specification.navigation) || !Array.isArray(specification.views)) throw new Error('Invalid workspace specification.')
  const entityIds = new Set(specification.entities.map(entity => entity.id))
  if (entityIds.size !== specification.entities.length) throw new Error('Entity identifiers must be unique.')
  for (const entity of specification.entities) {
    if (!entity.fields.some(field => field.id === entity.primaryField)) throw new Error(`${entity.id} has no primary field.`)
    for (const field of entity.fields) if (field.relationEntityId && !entityIds.has(field.relationEntityId)) throw new Error(`${entity.id}.${field.id} has an invalid relation.`)
  }
  const viewIds = new Set(specification.views.map(view => view.id))
  for (const item of specification.navigation) if (item.viewId && !viewIds.has(item.viewId)) throw new Error(`${item.id} points to a missing view.`)
}

async function generateFiles(root, manifest, specification) {
  await mkdir(root, { recursive: true })
  await writeJson(path.join(root, 'project.json'), manifest)
  await writeJson(path.join(root, 'database', 'schema.json'), { workspaceId: manifest.workspaceId, entities: specification.entities, relationships: manifest.relationships, tenantKey: 'workspaceId' })
  await writeJson(path.join(root, 'database', 'migrations', `${String(manifest.version).padStart(3, '0')}-${manifest.changeType}.json`), { version: manifest.version, description: manifest.changeDescription, preserveExistingData: true, entities: specification.entities.map(entity => entity.id) })
  await writeFile(path.join(root, 'runtime.mjs'), runtimeSource(manifest), 'utf8')
  for (const entity of specification.entities) {
    await mkdir(path.join(root, 'services'), { recursive: true })
    await writeFile(path.join(root, 'services', `${entity.id}.mjs`), serviceSource(entity), 'utf8')
  }
  for (const page of specification.navigation) {
    const view = specification.views.find(candidate => candidate.id === page.viewId)
    const entity = specification.entities.find(candidate => candidate.id === view?.entityId)
    await mkdir(path.join(root, 'app', 'pages'), { recursive: true })
    await writeFile(path.join(root, 'app', 'pages', `${page.id}.mjs`), pageSource(page, view, entity), 'utf8')
  }
  for (const workflow of specification.workflows ?? []) {
    await mkdir(path.join(root, 'workflows'), { recursive: true })
    await writeFile(path.join(root, 'workflows', `${workflow.id}.mjs`), `export const workflow = ${JSON.stringify(workflow, null, 2)};\n`, 'utf8')
  }
  await mkdir(path.join(root, 'tests'), { recursive: true })
  await writeFile(path.join(root, 'tests', 'self-test.mjs'), `import { selfTest } from '../runtime.mjs';\nif (!selfTest()) throw new Error('Generated runtime self-test failed.');\nconsole.log('healthy');\n`, 'utf8')
}

async function testCandidate(root, manifest) {
  const generatedFiles = ['runtime.mjs', 'tests/self-test.mjs', ...manifest.entities.map(entity => `services/${entity.id}.mjs`), ...manifest.pages.map(page => `app/pages/${page.id}.mjs`)]
  for (const relative of generatedFiles) await execFileAsync(process.execPath, ['--check', path.join(root, relative)])
  const { stdout } = await execFileAsync(process.execPath, [path.join(root, 'tests', 'self-test.mjs')])
  if (!stdout.includes('healthy')) throw new Error('Generated project self-test did not complete.')
  const runtime = await import(`${pathToFileURL(path.join(root, 'runtime.mjs')).href}?build=${Date.now()}`)
  if (!runtime.selfTest()) throw new Error('Generated project runtime is unhealthy.')
  return generatedFiles
}

/**
 * The build, mirrored into Postgres.
 *
 * `project.json` describes what a Command Center *is* — its entities, their fields, its pages — and
 * it lived only on the local disk that a redeploy wipes. The browser cached a copy, which is exactly
 * why nobody noticed: every record survived in Postgres while the description of what those records
 * meant could vanish, and a workspace whose shape is unknown is a workspace that cannot be opened.
 *
 * Written alongside the files rather than instead of them: the generated runtime is real code on
 * disk and stays there. This is the copy that outlives the machine.
 */
async function rememberBuild(manifest) {
  if (!databaseAvailable() || !manifest?.workspaceId || !manifest?.version) return
  try {
    await query('insert into workspaces (id) values ($1) on conflict (id) do nothing', [manifest.workspaceId])
    await query(
      `insert into workspace_builds (workspace_id, version, manifest) values ($1, $2, $3)
       on conflict (workspace_id, version) do update set manifest = excluded.manifest`,
      [manifest.workspaceId, manifest.version, JSON.stringify(manifest)],
    )
  } catch (error) {
    // A build that succeeded must not be reported as failed because its copy could not be stored.
    console.warn(`Wesify could not record build ${manifest.version} of ${manifest.workspaceId}: ${error?.message ?? error}`)
  }
}

/** The newest healthy build this database holds, for a disk that no longer has one. */
async function rememberedManifest(workspaceId) {
  if (!databaseAvailable()) return null
  const healthy = await query(
    `select manifest from workspace_builds where workspace_id = $1 and manifest->>'buildStatus' = 'HEALTHY'
     order by version desc limit 1`,
    [workspaceId],
  )
  if (healthy.rows[0]) return healthy.rows[0].manifest
  const latest = await query('select manifest from workspace_builds where workspace_id = $1 order by version desc limit 1', [workspaceId])
  return latest.rows[0]?.manifest ?? null
}

export async function currentManifest(workspaceId) {
  const pointer = await readJson(path.join(projectRoot(workspaceId), 'current.json'))
  if (!pointer?.version) return rememberedManifest(workspaceId)
  return (await readJson(path.join(versionRoot(workspaceId, pointer.version), 'project.json'))) ?? rememberedManifest(workspaceId)
}

export async function listVersions(workspaceId) {
  return (await readJson(path.join(projectRoot(workspaceId), 'history.json'), [])).slice().reverse()
}

export async function buildProject({ workspaceId, specification, changeDescription = 'Initial Command Center', changeType = 'initial', promote = true }) {
  workspaceId = safeId(workspaceId)
  validateSpecification(specification)
  const previous = await currentManifest(workspaceId)
  const version = (previous?.version ?? 0) + 1
  const root = versionRoot(workspaceId, version)
  const manifest = {
    workspaceId,
    companyType: specification.profile?.industry ?? 'Business',
    version,
    previousVersion: previous?.version ?? null,
    changeDescription,
    changeType,
    buildStatus: 'GENERATING',
    pages: specification.navigation,
    entities: specification.entities,
    relationships: relationships(specification),
    workflows: specification.workflows ?? [],
    integrations: [],
    permissions: specification.roles ?? [],
    metrics: specification.metrics ?? [],
    actionRegistry: actionRegistry(specification),
    specializedComponents: specializedWidgets(specification),
    generatedFiles: [],
    lastBuild: new Date().toISOString(),
    specification,
  }
  await generateFiles(root, manifest, specification)
  manifest.buildStatus = 'TESTING'
  await writeJson(path.join(root, 'project.json'), manifest)
  try {
    manifest.generatedFiles = await testCandidate(root, manifest)
    manifest.buildStatus = promote ? 'HEALTHY' : 'PREVIEW_READY'
  } catch (error) {
    manifest.buildStatus = 'REPAIRING'
    await writeJson(path.join(root, 'project.json'), manifest)
    await generateFiles(root, manifest, specification)
    try {
      manifest.generatedFiles = await testCandidate(root, manifest)
      manifest.buildStatus = promote ? 'HEALTHY' : 'PREVIEW_READY'
    } catch (repairError) {
      manifest.buildStatus = 'FAILED'
      manifest.failure = repairError instanceof Error ? repairError.message : String(repairError)
      await writeJson(path.join(root, 'project.json'), manifest)
      throw repairError
    }
  }
  await writeJson(path.join(root, 'project.json'), manifest)
  const history = await readJson(path.join(projectRoot(workspaceId), 'history.json'), [])
  await writeJson(path.join(projectRoot(workspaceId), 'history.json'), [...history, { version, previousVersion: manifest.previousVersion, changeDescription, changedFiles: manifest.generatedFiles, schemaChanged: changeType !== 'initial', createdAt: manifest.lastBuild, status: manifest.buildStatus }])
  if (promote) await writeJson(path.join(projectRoot(workspaceId), 'current.json'), { version, promotedAt: new Date().toISOString() })
  await rememberBuild(manifest)
  // No seeding here: a workspace with no records yet reads back as {} on its own, whether that read
  // comes from an absent file or an empty query, so there was never anything for this to do.
  return manifest
}

export async function promoteProject(workspaceId, version) {
  const file = path.join(versionRoot(workspaceId, Number(version)), 'project.json')
  const manifest = await readJson(file)
  if (!manifest || !['PREVIEW_READY', 'HEALTHY'].includes(manifest.buildStatus)) throw new Error('Only tested project candidates can be applied.')
  manifest.buildStatus = 'HEALTHY'
  manifest.promotedAt = new Date().toISOString()
  await writeJson(file, manifest)
  await writeJson(path.join(projectRoot(workspaceId), 'current.json'), { version: Number(version), promotedAt: manifest.promotedAt })
  await rememberBuild(manifest)
  const history = await readJson(path.join(projectRoot(workspaceId), 'history.json'), [])
  await writeJson(path.join(projectRoot(workspaceId), 'history.json'), history.map(item => item.version === Number(version) ? { ...item, status: 'HEALTHY', promotedAt: manifest.promotedAt } : item))
  return manifest
}

export async function rollbackProject(workspaceId, version) {
  const manifest = await readJson(path.join(versionRoot(workspaceId, Number(version)), 'project.json'))
  if (!manifest || manifest.buildStatus !== 'HEALTHY') throw new Error('Only healthy project versions can be restored.')
  await writeJson(path.join(projectRoot(workspaceId), 'current.json'), { version: Number(version), promotedAt: new Date().toISOString(), rollback: true })
  return manifest
}

export function projectPaths(workspaceId) {
  return { root: projectRoot(workspaceId), data: path.join(projectRoot(workspaceId), 'data.json') }
}

/**
 * Erases everything a deleted workspace built: every version, its manifest history, and the JSON
 * records file the infrastructure-free mode keeps beside them.
 *
 * `safeId` is what makes the path safe to remove — the workspace id arrives from a request, and
 * `projectRoot` is the only place that decides where a workspace's files may live.
 */
export async function removeWorkspaceFiles(workspaceId) {
  await rm(projectRoot(workspaceId), { recursive: true, force: true })
}

export async function listBuiltWorkspaceIds() {
  const entries = await readdir(workspaceRoot(), { withFileTypes: true }).catch(error => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  const candidates = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name)
  const built = await Promise.all(candidates.map(async workspaceId => await readJson(path.join(projectRoot(workspaceId), 'current.json')) ? workspaceId : ''))
  return built.filter(Boolean)
}

export async function runtimePath(workspaceId, requestedVersion) {
  const manifest = requestedVersion ? await readJson(path.join(versionRoot(workspaceId, Number(requestedVersion)), 'project.json')) : await currentManifest(workspaceId)
  return manifest ? path.join(versionRoot(workspaceId, manifest.version), 'runtime.mjs') : null
}
