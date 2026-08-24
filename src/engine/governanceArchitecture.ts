import type { WorkspaceAction } from './workspaceActions'
import type { WorkspaceConfiguration, WorkspaceRoleId } from './workspaceSchema'

export type LogicClass = 'deterministic' | 'ai-assisted' | 'agentic' | 'human-controlled'
export type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5
export type ActionControlDisposition = 'information-only' | 'analysis-only' | 'recommendation' | 'approval-required' | 'execute-within-limits' | 'execute-and-report' | 'blocked'

export interface DecisionBoundary {
  logicClass: LogicClass
  examples: string[]
  output: string
  constraints: string[]
}

export interface ActionAutonomyPolicy {
  actionType: WorkspaceAction['type']
  logicClass: LogicClass
  defaultLevel: AutonomyLevel
  maximumLevel: AutonomyLevel
  requiredRolePermission: 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'admin'
  sensitiveDomains: string[]
}

export interface GovernanceArchitecture {
  version: 1
  boundaries: DecisionBoundary[]
  levels: Array<{ level: AutonomyLevel; label: string; behavior: string }>
  policies: ActionAutonomyPolicy[]
  humanControl: { payments: true; employmentDecisions: true; contractAcceptance: true; legalDecisions: true }
}

export interface ActionControlDecision {
  level: AutonomyLevel
  logicClass: LogicClass
  disposition: ActionControlDisposition
  requiresApproval: boolean
  canExecuteDirectly: boolean
  reasons: string[]
}

const boundaries: DecisionBoundary[] = [
  { logicClass: 'deterministic', examples: ['Financial and inventory arithmetic', 'Approval thresholds', 'State transitions', 'Permissions'], output: 'Validated result or state change', constraints: ['Structured inputs', 'Versioned rules', 'Complete audit trail'] },
  { logicClass: 'ai-assisted', examples: ['Complaint classification', 'Candidate ranking', 'Summaries', 'Anomaly detection', 'Forecast suggestions'], output: 'Explainable analysis or recommendation', constraints: ['No invented facts', 'Confidence exposed', 'Human review for material decisions'] },
  { logicClass: 'agentic', examples: ['Investigations', 'Supplier comparisons', 'Recovery plans', 'Cross-functional coordination'], output: 'Evidence-backed plan or bounded action', constraints: ['Scoped tools and data', 'Shared company state', 'Escalation and approval rules'] },
  { logicClass: 'human-controlled', examples: ['Payments', 'Employee termination', 'Contract acceptance', 'Sensitive legal decisions'], output: 'Prepared decision package', constraints: ['Named accountable approver', 'No self-approval', 'Immutable evidence'] },
]

const policy = (actionType: WorkspaceAction['type'], logicClass: LogicClass, defaultLevel: AutonomyLevel, maximumLevel: AutonomyLevel, requiredRolePermission: ActionAutonomyPolicy['requiredRolePermission'], sensitiveDomains: string[] = []): ActionAutonomyPolicy => ({ actionType, logicClass, defaultLevel, maximumLevel, requiredRolePermission, sensitiveDomains })

const policies: ActionAutonomyPolicy[] = [
  policy('navigate', 'deterministic', 5, 5, 'view'),
  policy('query_business_data', 'deterministic', 5, 5, 'view'),
  policy('create_record', 'deterministic', 4, 4, 'create', ['finance', 'accounting', 'payroll', 'people', 'compliance']),
  policy('update_record', 'deterministic', 4, 4, 'edit', ['finance', 'accounting', 'payroll', 'people', 'compliance']),
  policy('delete_record', 'human-controlled', 3, 3, 'delete'),
  policy('add_field', 'human-controlled', 3, 3, 'admin'),
  policy('activate_module', 'human-controlled', 3, 3, 'admin'),
  policy('deactivate_module', 'human-controlled', 3, 3, 'admin'),
  policy('deactivate_capability', 'human-controlled', 3, 3, 'admin'),
  policy('create_workflow', 'ai-assisted', 3, 3, 'admin'),
]

export function compileGovernanceArchitecture(): GovernanceArchitecture {
  return {
    version: 1,
    boundaries,
    levels: [
      { level: 0, label: 'Information only', behavior: 'Read and present approved information.' },
      { level: 1, label: 'AI analysis', behavior: 'Analyze evidence without recommending or acting.' },
      { level: 2, label: 'AI recommendation', behavior: 'Recommend an action with reasons and impact.' },
      { level: 3, label: 'Human approval', behavior: 'Prepare the action; an authorized human approves execution.' },
      { level: 4, label: 'Bounded execution', behavior: 'Execute inside explicit permissions, limits and rules.' },
      { level: 5, label: 'Autonomous with exceptions', behavior: 'Execute and report, escalating exceptions.' },
    ],
    policies,
    humanControl: { payments: true, employmentDecisions: true, contractAcceptance: true, legalDecisions: true },
  }
}

function actionDomain(config: WorkspaceConfiguration, action: WorkspaceAction) {
  if ('entityId' in action) return config.entities.find(entity => entity.id === action.entityId)?.module ?? ''
  if (action.type === 'activate_module' || action.type === 'deactivate_module') return action.module
  if (action.type === 'deactivate_capability') return action.capabilityId.split('.')[0]
  if (action.type === 'create_workflow') return config.entities.find(entity => entity.id === action.workflow.trigger.entityId)?.module ?? ''
  return ''
}

function disposition(level: AutonomyLevel): ActionControlDisposition {
  return level === 0 ? 'information-only' : level === 1 ? 'analysis-only' : level === 2 ? 'recommendation' : level === 3 ? 'approval-required' : level === 4 ? 'execute-within-limits' : 'execute-and-report'
}

export function evaluateActionControl(config: WorkspaceConfiguration, action: WorkspaceAction, options: { roleId?: WorkspaceRoleId; agentApprovalRequired?: boolean } = {}): ActionControlDecision {
  const architecture = config.governanceArchitecture ?? compileGovernanceArchitecture()
  const selected = architecture.policies.find(item => item.actionType === action.type) ?? policy(action.type, 'human-controlled', 3, 3, 'admin')
  const reasons: string[] = [`${action.type.replaceAll('_', ' ')} is ${selected.logicClass} logic.`]
  let level = selected.defaultLevel
  const domain = actionDomain(config, action)
  if (selected.sensitiveDomains.includes(domain)) {
    level = Math.min(level, 3) as AutonomyLevel
    reasons.push(`${domain} is a sensitive operating domain.`)
  }
  if (options.agentApprovalRequired) {
    level = Math.min(level, 3) as AutonomyLevel
    reasons.push('The acting agent requires human approval for this action.')
  }
  if (options.roleId) {
    const role = config.roles.find(item => item.id === options.roleId)
    const permitted = role?.permissions.includes(selected.requiredRolePermission) || role?.permissions.includes('admin')
    if (!permitted) return { level: 0, logicClass: selected.logicClass, disposition: 'blocked', requiresApproval: false, canExecuteDirectly: false, reasons: [...reasons, `${role?.label ?? options.roleId} lacks ${selected.requiredRolePermission} permission.`] }
  }
  return { level, logicClass: selected.logicClass, disposition: disposition(level), requiresApproval: level === 3, canExecuteDirectly: level >= 4, reasons }
}
