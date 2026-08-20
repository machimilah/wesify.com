export type AnswerValue = string | string[]

export interface Answers {
  [questionId: string]: AnswerValue
}

export interface Option {
  value: string
  label: string
  detail?: string
}

export interface Question {
  id: string
  eyebrow: string
  prompt: string
  context: string
  type: 'text' | 'textarea' | 'single' | 'multi'
  placeholder?: string
  options?: Option[]
  required?: boolean
  showWhen?: (answers: Answers) => boolean
}

export type Confidence = 'confirmed' | 'inferred' | 'review'

export interface Insight {
  label: string
  value: string
  confidence: Confidence
  source: string
}

export interface ProcessStep {
  name: string
  owner: string
  status: 'clear' | 'inferred' | 'gap'
}

export interface BusinessProcess {
  id: string
  name: string
  purpose: string
  trigger: string
  outcome: string
  owner: string
  steps: ProcessStep[]
  automationScore: number
}

export interface Kpi {
  label: string
  value: string
  delta: string
  direction: 'up' | 'down' | 'neutral'
  status: 'good' | 'warning' | 'neutral'
}

export interface Recommendation {
  title: string
  rationale: string
  impact: string
  effort: 'Low' | 'Medium' | 'High'
  risk: 'Low' | 'Medium' | 'High'
}

export interface CompanyModel {
  companyName: string
  summary: string
  businessModel: string
  primaryGoal: string
  teamSize: string
  customer: string
  offer: string
  systems: string[]
  departments: string[]
  roles: string[]
  insights: Insight[]
  processes: BusinessProcess[]
  kpis: Kpi[]
  recommendations: Recommendation[]
  confidence: number
}
