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
/** Evidencia de una inferencia ya resuelta contra la matriz: lo que se lee es "Debilidad: X", nunca el
 *  id interno del factor. `evidenceIds` se conserva solo para poder llevar la lectura al factor. */
export type AIFindingEvidence = { type: SWOTType; description: string }
export type AIFinding = { finding: string; basis: 'FACT' | 'INFERENCE'; evidenceIds: string[]; evidence: AIFindingEvidence[]; interpretation?: string }
export type AIAnalysis = {
  id: string
  diagnosticId: string
  executiveSummary: string
  diagnosis: string
  keyFindings: AIFinding[]
  foStrategies: string[]
  doStrategies: string[]
  faStrategies: string[]
  daStrategies: string[]
  priorityRisks: string[]
  priorityOpportunities: string[]
  recommendations: AIRecommendation[]
  /** Verdad si esta lectura se generó con la matriz DOFA que hay ahora. En false se corresponde a una
   *  versión anterior y hay que regenerarla antes de seguir usándola. */
  stale: boolean
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
  /** Decisión tomada sobre la estrategia del cruce en Checky. `null` = todavía no decidida. */
  strategyStatus: CheckySuggestionStatus | null
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
/** Fuentes de una estrategia consolidada. */
export type StrategySource = 'AI_ANALYSIS' | 'STRATEGIC_CROSS' | 'CHECKY'
/** Las tres fuentes se valoran con PUT /diagnostics/:id/strategies/weighting; la del cruce se
 *  guarda en StrategicCrossWeighting, la misma fila que usa la matriz DOFA. */
export type WeightableStrategySource = 'AI_ANALYSIS' | 'CHECKY' | 'STRATEGIC_CROSS'
/** Banda que clasifica el backend. El frontend solo la lee para elegir el color. */
export type StrategyBand = 'INMEDIATA' | 'CORTO_PLAZO' | 'MEDIANO_PLAZO' | 'LARGO_PLAZO'
export type StrategyFactorRef = { id: string; type: SWOTType; description: string }
/** Ponderación tal como la entrega el backend: los cinco niveles, el ponderado y su banda. */
export type StrategyWeighting = CrossWeightingCriteria & { weightedScore: number; weightingBand: StrategyBand }
export type DiagnosticStrategy = {
  id: string
  title: string
  description: string
  source: StrategySource
  crossId: string | null
  crossType: CrossType | null
  origin: CrossOrigin | null
  factor1: StrategyFactorRef | null
  factor2: StrategyFactorRef | null
  weighting: StrategyWeighting | null
  weightedScore: number | null
  weightingBand: StrategyBand | null
  /** Plan de acción asociado a esta estrategia, con sus tareas. Lo devuelve el GET de estrategias. */
  actionPlan: StrategyTaskPlan | null
}
export type StrategyTaskPlan = {
  id: string
  strategySource: string | null
  strategySourceRef: string | null
  strategyTitle: string | null
  strategyDescription: string | null
  items: Array<{
    id: string
    title: string
    status: ActionItemStatus
    responsibleId: string | null
    responsible: Pick<User, 'id' | 'name'> | null
    dueDate: string | null
    ticket: { id: string; status: TicketStatus } | null
  }>
}
export type StrategyWeightingResponse = { source: WeightableStrategySource; sourceRef: string } & StrategyWeighting

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
  strategySource: string | null
  strategySourceRef: string | null
  strategyTitle: string | null
  strategyDescription: string | null
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
  actionItem?: {
    id: string
    actionPlan: Pick<ActionPlan, 'id' | 'title' | 'strategySource' | 'strategySourceRef' | 'strategyTitle' | 'strategyDescription'>
  } | null
  /** Ciclo de aprobación que originó este ticket (0 o 1, porque RiskApproval.ticketId es único). */
  riskApprovals?: Array<{ id: string; riskId: string; risk: { id: string; code: string | null; name: string; processId: string } }>
}

export type ProcessType = 'STRATEGIC' | 'MISSIONAL' | 'SUPPORT'
/** Estado que guarda el backend. El mapa pinta su equivalente visual con ProcessStatus de la tarjeta. */
export type ProcessState = 'ACTIVE' | 'INACTIVE'

export type Process = {
  id: string
  companyId: string
  name: string
  code: string | null
  type: ProcessType
  version: string | null
  frequency: string | null
  organizationalArea: string | null
  supervision: string | null
  executionType: string | null
  objective: string
  description: string | null
  status: ProcessState
  thirdPartyProvided: boolean
  critical: boolean
  affectsAccounting: boolean
  personalData: boolean
  responsible: Pick<User, 'id' | 'name'> | null
  createdAt: string
  updatedAt: string
}

export type ProcessChangeValue = string | boolean | number | null
export type ProcessChangeItem = {
  field: string
  label: string
  previousValue: ProcessChangeValue
  newValue: ProcessChangeValue
}
export type ProcessChange = {
  id: string
  processId: string
  processName: string
  version: string
  action: 'CREATED' | 'UPDATED'
  changedBy: Pick<User, 'id' | 'name'> | null
  changedByName: string | null
  changedByEmail: string | null
  changedAt: string
  changes: ProcessChangeItem[]
}

// Historial del ciclo de vida de un riesgo (RiskAuditEvent). La API es cerrada: el backend solo
// emite estos tipos de evento y solo admite filtrar por ellos (append-only, sin escritura).
export type RiskAuditEventType =
  | 'RISK_CREATED'
  | 'RISK_UPDATED'
  | 'CONTROL_CREATED'
  | 'CONTROL_UPDATED'
  | 'CONTROL_DELETED'
  | 'EVIDENCE_CREATED'
  | 'EVIDENCE_UPDATED'
  | 'EVIDENCE_DELETED'
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_DECIDED'
  | 'APPROVAL_OUTDATED'
  | 'TICKET_CREATED'
  | 'TICKET_STATUS_CHANGED'

export type RiskAuditMetadata = {
  approvalId?: string
  ticketId?: string
  controlId?: string
  evidenceId?: string
  decision?: 'APPROVED' | 'REJECTED'
  comment?: string
  previousStatus?: string
  status?: string
}

export type RiskAuditEvent = {
  id: string
  riskId: string
  eventType: RiskAuditEventType
  summary: string
  actorId: string | null
  actor: Pick<User, 'id' | 'name'> | null
  actorName: string | null
  actorEmail: string | null
  occurredAt: string
  changes: ProcessChangeItem[]
  metadata: RiskAuditMetadata | null
}

export type ProcessKpi = {
  id: string
  processId: string
  companyId: string
  name: string
  description: string
  frequency: string
  target: string
  formula: string
  dataSource: string
  unit: string
  reportResponsible: Pick<User, 'id' | 'name'> | null
  monitorResponsible: Pick<User, 'id' | 'name'> | null
  greenThreshold: string | null
  yellowThreshold: string | null
  redThreshold: string | null
  createdAt: string
  updatedAt: string
}

// Estados documentales del procedimiento, espejo de ProcedureStatus. Solo DRAFT es editable;
// APPROVED se conserva siempre en el historial de versiones.
export type ProcedureStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'OBSOLETE'

export type ProcedureHistoryAction = 'CREATED' | 'UPDATED' | 'STATUS_CHANGED'

export type Procedure = {
  id: string
  processId: string
  companyId: string
  code: string
  name: string
  objective: string
  scope: string
  description: string | null
  responsible: Pick<User, 'id' | 'name'> | null
  status: ProcedureStatus
  version: string
  createdAt: string
  updatedAt: string
}

// Historial append-only de versiones del procedimiento: solo lo escribe el backend y solo se lee.
export type ProcedureVersion = {
  id: string
  procedureId: string
  version: string
  status: ProcedureStatus
  action: ProcedureHistoryAction
  changes: ProcessChangeItem[]
  snapshot: Record<string, unknown> | null
  changedById: string | null
  changedBy: Pick<User, 'id' | 'name'> | null
  changedByName: string | null
  changedByEmail: string | null
  changedAt: string
}

// ---- Módulo Auditorías de calidad (Trazabilidad y Control / Seguimiento y evidencia) ----
// No confundir con RiskAuditEvent (auditoría del sistema del ciclo de vida de un riesgo).

export type AuditStatus = 'PLANNED' | 'IN_PROGRESS' | 'CLOSED' | 'CANCELLED'
export type AuditFindingType = 'NONCONFORMITY' | 'OBSERVATION' | 'OPPORTUNITY'
export type AuditFindingSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR'
export type AuditFindingStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'VERIFIED'
export type AuditEventType =
  | 'AUDIT_CREATED'
  | 'AUDIT_UPDATED'
  | 'STATUS_CHANGED'
  | 'FINDING_CREATED'
  | 'FINDING_UPDATED'
  | 'FINDING_STATUS_CHANGED'
  | 'FINDING_DELETED'
  | 'EVIDENCE_CREATED'
  | 'EVIDENCE_UPDATED'
  | 'EVIDENCE_DELETED'

export type AuditFinding = {
  id: string
  auditId: string
  title: string
  description: string
  type: AuditFindingType
  severity: AuditFindingSeverity
  status: AuditFindingStatus
  dueDate: string | null
  responsible: Pick<User, 'id' | 'name'> | null
  resolution: string | null
  verifiedBy: Pick<User, 'id' | 'name'> | null
  verifiedAt: string | null
  createdAt: string
  updatedAt: string
}

export type AuditEvidence = {
  id: string
  auditId: string
  findingId: string | null
  name: string
  description: string
  url: string
  createdAt: string
  updatedAt: string
}

export type Audit = {
  id: string
  processId: string
  companyId: string
  code: string
  title: string
  auditType: string | null
  scope: string
  objectives: string | null
  criteria: string
  status: AuditStatus
  plannedDate: string | null
  startDate: string | null
  endDate: string | null
  summary: string | null
  leadAuditor: Pick<User, 'id' | 'name'> | null
  responsible: Pick<User, 'id' | 'name'> | null
  findings: AuditFinding[]
  evidences: AuditEvidence[]
  createdAt: string
  updatedAt: string
}

// Historial append-only del ciclo de vida de una auditoría de calidad: solo lo escribe el backend.
export type AuditEvent = {
  id: string
  auditId: string
  eventType: AuditEventType
  summary: string
  actorId: string | null
  actor: Pick<User, 'id' | 'name'> | null
  actorName: string | null
  actorEmail: string | null
  occurredAt: string
  changes: ProcessChangeItem[]
  metadata: Record<string, unknown> | null
}

export type ProcessSipocItem = {
  id: string
  processId: string
  description: string
  createdAt: string
  updatedAt: string
}

export type ProcessSipoc = {
  suppliers: ProcessSipocItem[]
  inputs: ProcessSipocItem[]
  processes: ProcessSipocItem[]
  outputs: ProcessSipocItem[]
  customers: ProcessSipocItem[]
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'
export type RiskControlEvaluation = 'PENDING' | 'WEAK' | 'PARTIAL' | 'EFFECTIVE'
export type RiskType = 'ESTRATEGICO' | 'MISIONAL' | 'APOYO'
export type RiskAcceptanceStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED'
export type RiskTreatment = 'AVOID' | 'MITIGATE' | 'TRANSFER' | 'ACCEPT'
export type ProcessRiskControl = {
  id: string
  riskId: string
  description: string
  evaluation: RiskControlEvaluation
  createdAt: string
  updatedAt: string
}
export type ProcessRiskEvidence = {
  id: string
  riskId: string
  name: string
  description: string
  url: string
  createdAt: string
  updatedAt: string
}

// Estado del ciclo de aprobación colaborativa (flujo del dueño). Es independiente del veredicto
// formal acceptanceStatus: aquí se guarda quién pidió, quién decidió, cuándo y con qué comentario.
export type RiskApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'OUTDATED'
export type RiskApprovalSummary = {
  id: string
  status: RiskApprovalStatus
  requestedAt: string
  decidedBy: Pick<User, 'id' | 'name'> | null
  decidedAt: string | null
  comment: string | null
  ticketId: string | null
}
export type RiskApproval = {
  id: string
  riskId: string
  status: RiskApprovalStatus
  requestedBy: Pick<User, 'id' | 'name'>
  requestedAt: string
  decidedBy: Pick<User, 'id' | 'name'> | null
  decidedAt: string | null
  comment: string | null
  ticket: { id: string; title: string; status: TicketStatus } | null
  risk: {
    id: string
    code: string | null
    name: string
    description: string
    acceptanceStatus: RiskAcceptanceStatus
    treatment: RiskTreatment | null
    riskOwner: Pick<User, 'id' | 'name'> | null
    inherentImpact: number
    inherentProbability: number
    inherentScore: number
    inherentLevel: RiskLevel
    residualImpact: number
    residualProbability: number
    residualScore: number
    residualLevel: RiskLevel
    controls: ProcessRiskControl[]
    process: { id: string; name: string; code: string | null }
  }
}
// Notificación in-app persistente: el link apunta a la sección que debe abrirse ("approvals/<id>").
export type AppNotification = {
  id: string
  title: string
  body: string
  link: string
  readAt: string | null
  createdAt: string
}
export type ProcessRisk = {
  id: string
  processId: string
  name: string
  description: string
  /**
   * Copia del tipo del proceso asociado, escrita solo por el backend. Es `string` (no RiskType)
   * porque los riesgos antiguos pueden conservar textos legados como «Operativo»; el formulario
   * no lo lee para pintar el campo, que muestra la categoría derivada del proceso.
   */
  riskType: string
  code: string | null
  riskOwner: Pick<User, 'id' | 'name'> | null
  acceptanceStatus: RiskAcceptanceStatus
  treatment: RiskTreatment | null
  mitigationOwner: Pick<User, 'id' | 'name'> | null
  mitigationStartDate: string | null
  mitigationDueDate: string | null
  inherentImpact: number
  inherentProbability: number
  inherentScore: number
  inherentLevel: RiskLevel
  residualImpact: number
  residualProbability: number
  residualScore: number
  residualLevel: RiskLevel
  controls: ProcessRiskControl[]
  evidences: ProcessRiskEvidence[]
  /** Último ciclo de aprobación del riesgo (null si nunca se envió a revisión). */
  approval: RiskApprovalSummary | null
  createdAt: string
  updatedAt: string
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
