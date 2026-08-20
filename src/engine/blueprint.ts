export const moduleIds = [
  'sales', 'customers', 'marketing', 'commerce', 'subscriptions', 'projects', 'processes', 'scheduling',
  'field-service', 'procurement', 'inventory', 'manufacturing', 'quality', 'maintenance', 'logistics',
  'finance', 'accounting', 'documents', 'support', 'team', 'hr', 'payroll', 'compliance', 'analytics',
] as const

export type ModuleId = typeof moduleIds[number]

export interface AIBlueprint {
  modules: ModuleId[]
  startView: ModuleId | 'overview'
  moduleConfig: {
    pipelineStages: string[]
    processSteps: string[]
    billingCadence: string
    inventoryStages: string[]
    supportStages: string[]
  }
}

export interface AIQuestion {
  id: string
  prompt: string
  type: 'text' | 'single' | 'multi'
  placeholder: string
  options: Array<{ value: string; label: string }>
}

export interface AIExchange { question: AIQuestion; answer: string | string[] }

export interface AIStepResponse {
  status: 'question' | 'complete'
  message: string
  blueprint: AIBlueprint
  question: AIQuestion
}
