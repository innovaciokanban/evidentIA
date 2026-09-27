export type Role = 'SUPERUSER' | 'COMPANY_ADMIN' | 'COMPANY_USER'
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export type User = { id: string; name: string; email: string; role: Role; companyId?: string | null }
export type CompanyAdmin = Pick<User, 'id' | 'name' | 'email' | 'role' | 'companyId'>

export type Company = {
  id: string
  name: string
  identification: string
  industry: string
  description: string
  admin: CompanyAdmin | null
  createdAt: string
  updatedAt: string
}

export type DiagnosticStatus = 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED'
export type SWOTType = 'STRENGTH' | 'WEAKNESS' | 'OPPORTUNITY' | 'THREAT'
export type Level = 'LOW' | 'MEDIUM' | 'HIGH'

export type SWOTItem = {
  id: string
  swotId: string
  type: SWOTType
  description: string
  priority?: Level | null
  impact?: Level | null
  createdAt: string
}

export type Diagnostic = {
  id: string
  companyId: string
  title: string
  description: string
  status: DiagnosticStatus
  createdById: string
  createdAt: string
  updatedAt: string
  company: Pick<Company, 'id' | 'name'>
  createdBy: User
  swotAnalysis: { id: string; diagnosticId: string; createdAt: string; updatedAt: string; items: SWOTItem[] } | null
}

export type AIRecommendation = { title: string; description: string; priority: Level; expectedImpact: string; suggestedAction: string }
export type AIAnalysis = {
  id: string
  diagnosticId: string
  executiveSummary: string
  diagnosis: string
  keyFindings: Array<{ finding: string; basis: 'FACT' | 'INFERENCE' }>
  foStrategies: string[]
  doStrategies: string[]
  faStrategies: string[]
  daStrategies: string[]
  priorityRisks: string[]
  priorityOpportunities: string[]
  recommendations: AIRecommendation[]
  createdAt: string
  updatedAt: string
}

export type RecommendationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED'
export type CrossType = 'FO' | 'DO' | 'FA' | 'DA'
export type CrossOrigin = 'USER' | 'AI' | 'BOTH'
export type CrossAnalysis = {
  relevance: string
  strategy: string
  expectedImpact: string
  priority: Level
  risks: string[]
  opportunities: string[]
  recommendation: string
}
export type StrategicCross = {
  id: string
  diagnosticId: string
  crossType: CrossType
  origin: CrossOrigin
  factor1: SWOTItem
  factor2: SWOTItem
  strategy: string | null
  aiAnalysis: CrossAnalysis | null
  priority: Level | null
  createdById: string
  createdAt: string
  updatedAt: string
}
export type WeightingLevel = 'MUY_BAJO' | 'BAJO' | 'MEDIO' | 'ALTO' | 'MUY_ALTO'
export type CrossWeightingCriterion = 'impactoEstrategico' | 'viabilidad' | 'urgencia' | 'sinergiaInterna' | 'impactoReputacional'
export type CrossWeightingCriteria = Record<CrossWeightingCriterion, WeightingLevel>
export type CrossWeighting = {
  id: string
  crossId: string
  impactoEstrategico: WeightingLevel
  viabilidad: WeightingLevel
  urgencia: WeightingLevel
  sinergiaInterna: WeightingLevel
  impactoReputacional: WeightingLevel
  weightedScore: number
  createdById: string
  createdAt: string
  updatedAt: string
}
export type CheckyMessageRole = 'USER' | 'CHECKY'
export type CheckyFindingBasis = 'FACT' | 'INFERENCE'
export type CheckySuggestionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED'
export type CheckyCategory =
  | 'REVIEW_ASPECTS'
  | 'MISSING_CROSSES'
  | 'UNRELATED_FACTORS'
  | 'STRENGTHEN_STRATEGIES'
  | 'STRATEGIC_RISKS'
  | 'MISSED_OPPORTUNITIES'
  | 'INFO_TO_COMPLEMENT'
  | 'NEXT_STEPS'

export type CheckySession = {
  id: string
  diagnosticId: string
  title: string | null
  createdById: string
  createdAt: string
  updatedAt: string
}

export type CheckyMessage = {
  id: string
  sessionId: string
  role: CheckyMessageRole
  content: string
  category: CheckyCategory | null
  basis: CheckyFindingBasis | null
  evidenceIds: string[]
  insufficientData: boolean
  missingInformation: string[]
  status: CheckySuggestionStatus | null
  decisionNote: string | null
  suggestedStrategyTitle: string | null
  suggestedStrategyDescription: string | null
  createdAt: string
}

export type ActionPlanStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED'
export type ActionItemStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export type Recommendation = {
  id: string
  diagnosticId: string
  title: string
  description: string
  priority: Level
  expectedImpact: string
  suggestedAction: string
  status: RecommendationStatus
  createdAt: string
  updatedAt: string
}

export type ActionItem = {
  id: string
  actionPlanId: string
  recommendationId: string | null
  title: string
  description: string
  priority: Level
  status: ActionItemStatus
  responsibleId: string | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
  recommendation: Pick<Recommendation, 'id' | 'title' | 'priority' | 'status'> | null
  responsible: User | null
  ticket?: { id: string } | null
}

export type ActionPlan = {
  id: string
  diagnosticId: string
  title: string
  description: string
  status: ActionPlanStatus
  createdBy: User
  createdAt: string
  updatedAt: string
  items: ActionItem[]
}

export type Ticket = {
  id: string
  title: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  actionItemId?: string | null
  dueDate?: string | null
  createdAt: string
  updatedAt: string
  createdBy: User
  assignedTo: User | null
}

export type DashboardSummary = {
  totalCompanies: number
  totalDiagnostics: number
  draftDiagnostics: number
  inProgressDiagnostics: number
  completedDiagnostics: number
  pendingRecommendations: number
  activeActionPlans: number
  pendingActionItems: number
  overdueActionItems: number
}

export type DashboardRecentDiagnostic = Pick<Diagnostic, 'id' | 'title' | 'status' | 'updatedAt'> & { company: Pick<Company, 'id' | 'name'> }
export type DashboardPriorityRecommendation = Pick<Recommendation, 'id' | 'title' | 'priority' | 'status'> & { diagnostic: { id: string; title: string; company: { id: string; name: string } } }
export type DashboardUpcomingAction = Pick<ActionItem, 'id' | 'title' | 'status' | 'dueDate'> & { actionPlan: { id: string; title: string; diagnostic: { id: string; title: string; company: { id: string; name: string } } }; responsible: Pick<User, 'id' | 'name'> | null }
export type DashboardRecentCompany = Pick<Company, 'id' | 'name' | 'industry' | 'updatedAt'> & { admin: Pick<User, 'id' | 'name'> | null }

export type DashboardData = {
  summary: DashboardSummary
  recentDiagnostics: DashboardRecentDiagnostic[]
  priorityRecommendations: DashboardPriorityRecommendation[]
  upcomingActions: DashboardUpcomingAction[]
  recentCompanies: DashboardRecentCompany[]
}
