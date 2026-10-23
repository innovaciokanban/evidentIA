import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import { createHash } from 'node:crypto'
import cors from 'cors'
import { z } from 'zod'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { ActionItemStatus, Prisma, PrismaClient, Priority, CrossOrigin, CrossType, CheckyCategory, CheckyFindingBasis, ProcessType, ProcedureHistoryAction, ProcedureStatus, Role, AuditChecklistResult, AuditCorrectiveActionStatus, AuditEventType, AuditFindingStatus, AuditStatus, RiskAuditEventType, TicketPriority, TicketStatus } from '@prisma/client'
import { env } from './env.js'
import { prisma } from './prisma.js'
import { authenticate, clearSessionCookie, createSession, publicUser, requireRole } from './auth.js'
import { AIService, AIServiceError, resolveWeightingBand, sanitizeAIAnalysisResult, sanitizeCheckyResult, type CheckyConsultResult, type CheckyConsolidatedStrategy, type CheckyContext, type CheckyWeighting, type CrossAnalysisResult, type GeneratedCrossForAI } from './ai-service.js'
import { getDashboardData } from './dashboard-service.js'
import { calculateWeightedScore, WEIGHTING_LEVEL_SCORE } from './weighting-service.js'
import { AI_STRATEGY_QUADRANTS, collectStrategies, readAiStrategyTexts, type AiStrategySource, type CheckyStrategySource, type CrossStrategySource, type StrategyFactor, type StrategyForPrioritization } from './strategies-service.js'
import { indexStrategyWeightings, normalizeStrategyText, strategySourceRef, strategyWeightingUpsertData, strategyWeightingView } from './strategy-weighting-service.js'
import { checkyEvidenceWithPair, filterCheckySuggestions, requiresCheckyCrossPair, resolveCheckyCrossPair, type CheckyCrossPair, type CheckyCrossRef } from './checky-cross.js'
import { sanitizeTextWithSwotItems, type SwotTextItem } from './text-sanitization.js'
import { riskLevelFor, riskScoreFor } from './risk-matrix.js'
import { mitigationCompletedNotification, mitigationNotificationRecipients, mitigationPlansCompleted, riskResidualSectionLink } from './mitigation-plan.js'
import { assertMitigationEvidence, MitigationEvidenceRequiredError } from './mitigation-evidence.js'
import { EvidenceValidationError, nextStoredName, readEvidenceFile, removeEvidenceFiles, validateEvidenceUpload, writeEvidenceFile } from './evidence-storage.js'
import { findMultipartFile, MultipartError, MAX_UPLOAD_REQUEST_BYTES, parseMultipartFormData, readRequestBuffer, sanitizeUploadFilename } from './multipart.js'
import { actionItemCreateSchema, actionItemUpdateSchema, actionPlanCreateSchema, actionPlanUpdateSchema, aiAnalysisSchema, auditActionProgressCreateSchema, auditChecklistCreateSchema, auditChecklistItemCreateSchema, auditChecklistItemUpdateSchema, auditChecklistUpdateSchema, auditCorrectiveActionCreateSchema, auditCorrectiveActionStatusChangeSchema, auditCorrectiveActionUpdateSchema, auditCreateSchema, auditEvidenceCreateSchema, auditEvidenceUpdateSchema, auditFindingCreateSchema, auditFindingStatusChangeSchema, auditFindingUpdateSchema, auditHistoryQuerySchema, auditQuerySchema, auditRelationsUpdateSchema, auditStatusChangeSchema, auditUpdateSchema, checkyMessageCreateSchema, checkySessionCreateSchema, checkySuggestionDecisionSchema, companyCreateSchema, companyQuerySchema, companyUpdateSchema, crossAnalyzeSchema, crossAnalysisSchema, crossCreateSchema, crossTypeFor, crossUpdateSchema, crossWeightingSchema, diagnosticCreateSchema, diagnosticUpdateSchema, idReference, kpiCreateSchema, kpiQuerySchema, kpiUpdateSchema, loginSchema, mitigationActivityCreateSchema, processCreateSchema, processQuerySchema, processUpdateSchema, procedureCreateSchema, procedureHistoryQuerySchema, procedureQuerySchema, procedureStatusChangeSchema, procedureUpdateSchema, recommendationUpdateSchema, riskApprovalDecisionSchema, riskApprovalQuerySchema, riskAuditQuerySchema, riskControlCreateSchema, riskControlUpdateSchema, riskCreateSchema, riskEvidenceCreateSchema, riskEvidenceUpdateSchema, riskUpdateSchema, sipocItemCreateSchema, sipocItemUpdateSchema, sipocKindSchema, strategyTasksCreateSchema, strategyWeightingSchema, swotItemCreateSchema, swotItemUpdateSchema, ticketCreateSchema, ticketQuerySchema, ticketUpdateSchema, userCreateSchema, userUpdateSchema } from './validation.js'

const asyncHandler = (handler: RequestHandler): RequestHandler => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)

const DUMMY_PASSWORD_HASH = '$2b$12$UjBgyzK627Qyclju5Vdtne3rVrXxGDHxvGqnZahRh5D9geupYld9y'

const userInclude = { createdBy: { select: { id: true, name: true, email: true, companyId: true } }, assignedTo: { select: { id: true, name: true, email: true, companyId: true } } } as const
const companyInclude = { users: { where: { role: Role.COMPANY_ADMIN }, select: { id: true, name: true, email: true, role: true, companyId: true }, take: 1 } } as const
const companyView = (company: Prisma.CompanyGetPayload<{ include: typeof companyInclude }>) => ({ id: company.id, name: company.name, identification: company.identification, industry: company.industry, description: company.description, admin: company.users[0] ?? null, createdAt: company.createdAt, updatedAt: company.updatedAt })
const diagnosticInclude = { company: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true, email: true } }, swotAnalysis: { include: { items: { orderBy: { createdAt: 'asc' } } } } } as const
const diagnosticView = (diagnostic: Prisma.QualityDiagnosticGetPayload<{ include: typeof diagnosticInclude }>) => diagnostic
const swotItemAccessInclude = { swot: { include: { diagnostic: { select: { companyId: true, company: { select: { id: true } } } } } } } as const
const swotItemView = (item: Prisma.SWOTItemGetPayload<{ include: typeof swotItemAccessInclude }>) => ({ id: item.id, swotId: item.swotId, type: item.type, description: item.description, createdAt: item.createdAt })
type StoredAIAnalysis = { id: string; diagnosticId: string; executiveSummary: string; diagnosis: string; keyFindings: unknown; foStrategies: unknown; doStrategies: unknown; faStrategies: unknown; daStrategies: unknown; priorityRisks: unknown; priorityOpportunities: unknown; recommendations: unknown; swotFingerprint: string | null; createdAt: Date; updatedAt: Date }

/**
 * Huella de la matriz DOFA que se usó para escribir una lectura estratégica.
 *
 * Los timestamps de `SWOTItem` no sirven para esto: no hay `updatedAt` y, aunque lo hubiera, editar un
 * factor y volverlo a dejar como estaba dejaría el mismo rastro. Lo que se compara es el contenido,
 * así que cualquier edición, alta o borrado de un factor produce una huella distinta. Va ordenada por
 * id para que la huella dependa de qué factores hay, no del orden en que se listaron.
 */
export const swotFingerprint = (items: Array<{ id: string; type: string; description: string }>): string =>
  createHash('sha256').update(items.map((item) => `${item.id}\u0000${item.type}\u0000${item.description.trim()}`).sort().join('\u0001')).digest('hex')

/**
 * Lectura estratégica tal como la consume la app.
 *
 * Añade dos cosas sobre la fila guardada. `stale` dice si esta lectura se escribió con una matriz
 * distinta de la que hay ahora: es la diferencia entre "esto es lo que concluyó la IA" y "esto
 * describe una matriz que el usuario ya cambió". Y cada inferencia lleva su evidencia ya resuelta
 * contra la matriz actual, porque un id suelto no le dice nada a quien no conoce la DOFA: lo que se lee
 * es "Debilidad: Falta de documentación". Los ids que no resuelven no se inventan ni se muestran, se
 * descartan, igual que hace Checky con sus referencias.
 */
const aiAnalysisView = (
  analysis: StoredAIAnalysis,
  items: Array<{ id: string; type: string; description: string }>,
  currentFingerprint: string,
) => {
  const itemById = new Map(items.map((item) => [item.id, item]))
  const parsed = aiAnalysisSchema.parse({ executiveSummary: analysis.executiveSummary, diagnosis: analysis.diagnosis, keyFindings: analysis.keyFindings, foStrategies: analysis.foStrategies, doStrategies: analysis.doStrategies, faStrategies: analysis.faStrategies, daStrategies: analysis.daStrategies, priorityRisks: analysis.priorityRisks, priorityOpportunities: analysis.priorityOpportunities, recommendations: analysis.recommendations })
  const sanitized = sanitizeAIAnalysisResult(parsed, items)
  return {
    id: analysis.id,
    diagnosticId: analysis.diagnosticId,
    ...sanitized,
    keyFindings: sanitized.keyFindings.map((finding) => {
      // Lo que se cita tiene que existir en la matriz. Un id que ya no resuelve porque el factor se
      // borró se cae, y con él cae la etiqueta: es preferible no tener evidencia a tener una que
      // apunte a nada.
      const cited = [...new Set(finding.evidenceIds)].flatMap((id) => {
        const item = itemById.get(id)
        return item ? [{ id: item.id, type: item.type, description: item.description }] : []
      })
      return { ...finding, evidenceIds: cited.map((item) => item.id), evidence: cited.map(({ type, description }) => ({ type, description })) }
    }),
    stale: analysis.swotFingerprint !== currentFingerprint,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
  }
}
const recommendationView = (recommendation: { id: string; diagnosticId: string; title: string; description: string; priority: string; expectedImpact: string; suggestedAction: string; status: string; createdAt: Date; updatedAt: Date }) => recommendation
const sanitizedRecommendationView = (recommendation: Parameters<typeof recommendationView>[0], items: readonly SwotTextItem[]) => ({
  ...recommendationView(recommendation),
  title: sanitizeTextWithSwotItems(recommendation.title, items),
  description: sanitizeTextWithSwotItems(recommendation.description, items),
  expectedImpact: sanitizeTextWithSwotItems(recommendation.expectedImpact, items),
  suggestedAction: sanitizeTextWithSwotItems(recommendation.suggestedAction, items),
})
const actionItemInclude = { recommendation: { select: { id: true, title: true, priority: true, status: true } }, responsible: { select: { id: true, name: true, email: true } }, ticket: { select: { id: true } } } as const
const actionItemView = (item: Prisma.ActionItemGetPayload<{ include: typeof actionItemInclude }>) => item
const actionPlanInclude = { createdBy: { select: { id: true, name: true, email: true } }, items: { include: actionItemInclude, orderBy: { createdAt: 'asc' as const } } } as const
const actionPlanView = (plan: Prisma.ActionPlanGetPayload<{ include: typeof actionPlanInclude }>) => plan
const ticketInclude = {
  ...userInclude,
  actionItem: {
    select: {
      id: true,
      actionPlan: { select: { id: true, title: true, strategySource: true, strategySourceRef: true, strategyTitle: true, strategyDescription: true } },
    },
  },
  // Como RiskApproval.ticketId es único, un ticket pertenece a como mucho un ciclo de aprobación
  // (la lista tiene 0 o 1 elementos) y sirve de referencia navegable al riesgo de origen.
  riskApprovals: { select: { id: true, riskId: true, risk: { select: { id: true, code: true, name: true, processId: true } } } },
} as const
const ticketView = (ticket: Prisma.TicketGetPayload<{ include: typeof ticketInclude }>) => ticket
// Vista de una evidencia PDF de ticket. No expone storedName (el nombre en disco es interno del
// servidor y no aporta nada al cliente), y trae el ticket y el subidor para poder mostrar la
// evidencia también desde la lista por plan de mitigación.
const evidenceInclude = {
  uploadedBy: { select: { id: true, name: true } },
  ticket: { select: { id: true, title: true } },
} as const
const evidenceView = (evidence: Prisma.TicketEvidenceFileGetPayload<{ include: typeof evidenceInclude }>) => ({
  id: evidence.id,
  ticketId: evidence.ticketId,
  filename: evidence.filename,
  mimeType: evidence.mimeType,
  size: evidence.size,
  createdAt: evidence.createdAt,
  uploadedBy: evidence.uploadedBy,
  ticket: evidence.ticket,
})
const crossInclude = { factor1: true, factor2: true } as const
const crossFactorView = (item: { id: string; swotId: string; type: string; description: string; createdAt: Date }) => ({ id: item.id, swotId: item.swotId, type: item.type, description: item.description, createdAt: item.createdAt })
const crossView = (cross: Prisma.StrategicCrossGetPayload<{ include: typeof crossInclude }>) => ({
  id: cross.id,
  diagnosticId: cross.diagnosticId,
  crossType: cross.crossType,
  origin: cross.origin,
  factor1: crossFactorView(cross.factor1),
  factor2: crossFactorView(cross.factor2),
  strategy: cross.strategy === null ? null : sanitizeTextWithSwotItems(cross.strategy, [cross.factor1, cross.factor2]),
  strategyStatus: cross.strategyStatus,
  aiAnalysis: (() => {
    const parsed = cross.aiAnalysis ? crossAnalysisSchema.safeParse(cross.aiAnalysis) : null
    if (!parsed?.success) return null
    return sanitizeCrossAnalysis(parsed.data, [cross.factor1, cross.factor2])
  })(),
  priority: cross.priority,
  createdById: cross.createdById,
  createdAt: cross.createdAt,
  updatedAt: cross.updatedAt,
})

const weightingView = (weighting: { id: string; crossId: string; impactoEstrategico: string; viabilidad: string; urgencia: string; sinergiaInterna: string; impactoReputacional: string; weightedScore: number; createdById: string; createdAt: Date; updatedAt: Date }) => ({
  id: weighting.id,
  crossId: weighting.crossId,
  impactoEstrategico: weighting.impactoEstrategico,
  viabilidad: weighting.viabilidad,
  urgencia: weighting.urgencia,
  sinergiaInterna: weighting.sinergiaInterna,
  impactoReputacional: weighting.impactoReputacional,
  weightedScore: weighting.weightedScore,
  createdById: weighting.createdById,
  createdAt: weighting.createdAt,
  updatedAt: weighting.updatedAt,
})

/**
 * Relación que necesita Checky para leer cruces, sus dos factores y su ponderación en una sola
 * consulta. No añade ningún campo a la respuesta de la ruta de cruces: solo sirve al contexto.
 */
const checkyCrossInclude = { factor1: true, factor2: true, weighting: true } as const

/**
 * Traduce las filas de strategicCross con su ponderación incluida al shape que consume Checky.
 * Solo se lee lo que ya está en la BD: weightedScore se copia sin tocarlo y weightingBand se
 * deduce de ese número con los mismos rangos que ve el usuario en pantalla.
 */
const checkyWeightingsFromCrosses = (crosses: Array<Prisma.StrategicCrossGetPayload<{ include: typeof checkyCrossInclude }>>): CheckyWeighting[] => {
  const factorRef = (factor: { id: string; type: string; description: string }) => ({ id: factor.id, type: factor.type, description: factor.description })
  return crosses.flatMap((cross) => {
    if (!cross.weighting) return []
    return [{
      crossId: cross.id,
      crossType: cross.crossType,
      origin: cross.origin,
      strategy: cross.strategy,
      weightedScore: cross.weighting.weightedScore,
      weightingBand: resolveWeightingBand(cross.weighting.weightedScore),
      criteria: {
        impactoEstrategico: cross.weighting.impactoEstrategico,
        viabilidad: cross.weighting.viabilidad,
        urgencia: cross.weighting.urgencia,
        sinergiaInterna: cross.weighting.sinergiaInterna,
        impactoReputacional: cross.weighting.impactoReputacional,
      },
      factors: [factorRef(cross.factor1), factorRef(cross.factor2)],
    }]
  })
}

const checkySessionView = (session: { id: string; diagnosticId: string; title: string | null; createdById: string; createdAt: Date; updatedAt: Date }) => ({
  id: session.id,
  diagnosticId: session.diagnosticId,
  title: session.title,
  createdById: session.createdById,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
})

const checkyMessageView = (message: { id: string; sessionId: string; role: string; content: string; category: string | null; basis: string | null; evidenceIds: string[]; insufficientData: boolean; missingInformation: string[]; status: string | null; decisionNote: string | null; suggestedStrategyTitle: string | null; suggestedStrategyDescription: string | null; createdAt: Date }, swotItems: readonly SwotTextItem[] = []) => ({
  id: message.id,
  sessionId: message.sessionId,
  role: message.role,
  content: message.role === 'CHECKY' ? sanitizeTextWithSwotItems(message.content, swotItems) : message.content,
  category: message.category,
  basis: message.basis,
  evidenceIds: message.evidenceIds ?? [],
  insufficientData: message.insufficientData,
  missingInformation: (message.missingInformation ?? []).map((text) => sanitizeTextWithSwotItems(text, swotItems)),
  status: message.status,
  decisionNote: message.decisionNote,
  suggestedStrategyTitle: message.suggestedStrategyTitle == null ? null : sanitizeTextWithSwotItems(message.suggestedStrategyTitle, swotItems),
  suggestedStrategyDescription: message.suggestedStrategyDescription == null ? null : sanitizeTextWithSwotItems(message.suggestedStrategyDescription, swotItems),
  createdAt: message.createdAt,
})

/**
 * Traduce la lista consolidada de estrategias al shape que consume Checky. Es la misma lectura que
 * usa GET /diagnostics/:id/strategies, así que Checky ve exactamente la priorización que el usuario
 * tiene en pantalla: las tres fuentes, con su ponderado y su banda ya guardados, y en null cuando
 * todavía no están valoradas.
 *
 * factorIds solo lleva ids reales del diagnóstico, y son los únicos que el contrato admite como
 * evidencia junto a crossId. Una estrategia de IA no tiene cruces ni factores, y por eso llega con
 * las dos en null: Checky puede leer sus números, pero no tiene ningún id que citar sobre ella.
 */
const checkyStrategiesFrom = (strategies: StrategyForPrioritization[]): CheckyConsolidatedStrategy[] =>
  strategies.map((strategy) => ({
    strategyRef: strategy.id,
    source: strategy.source,
    title: strategy.title,
    description: strategy.description,
    crossId: strategy.crossId,
    crossType: strategy.crossType,
    origin: strategy.origin,
    factorIds: [strategy.factor1?.id, strategy.factor2?.id].filter((id): id is string => typeof id === 'string'),
    weightedScore: strategy.weightedScore,
    weightingBand: strategy.weightingBand,
    criteria: strategy.weighting
      ? {
          impactoEstrategico: strategy.weighting.impactoEstrategico,
          viabilidad: strategy.weighting.viabilidad,
          urgencia: strategy.weighting.urgencia,
          sinergiaInterna: strategy.weighting.sinergiaInterna,
          impactoReputacional: strategy.weighting.impactoReputacional,
        }
      : null,
  }))

const buildCheckyContext = async (db: PrismaClient, diagnostic: { id: string; title: string; description: string; status: string }, question: string): Promise<CheckyContext> => {
  const stored = await db.qualityDiagnostic.findUnique({ where: { id: diagnostic.id }, include: { swotAnalysis: { include: { items: { orderBy: { createdAt: 'asc' } } } } } })
  const items = stored?.swotAnalysis?.items ?? []
  // Los factores y las ponderaciones entran por la misma consulta que los cruces, así que el
  // alcance multiempresa es el mismo where diagnosticId que ya autoriza la ruta: no hay forma de
  // traer la ponderación de un cruce ajeno. weightedScore se copia tal cual, sin recalcularlo.
  // loadDiagnosticStrategies reutiliza la consolidación de la priorización, acotada al mismo
  // diagnóstico, para que Checky y la pantalla no puedan ver dos listas distintas.
  const [crosses, analysis, recommendations, strategies] = await Promise.all([
    db.strategicCross.findMany({ where: { diagnosticId: diagnostic.id }, orderBy: { updatedAt: 'desc' }, include: { factor1: true, factor2: true, weighting: true } }),
    db.aIAnalysis.findUnique({ where: { diagnosticId: diagnostic.id } }),
    db.recommendation.findMany({ where: { diagnosticId: diagnostic.id }, select: { title: true, priority: true, status: true } }),
    loadDiagnosticStrategies(db, diagnostic.id),
  ])
  return {
    question,
    diagnostic: { title: diagnostic.title, description: diagnostic.description, status: diagnostic.status },
    swotItems: items.map((item) => ({ id: item.id, type: item.type, description: item.description })),
    crosses: crosses.map((cross) => ({ id: cross.id, crossType: cross.crossType, origin: cross.origin, factor1Id: cross.factor1Id, factor2Id: cross.factor2Id, strategy: cross.strategy })),
    aiAnalysis: analysis
      ? { executiveSummary: analysis.executiveSummary, keyFindings: analysis.keyFindings, priorityRisks: analysis.priorityRisks, priorityOpportunities: analysis.priorityOpportunities }
      : null,
    recommendations: recommendations.map((item) => ({ title: item.title, priority: item.priority, status: item.status })),
    weightings: checkyWeightingsFromCrosses(crosses),
    strategies: checkyStrategiesFrom(strategies),
  }
}

const scopeForUser = (request: Request): Prisma.TicketWhereInput => request.user?.role === Role.SUPERUSER ? {} : { OR: [{ createdBy: { companyId: request.user?.companyId ?? 'none' } }, { assignedTo: { companyId: request.user?.companyId ?? 'none' } }] }

/**
 * La evidencia de la pareja queda escrita siempre con los dos ids de factor resueltos, además de
 * cualquier id citado (el de un cruce, por ejemplo). La tarjeta de Checky pinta la pareja a partir de
 * los factores reales, así que con solo el id del cruce la pantalla no podría mostrar qué DOFA combina.
 * Sirve tanto para la fila recién escrita como para registros antiguos al leerlos.
 */
const withPairedCheckyEvidence = <T extends { evidenceIds: readonly string[] }>(message: T, crosses: readonly CheckyCrossRef[], factors: readonly { id: string; type: string; description?: string | null }[]): T => {
  const expanded = message.evidenceIds.flatMap((id) => {
    const cross = crosses.find((candidate) => candidate.id === id)
    if (!cross) return []
    const first = factors.find((factor) => factor.id === cross.factor1Id)
    const second = factors.find((factor) => factor.id === cross.factor2Id)
    return first && second ? [first.id, second.id] : []
  })
  const evidenceIds = [...message.evidenceIds]
  for (const id of expanded) {
    if (!evidenceIds.includes(id)) evidenceIds.push(id)
  }
  return evidenceIds.length === message.evidenceIds.length ? message : { ...message, evidenceIds } as T
}

/**
 * Gate de persistencia de las sugerencias de Checky: antes de escribir nada se comprueba que cada
 * sugerencia que pretende ser estrategia tenga detrás una pareja DOFA válida entre dos factores
 * reales de este diagnóstico, y se descarta la que no lo tenga. Una pareja que ya existe como
 * StrategicCross no se descarta: se conserva y se escribe relacionada con ese cruce, que es la
 * fuente de verdad, para que la aceptación lo reutilice en vez de crear otro.
 *
 * Los factores se cargan acotados a este diagnóstico con el mismo where que usa la aceptación, así
 * que un id de otra empresa no puede construir una pareja. Los cruces ya vienen del contexto de la
 * misma sesión. Además, la evidencia persistida se deja siempre con los dos ids de factor resueltos.
 */
const usableCheckyFindings = async (db: PrismaClient, diagnosticId: string, findings: CheckyConsultResult['findings'], crosses: readonly CheckyCrossRef[]): Promise<CheckyConsultResult['findings']> => {
  const ids = [...new Set([...findings.flatMap((finding) => finding.evidenceIds), ...crosses.flatMap((cross) => [cross.factor1Id, cross.factor2Id])])]
  const factors = ids.length > 0
    ? await db.sWOTItem.findMany({ where: { id: { in: ids }, swot: { diagnosticId } }, select: { id: true, type: true, description: true } })
    : []
  const usable = filterCheckySuggestions(findings, factors, crosses)
  return usable.map((finding) => {
    const pair: CheckyCrossPair | null = resolveCheckyCrossPair(finding, factors, crosses)
    return pair ? { ...finding, evidenceIds: checkyEvidenceWithPair(finding.evidenceIds, pair) } : finding
  })
}

/**
 * Lectura de la sesión compartida por la consulta y el GET: vuelve a aplicar la regla de la pareja
 * DOFA, así que una sugerencia de estrategia sin pareja válida no se muestra aunque esté guardada,
 * y la evidencia se desdobla en los dos factores de la pareja para que la tarjeta pueda pintarla.
 * El resto de mensajes (el de usuario y la respuesta de Checky) no compite con la matriz, así que se
 * conservan siempre.
 */
const visibleCheckyMessages = <T extends { id: string; role: string; category: string | null; evidenceIds: readonly string[] }>(messages: readonly T[], factors: readonly { id: string; type: string; description: string }[], crosses: readonly CheckyCrossRef[]): T[] => {
  const withEvidence = messages.map((message) => withPairedCheckyEvidence(message, crosses, factors))
  const visibleSuggestionIds = new Set(filterCheckySuggestions(withEvidence.filter((message) => message.role === 'CHECKY' && message.category), factors, crosses).map((message) => message.id))
  return withEvidence.filter((message) => !(message.role === 'CHECKY' && message.category) || visibleSuggestionIds.has(message.id))
}

const canAccessTicket = (request: Request, ticket: { createdBy: { companyId: string | null } | null; assignedTo: { companyId: string | null } | null }) => request.user?.role === Role.SUPERUSER || ticket.createdBy?.companyId === request.user?.companyId || ticket.assignedTo?.companyId === request.user?.companyId
const scopeForCompany = (request: Request): Prisma.CompanyWhereInput => request.user?.role === Role.SUPERUSER ? {} : { id: request.user?.companyId ?? 'none' }
const canAccessCompany = (request: Request, company: { id: string }) => request.user?.role === Role.SUPERUSER || company.id === request.user?.companyId

const processInclude = { company: { select: { id: true } }, responsible: { select: { id: true, name: true } } } as const
const processView = (process: Prisma.ProcessGetPayload<{ include: typeof processInclude }>) => ({
  id: process.id,
  companyId: process.companyId,
  name: process.name,
  code: process.code,
  type: process.type,
  version: process.version,
  frequency: process.frequency,
  organizationalArea: process.organizationalArea,
  supervision: process.supervision,
  executionType: process.executionType,
  objective: process.objective,
  description: process.description,
  status: process.status,
  thirdPartyProvided: process.thirdPartyProvided,
  critical: process.critical,
  affectsAccounting: process.affectsAccounting,
  personalData: process.personalData,
  responsible: process.responsible,
  createdAt: process.createdAt,
  updatedAt: process.updatedAt,
})
const processChangeInclude = { changedBy: { select: { id: true, name: true } } } as const
const processChangeView = (change: Prisma.ProcessChangeGetPayload<{ include: typeof processChangeInclude }>) => ({
  id: change.id,
  processId: change.processId,
  processName: change.processName,
  version: change.version,
  action: change.action,
  changedBy: change.changedBy,
  changedByName: change.changedByName,
  changedByEmail: change.changedByEmail,
  changedAt: change.changedAt,
  changes: Array.isArray(change.changes) ? change.changes : [],
})

const processCodePrefixes: Record<ProcessType, string> = {
  STRATEGIC: 'PRO-EST',
  MISSIONAL: 'PRO-MIS',
  SUPPORT: 'PRO-APO',
}
const processCodePattern = /^PRO-(EST|MIS|APO)-(\d{3,})$/
const processCodeLocks = new Map<string, Promise<void>>()

export const nextProcessCode = (type: ProcessType, codes: readonly (string | null | undefined)[]): string => {
  const prefix = processCodePrefixes[type]
  const typeCode = prefix.slice(4)
  const usedNumbers = new Set(
    codes.flatMap((code) => {
      const match = code?.match(processCodePattern)
      return match?.[1] === typeCode ? [Number(match[2])] : []
    }),
  )
  let nextNumber = 1
  while (usedNumbers.has(nextNumber)) nextNumber += 1
  return `${prefix}-${String(nextNumber).padStart(3, '0')}`
}

const processVersionPattern = /^(\d+)(\.\d+)?$/

export const nextProcessVersion = (version: string | null | undefined): string => {
  const current = version?.trim()
  if (!current) return '1.0'
  const match = current.match(processVersionPattern)
  if (!match) return '1.0'
  return `${Number(match[1]) + 1}${match[2] ?? '.0'}`
}

async function withProcessCodeLock<T>(companyId: string, work: () => Promise<T>): Promise<T> {
  const previous = processCodeLocks.get(companyId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  processCodeLocks.set(companyId, current)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (processCodeLocks.get(companyId) === current) processCodeLocks.delete(companyId)
  }
}

const processChangeFields = [
  'name', 'objective', 'description', 'frequency', 'organizationalArea', 'supervision', 'executionType',
  'status', 'responsibleId', 'thirdPartyProvided', 'critical', 'affectsAccounting', 'personalData',
] as const
const processCreationFields = ['code', 'type', ...processChangeFields] as const
const processChangeLabels: Record<(typeof processCreationFields)[number], string> = {
  code: 'Código',
  type: 'Tipo de proceso',
  name: 'Nombre',
  objective: 'Objetivo',
  description: 'Descripción',
  frequency: 'Frecuencia',
  organizationalArea: 'Área organizacional',
  supervision: 'Supervisión',
  executionType: 'Tipo de ejecución',
  status: 'Estado',
  responsibleId: 'Responsable',
  thirdPartyProvided: 'Provisto por tercero',
  critical: 'Proceso crítico',
  affectsAccounting: 'Afecta contabilidad',
  personalData: 'Datos personales',
}
type ProcessChangeValue = string | boolean | number | null
type ProcessChangeItem = { field: string; label: string; previousValue: ProcessChangeValue; newValue: ProcessChangeValue }
type ProcessChangeActor = { id: string; name: string; email: string }
type ProcessWithInclude = Prisma.ProcessGetPayload<{ include: typeof processInclude }>
type ProcessTransaction = Prisma.TransactionClient | PrismaClient

const processChangeValue = (value: unknown): ProcessChangeValue => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value
  return String(value)
}

const initialProcessChanges = (process: ProcessWithInclude): ProcessChangeItem[] => processCreationFields.map((field) => ({
  field,
  label: processChangeLabels[field],
  previousValue: null,
  newValue: processChangeValue(process[field]),
}))

const updatedProcessChanges = (current: ProcessWithInclude, data: Prisma.ProcessUncheckedUpdateInput): ProcessChangeItem[] => processChangeFields.flatMap((field) => {
  if (data[field] === undefined || current[field] === data[field]) return []
  return [{
    field,
    label: processChangeLabels[field],
    previousValue: processChangeValue(current[field]),
    newValue: processChangeValue(data[field]),
  }]
})

async function createProcessWithCode(db: PrismaClient, actor: ProcessChangeActor, companyId: string, data: Omit<Prisma.ProcessUncheckedCreateInput, 'code'>) {
  return withProcessCodeLock(companyId, async () => {
    const create = async (transaction: Prisma.TransactionClient | PrismaClient) => {
      if (typeof transaction.$queryRaw === 'function') {
        await transaction.$queryRaw`
          WITH advisory_lock AS MATERIALIZED (
            SELECT pg_advisory_xact_lock(hashtext(${companyId}))
          )
          SELECT true AS locked
          FROM advisory_lock
        `
      }
      const existing = await transaction.process.findMany({ where: { companyId }, select: { code: true } })
      const code = nextProcessCode(data.type, existing.map((process) => process.code))
      const process = await transaction.process.create({ data: { ...data, companyId, code }, include: processInclude })
      await transaction.processChange.create({
        data: {
          processId: process.id,
          processName: process.name,
          version: process.version ?? '1.0',
          action: 'CREATED',
          changedById: actor.id,
          changedByName: actor.name || null,
          changedByEmail: actor.email || null,
          changes: initialProcessChanges(process),
        },
      })
      return process
    }
    return typeof db.$transaction === 'function' ? db.$transaction((transaction) => create(transaction)) : create(db)
  })
}

type ProcessVersionOperation<T> = (transaction: ProcessTransaction) => Promise<{ result: T; changes: ProcessChangeItem[] }>

export async function updateProcessWithVersion<T = undefined>(db: PrismaClient, processId: string, actor: ProcessChangeActor, data: Prisma.ProcessUncheckedUpdateInput, operation?: ProcessVersionOperation<T>): Promise<{ process: ProcessWithInclude; result: T } | null> {
  const update = async (transaction: ProcessTransaction) => {
    if (typeof transaction.$queryRaw === 'function') {
      await transaction.$queryRaw`SELECT "id" FROM "Process" WHERE "id" = ${processId} FOR UPDATE`
    }
    const current = await transaction.process.findUnique({ where: { id: processId }, include: processInclude })
    if (!current) return null
    const operationResult = operation ? await operation(transaction) : { result: undefined as T, changes: [] }
    const changes = [...updatedProcessChanges(current, data), ...operationResult.changes]
    if (changes.length === 0) return { process: current, result: operationResult.result }
    const version = nextProcessVersion(current.version)
    const process = await transaction.process.update({ where: { id: processId }, data: { ...data, version }, include: processInclude })
    await transaction.processChange.create({
      data: {
        processId: process.id,
        processName: process.name,
        version,
        action: 'UPDATED',
        changedById: actor.id,
        changedByName: actor.name || null,
        changedByEmail: actor.email || null,
        changes,
      },
    })
    return { process, result: operationResult.result }
  }

  return typeof db.$transaction === 'function' ? db.$transaction((transaction) => update(transaction)) : update(db)
}
/** Un proceso solo se lista dentro de su empresa; el súper usuario, que no tiene empresa propia, ve todas. */
const scopeForProcess = (request: Request): Prisma.ProcessWhereInput => request.user?.role === Role.SUPERUSER ? {} : { companyId: request.user?.companyId ?? 'none' }

const kpiInclude = {
  process: { select: { id: true, companyId: true, name: true, code: true } },
  reportResponsible: { select: { id: true, name: true } },
  monitorResponsible: { select: { id: true, name: true } },
} as const
const kpiView = (kpi: Prisma.KpiGetPayload<{ include: typeof kpiInclude }>) => ({
  id: kpi.id,
  processId: kpi.processId,
  companyId: kpi.process.companyId,
  name: kpi.name,
  description: kpi.description,
  frequency: kpi.frequency,
  target: kpi.target,
  formula: kpi.formula,
  dataSource: kpi.dataSource,
  unit: kpi.unit,
  reportResponsible: kpi.reportResponsible,
  monitorResponsible: kpi.monitorResponsible,
  greenThreshold: kpi.greenThreshold,
  yellowThreshold: kpi.yellowThreshold,
  redThreshold: kpi.redThreshold,
  createdAt: kpi.createdAt,
  updatedAt: kpi.updatedAt,
})

const procedureInclude = {
  process: { select: { id: true, companyId: true, name: true, code: true } },
  responsible: { select: { id: true, name: true } },
} as const
type ProcedureWithInclude = Prisma.ProcedureGetPayload<{ include: typeof procedureInclude }>
const procedureView = (procedure: ProcedureWithInclude) => ({
  id: procedure.id,
  processId: procedure.processId,
  companyId: procedure.process.companyId,
  code: procedure.code,
  name: procedure.name,
  objective: procedure.objective,
  scope: procedure.scope,
  description: procedure.description,
  responsible: procedure.responsible,
  status: procedure.status,
  version: procedure.version,
  createdAt: procedure.createdAt,
  updatedAt: procedure.updatedAt,
})

const procedureVersionInclude = { changedBy: { select: { id: true, name: true } } } as const
type ProcedureVersionWithInclude = Prisma.ProcedureVersionGetPayload<{ include: typeof procedureVersionInclude }>
const procedureVersionView = (version: ProcedureVersionWithInclude) => ({
  id: version.id,
  procedureId: version.procedureId,
  version: version.version,
  status: version.status,
  action: version.action,
  changes: Array.isArray(version.changes) ? version.changes : [],
  snapshot: version.snapshot && typeof version.snapshot === 'object' && !Array.isArray(version.snapshot) ? version.snapshot : null,
  changedById: version.changedById,
  changedBy: version.changedBy,
  changedByName: version.changedByName,
  changedByEmail: version.changedByEmail,
  changedAt: version.changedAt,
})

// Máquina de transiciones del flujo documental. Lo aprobado solo cambia abriendo una nueva
// revisión (vuelve a borrador) u obsolétando: nunca se edita su contenido, de modo que la versión
// aprobada queda siempre en el historial y jamás se sobrescribe.
const procedureTransitions: Record<ProcedureStatus, ProcedureStatus[]> = {
  [ProcedureStatus.DRAFT]: [ProcedureStatus.IN_REVIEW, ProcedureStatus.OBSOLETE],
  [ProcedureStatus.IN_REVIEW]: [ProcedureStatus.DRAFT, ProcedureStatus.APPROVED, ProcedureStatus.OBSOLETE],
  [ProcedureStatus.APPROVED]: [ProcedureStatus.DRAFT, ProcedureStatus.OBSOLETE],
  [ProcedureStatus.OBSOLETE]: [ProcedureStatus.DRAFT],
}
const canTransitionProcedure = (from: ProcedureStatus, to: ProcedureStatus): boolean =>
  from !== to && procedureTransitions[from].includes(to)

const procedureChangeFields = ['code', 'name', 'objective', 'scope', 'description', 'responsibleId'] as const
const procedureChangeLabels: Record<(typeof procedureChangeFields)[number], string> = {
  code: 'Código',
  name: 'Nombre',
  objective: 'Objetivo',
  scope: 'Alcance',
  description: 'Descripción',
  responsibleId: 'Responsable',
}
const updatedProcedureChanges = (current: ProcedureWithInclude, data: Prisma.ProcedureUncheckedUpdateInput): ProcessChangeItem[] =>
  procedureChangeFields.flatMap((field) => {
    if (data[field] === undefined || current[field] === data[field]) return []
    return [{
      field,
      label: procedureChangeLabels[field],
      previousValue: processChangeValue(current[field]),
      newValue: processChangeValue(data[field]),
    }]
  })

// Snapshot completo del contenido tras cada hecho: permite reconstruir exactamente la versión que
// se aprobó aunque el registro actual ya haya avanzado de revisión.
const procedureSnapshot = (procedure: ProcedureWithInclude) => ({
  code: procedure.code,
  name: procedure.name,
  objective: procedure.objective,
  scope: procedure.scope,
  description: procedure.description,
  responsibleId: procedure.responsibleId,
  status: procedure.status,
  version: procedure.version,
})

// Única vía de escritura del historial y siempre desde el backend con el cliente (db o tx) de la
// operación auditada: no existe endpoint que reciba eventos del cliente (mismo contrato que
// riskAuditWrite y que el historial de cambios de procesos).
const procedureHistoryWrite = (client: ProcessTransaction, data: {
  procedure: { id: string; code: string; version: string; status: ProcedureStatus }
  action: ProcedureHistoryAction
  actor: ProcessChangeActor | null | undefined
  changes?: ProcessChangeItem[]
  snapshot: Record<string, unknown>
}) => client.procedureVersion.create({
  data: {
    procedureId: data.procedure.id,
    version: data.procedure.version,
    status: data.procedure.status,
    action: data.action,
    ...(data.changes && data.changes.length > 0 ? { changes: data.changes as unknown as Prisma.InputJsonValue } : {}),
    snapshot: data.snapshot as unknown as Prisma.InputJsonValue,
    changedById: data.actor?.id ?? null,
    changedByName: data.actor?.name ?? null,
    changedByEmail: data.actor?.email ?? null,
  },
})
type SipocKind = 'suppliers' | 'inputs' | 'processes' | 'outputs' | 'customers'
type SipocRecord = { id: string; processId: string; description: string; createdAt: Date; updatedAt: Date }
type SipocDelegate = {
  findMany: (args: { where: { processId: string }; orderBy: { createdAt: 'asc' } }) => Promise<SipocRecord[]>
  findUnique: (args: { where: { id: string } }) => Promise<SipocRecord | null>
  create: (args: { data: { processId: string; description: string } }) => Promise<SipocRecord>
  update: (args: { where: { id: string }; data: { description: string } }) => Promise<SipocRecord>
  delete: (args: { where: { id: string } }) => Promise<SipocRecord>
}
const sipocItemView = (item: SipocRecord) => ({
  id: item.id,
  processId: item.processId,
  description: item.description,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
})
const sipocChangeLabels: Record<SipocKind, string> = {
  suppliers: 'Proveedores SIPOC',
  inputs: 'Entradas SIPOC',
  processes: 'Procesos SIPOC',
  outputs: 'Salidas SIPOC',
  customers: 'Clientes SIPOC',
}
const sipocChange = (kind: SipocKind, previousValue: string | null, newValue: string | null): ProcessChangeItem => ({
  field: `sipoc.${kind}`,
  label: sipocChangeLabels[kind],
  previousValue,
  newValue,
})
const riskInclude = {
  controls: { orderBy: { createdAt: 'asc' as const } },
  evidences: { orderBy: { createdAt: 'asc' as const } },
  riskOwner: { select: { id: true, name: true } },
  mitigationOwner: { select: { id: true, name: true } },
  // Último ciclo de aprobación del riesgo (el más reciente) para pintar su estado en el panel.
  approvals: { orderBy: { createdAt: 'desc' as const }, take: 1, include: { decidedBy: { select: { id: true, name: true } } } },
} as const
// Temporary compatibility value until the NOT NULL BPMN column is removed by a migration.
const legacyBpmnActivityValue = 'No especificada'
const riskView = (risk: Prisma.RiskGetPayload<{ include: typeof riskInclude }>) => {
  // Los mocks de prueba pueden no incluir approvals; el valor real siempre viene del include.
  const latestApproval = Array.isArray(risk.approvals) && risk.approvals.length > 0 ? risk.approvals[0] : null
  return {
    id: risk.id,
    processId: risk.processId,
    name: risk.name,
    description: risk.description,
    riskType: risk.riskType,
    code: risk.code,
    riskOwner: risk.riskOwner,
    acceptanceStatus: risk.acceptanceStatus,
    treatment: risk.treatment,
    mitigationOwner: risk.mitigationOwner,
    mitigationDueDate: risk.mitigationDueDate,
    inherentImpact: risk.inherentImpact,
    inherentProbability: risk.inherentProbability,
    inherentScore: riskScoreFor(risk.inherentImpact, risk.inherentProbability),
    inherentLevel: riskLevelFor(risk.inherentImpact, risk.inherentProbability),
    residualImpact: risk.residualImpact,
    residualProbability: risk.residualProbability,
    residualScore: riskScoreFor(risk.residualImpact, risk.residualProbability),
    residualLevel: riskLevelFor(risk.residualImpact, risk.residualProbability),
    controls: risk.controls,
    evidences: risk.evidences,
    approval: latestApproval ? {
      id: latestApproval.id,
      status: latestApproval.status,
      requestedAt: latestApproval.createdAt,
      decidedBy: latestApproval.decidedBy ?? null,
      decidedAt: latestApproval.decidedAt ?? null,
      comment: latestApproval.comment ?? null,
      ticketId: latestApproval.ticketId ?? null,
    } : null,
    createdAt: risk.createdAt,
    updatedAt: risk.updatedAt,
  }
}

/**
 * La fecha de inicio del plan de mitigación se retiró del formulario y de la API: el backend ya
 * no la expone ni la valida. La columna Risk.mitigationStartDate se conserva en la base de datos
 * (sin migración destructiva) pero es un dato legado del que la aplicación ya no lee ni escribe.
 */

// Prefijos del código automático por categoría; la secuencia global es independiente por prefijo.
const riskCodePrefix = { ESTRATEGICO: 'EST', MISIONAL: 'MIS', APOYO: 'APO' } as const
type RiskCodeCategory = keyof typeof riskCodePrefix
const isRiskCodeCategory = (value: unknown): value is RiskCodeCategory =>
  typeof value === 'string' && Object.hasOwn(riskCodePrefix, value)

/**
 * El tipo de riesgo no lo elige quien llena el formulario: es el tipo del proceso asociado.
 * Process.type se fija en el alta y processUpdateSchema no lo admite, así que la categoría de un
 * riesgo queda determinada de forma estable por su proceso (y el prefijo EST/MIS/APO del código
 * automático sigue siendo coherente con esa categoría).
 */
const processTypeToRiskCategory: Record<ProcessType, RiskCodeCategory> = {
  STRATEGIC: 'ESTRATEGICO',
  MISSIONAL: 'MISIONAL',
  SUPPORT: 'APOYO',
}

/**
 * El riesgo residual solo se evalúa cuando el riesgo ya tiene al menos un control asociado.
 * Cualquier control habilita la edición (independientemente de su evaluación, PENDING incluido);
 * la "efectividad" del control es un concepto aparte y no decide este bloqueo.
 *
 * 1×1 es el valor neutro de un riesgo recién creado (aún sin controles). Si se elimina el último
 * control, los valores residuales ya guardados se conservan tal cual (Risk.residualImpact y
 * Risk.residualProbability son NOT NULL en el modelo): se bloquean para su edición, pero nunca se
 * borran en silencio, y vuelven a ser editables cuando exista de nuevo al menos un control.
 */
const residualBaselineImpact = 1
const residualBaselineProbability = 1
const residualRequiresControlsError = 'Residual risk values require at least one control'

/**
 * Etapas de la gestión del riesgo (espejo de `riskStageReason` del front): controles, plan de
 * mitigación (responsable, vencimiento y actividades) y evaluación residual solo se escriben
 * cuando la evaluación inherente está completa, hay tratamiento definido y el riesgo quedó
 * ACEPTADO por el ciclo de aprobación. PENDING es «sin decisión» y REJECTED exige una nueva
 * decisión autorizada: ninguno de los dos desbloquea, aunque el riesgo ya tenga controles o
 * actividades guardados. La comprobación vive en el servidor porque `disabled` en el navegador no
 * es una defensa; la interfaz solo la replica para no ofrecer acciones que van a rechazarse.
 *
 * La regla se aplica con HTTP 409 (conflicto de estado, no de validación): el cuerpo ya es
 * válido, lo que falta es avanzar en el flujo. La baja de controles y el cierre/baja de
 * actividades quedan FUERA de este gate (limpieza de datos heredados y finalización del trabajo
 * ya asignado), igual que la lectura de listas y evidencias.
 */
type RiskStageInput = { treatment: string | null; acceptanceStatus: string; inherentImpact: number; inherentProbability: number }

type RiskStageReason = 'evaluation' | 'treatment' | 'acceptance-pending' | 'acceptance-rejected'

const riskStageMessages: Record<RiskStageReason, string> = {
  evaluation: 'Complete the inherent risk evaluation before managing controls, the mitigation plan and the residual risk',
  treatment: 'Define the risk treatment before managing controls, the mitigation plan and the residual risk',
  'acceptance-pending': 'Controls and mitigation management unlock once the risk owner accepts the risk',
  'acceptance-rejected': 'The risk was rejected; a new authorized decision is required before managing controls, the mitigation plan and the residual risk',
}

const inInherentScale = (value: number) => Number.isInteger(value) && value >= 1 && value <= 5

const riskStageLockReason = (risk: RiskStageInput): RiskStageReason | null => {
  if (!inInherentScale(risk.inherentImpact) || !inInherentScale(risk.inherentProbability)) return 'evaluation'
  if (risk.treatment === null) return 'treatment'
  if (risk.acceptanceStatus === 'PENDING') return 'acceptance-pending'
  if (risk.acceptanceStatus === 'REJECTED') return 'acceptance-rejected'
  return null
}

/** Mensaje para el 409, o `null` cuando la escritura del paso 3/4 está habilitada. */
const riskStageLockError = (risk: RiskStageInput): string | null => {
  const reason = riskStageLockReason(risk)
  return reason ? riskStageMessages[reason] : null
}

/** Campos que el gate de etapas mira para decidir si un PATCH toca el paso 3 (plan) o el 4. */
const riskStageSelect = { treatment: true, acceptanceStatus: true, inherentImpact: true, inherentProbability: true } as const

// Etiquetas del nivel de riesgo para notificaciones y tickets (misma matriz 5×5 de siempre).
const riskLevelNames: Record<'LOW' | 'MEDIUM' | 'HIGH', string> = { LOW: 'Bajo', MEDIUM: 'Medio', HIGH: 'Alto' }

// El link de una notificación apunta a la bandeja "Mis aprobaciones"; la campana lo interpreta.
const approvalNotificationLink = (approvalId: string) => `approvals/${approvalId}`

// Enlace de una notificación de asignación de ticket: la campana lo abre en el detalle del
// ticket, con el mismo patrón de segmentos que los links de aprobaciones y de riesgos.
const ticketAssignmentNotificationLink = (ticketId: string) => `tickets/${ticketId}`

const riskApprovalInclude = {
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  ticket: { select: { id: true, title: true, status: true } },
  risk: {
    include: {
      process: { select: { id: true, name: true, code: true, companyId: true } },
      riskOwner: { select: { id: true, name: true } },
      controls: { orderBy: { createdAt: 'asc' as const } },
    },
  },
} as const

const riskApprovalView = (approval: Prisma.RiskApprovalGetPayload<{ include: typeof riskApprovalInclude }>) => ({
  id: approval.id,
  riskId: approval.riskId,
  status: approval.status,
  requestedBy: approval.requestedBy,
  requestedAt: approval.createdAt,
  decidedBy: approval.decidedBy,
  decidedAt: approval.decidedAt,
  comment: approval.comment,
  ticket: approval.ticket,
  risk: {
    id: approval.risk.id,
    code: approval.risk.code,
    name: approval.risk.name,
    description: approval.risk.description,
    acceptanceStatus: approval.risk.acceptanceStatus,
    treatment: approval.risk.treatment,
    riskOwner: approval.risk.riskOwner,
    inherentImpact: approval.risk.inherentImpact,
    inherentProbability: approval.risk.inherentProbability,
    inherentScore: riskScoreFor(approval.risk.inherentImpact, approval.risk.inherentProbability),
    inherentLevel: riskLevelFor(approval.risk.inherentImpact, approval.risk.inherentProbability),
    residualImpact: approval.risk.residualImpact,
    residualProbability: approval.risk.residualProbability,
    residualScore: riskScoreFor(approval.risk.residualImpact, approval.risk.residualProbability),
    residualLevel: riskLevelFor(approval.risk.residualImpact, approval.risk.residualProbability),
    controls: approval.risk.controls,
    process: { id: approval.risk.process.id, name: approval.risk.process.name, code: approval.risk.process.code },
  },
})

/**
 * Datos del ticket que genera una aprobación, siguiendo las mismas reglas que el ticket automático
 * de los ítems de plan: OPEN, prioridad heredada del nivel inherente (misma escala, sin inventar
 * niveles), asignado al dueño del riesgo y con referencia navegable al riesgo de origen.
 */
const ticketDataFromRiskApproval = (approval: { id: string; risk: { id: string; code: string | null; name: string; description: string; inherentImpact: number; inherentProbability: number; riskOwnerId: string | null; process: { id: string; name: string; code: string | null } } }, createdById: string) => {
  const level = riskLevelFor(approval.risk.inherentImpact, approval.risk.inherentProbability)
  return {
    title: `${approval.risk.code ?? 'Riesgo'} · ${approval.risk.name}`,
    description: `Riesgo aprobado y aceptado por su dueño.\n\n${approval.risk.description}\n\nProceso: ${approval.risk.process.name}${approval.risk.process.code ? ` (${approval.risk.process.code})` : ''}\nNivel inherente: ${riskLevelNames[level]} (${riskScoreFor(approval.risk.inherentImpact, approval.risk.inherentProbability)})\nReferencia: riesgo ${approval.risk.id} del proceso ${approval.risk.process.id}`,
    status: TicketStatus.OPEN,
    priority: TicketPriority[level === 'LOW' ? 'LOW' : level === 'MEDIUM' ? 'MEDIUM' : 'HIGH'],
    assignedToId: approval.risk.riskOwnerId,
    createdById,
  }
}

/**
 * Abre un ciclo de aprobación, notifica in-app al dueño del riesgo y registra el evento
 * APPROVAL_REQUESTED del historial, todo en la misma operación (el llamador pasa db o una
 * transacción). La notificación identifica código, nombre y nivel inherente, y su link abre la
 * revisión en "Mis aprobaciones". El actor es quien envía (requestedById), no un valor del cliente.
 */
const createRiskApprovalCycle = async (client: Prisma.TransactionClient | PrismaClient, data: { riskId: string; requestedById: string; riskOwnerId: string; actor: RiskAuditActor; risk: { code: string | null; name: string; description: string; inherentImpact: number; inherentProbability: number } }) => {
  const approval = await client.riskApproval.create({ data: { riskId: data.riskId, requestedById: data.requestedById, openKey: data.riskId } })
  await riskAuditWrite(client, {
    riskId: data.riskId,
    eventType: 'APPROVAL_REQUESTED',
    summary: 'Enviado a aprobación',
    actor: data.actor,
    metadata: { approvalId: approval.id },
  })
  const level = riskLevelFor(data.risk.inherentImpact, data.risk.inherentProbability)
  await client.notification.create({
    data: {
      userId: data.riskOwnerId,
      title: `${data.risk.code ? `Riesgo ${data.risk.code}` : 'Nuevo riesgo'} pendiente de tu revisión`,
      body: `«${data.risk.name}» está esperando tu aprobación. Nivel inherente: ${riskLevelNames[level]} (${riskScoreFor(data.risk.inherentImpact, data.risk.inherentProbability)}).`,
      link: approvalNotificationLink(approval.id),
    },
  })
  return approval
}

// Bandeja y autorización: el dueño del riesgo ve sus riesgos; los administradores ven su empresa
// (o todo, si son superusuarios) para poder decidir en nombre de un dueño ausente.
const approvalVisibilityWhere = (request: Request): Prisma.RiskApprovalWhereInput => {
  if (request.user?.role === Role.SUPERUSER) return {}
  if (request.user?.role === Role.COMPANY_ADMIN) return { risk: { process: { companyId: request.user.companyId ?? 'none' } } }
  return { risk: { riskOwnerId: request.user?.id ?? 'none' } }
}

const canDecideApproval = (request: Request, approval: { risk: { riskOwnerId: string | null; process: { companyId: string | null } } }): boolean => {
  const user = request.user
  if (!user) return false
  if (approval.risk.riskOwnerId === user.id) return true
  if (user.role === Role.SUPERUSER) return true
  return user.role === Role.COMPANY_ADMIN && approval.risk.process.companyId === user.companyId
}

const isUniqueConstraintError = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002')

/**
 * Siguiente código de la categoría. El upsert es una sentencia atómica que se confirma en
 * autocommit: serializa la concurrencia por categoría (bloqueo de fila sobre RiskCodeSequence)
 * y, si el índice único de Risk.code detectara un conflicto, el contador ya quedó avanzado para
 * que el reintento obtenga un número nuevo (la secuencia admite huecos, como cualquier contador).
 */
const nextRiskCodeFor = async (client: Prisma.TransactionClient, category: RiskCodeCategory): Promise<string> => {
  const sequence = await client.riskCodeSequence.upsert({
    where: { category },
    create: { category, next: 1 },
    update: { next: { increment: 1 } },
  })
  return `${riskCodePrefix[category]}-R${sequence.next}`
}

const withCodeRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  let lastConflict: unknown = null
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      lastConflict = error
    }
  }
  throw lastConflict
}

// Solo el backend genera el código: el cliente nunca envía ni modifica Risk.code.
type RiskWithInclude = Prisma.RiskGetPayload<{ include: typeof riskInclude }>

// ---- Auditoría del ciclo de vida del riesgo (RiskAuditEvent) ----

type RiskAuditActor = { id: string; name: string; email: string }
type RiskAuditClient = PrismaClient | Prisma.TransactionClient
// Mismo formato before/after por campo que ProcessChange: la UI del historial lo reutiliza.
type RiskAuditChange = ProcessChangeItem

const auditActorFields = (actor: RiskAuditActor | null | undefined) => actor
  ? { actorId: actor.id, actorName: actor.name || null, actorEmail: actor.email || null }
  : // Operación de sistema (sin sesión que atribuir): queda explícita con actor null.
    { actorId: null, actorName: null, actorEmail: null }

// Defensa en profundidad: aunque solo el backend escribe metadata (ids, estados, comentario de la
// decisión), se descartan claves sensibles antes de devolverla por la API por si un futuro evento
// guardara por error contraseñas, cookies, tokens o secretos.
const sensitiveAuditKey = /password|token|secret|cookie|hash|credential|authorization/i
const riskAuditMetadataView = (metadata: Prisma.JsonValue | null): Record<string, unknown> | null => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (sensitiveAuditKey.test(key)) continue
    clean[key] = value
  }
  return clean
}

const riskAuditInclude = { actor: { select: { id: true, name: true } } } as const
type RiskAuditEventWithActor = Prisma.RiskAuditEventGetPayload<{ include: typeof riskAuditInclude }>
const riskAuditEventView = (event: RiskAuditEventWithActor) => ({
  id: event.id,
  riskId: event.riskId,
  eventType: event.eventType,
  summary: event.summary,
  actorId: event.actorId,
  actor: event.actor,
  actorName: event.actorName,
  actorEmail: event.actorEmail,
  occurredAt: event.occurredAt,
  changes: Array.isArray(event.changes) ? event.changes : [],
  metadata: riskAuditMetadataView(event.metadata),
})

// Única vía de escritura del historial y siempre desde el backend con el cliente (db o tx) de la
// operación auditada: no existe endpoint que reciba eventos del cliente.
const riskAuditWrite = (client: RiskAuditClient, data: {
  riskId: string
  eventType: RiskAuditEventType
  summary: string
  actor: RiskAuditActor | null | undefined
  changes?: RiskAuditChange[]
  metadata?: Record<string, unknown>
}) => client.riskAuditEvent.create({
  data: {
    riskId: data.riskId,
    eventType: data.eventType,
    summary: data.summary,
    ...(data.changes && data.changes.length > 0 ? { changes: data.changes as unknown as Prisma.InputJsonValue } : {}),
    ...(data.metadata ? { metadata: data.metadata as unknown as Prisma.InputJsonValue } : {}),
    ...auditActorFields(data.actor),
  },
})

const auditValue = (value: unknown): ProcessChangeValue => {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return String(value)
}

const riskCreationChanges = (risk: RiskWithInclude): RiskAuditChange[] => [
  { field: 'code', label: 'Código', previousValue: null, newValue: auditValue(risk.code) },
  { field: 'name', label: 'Nombre', previousValue: null, newValue: auditValue(risk.name) },
  { field: 'description', label: 'Descripción', previousValue: null, newValue: auditValue(risk.description) },
  { field: 'riskOwnerId', label: 'Dueño del riesgo', previousValue: null, newValue: risk.riskOwner?.name ?? null },
  { field: 'inherentImpact', label: 'Impacto inherente', previousValue: null, newValue: auditValue(risk.inherentImpact) },
  { field: 'inherentProbability', label: 'Probabilidad inherente', previousValue: null, newValue: auditValue(risk.inherentProbability) },
]

/**
 * Diferencia campo a campo entre el riesgo guardado y el payload de PATCH. Solo se registran los
 * campos editables relevantes (el proceso no es editable: riskUpdateSchema no lo admite) y los
 * dueños se muestran por nombre, con el nombre nuevo resuelto por la ruta llamadora.
 */
const updatedRiskChanges = (existing: RiskWithInclude, data: Prisma.RiskUncheckedUpdateInput, owners: { riskOwner?: string | null; mitigationOwner?: string | null }): RiskAuditChange[] => {
  const changes: RiskAuditChange[] = []
  const pushIfChanged = (field: string, label: string, previous: unknown, next: unknown) => {
    if (next === undefined) return
    const previousValue = auditValue(previous)
    const newValue = auditValue(next)
    if (previousValue === newValue) return
    changes.push({ field, label, previousValue, newValue })
  }
  pushIfChanged('name', 'Nombre', existing.name, data.name)
  pushIfChanged('description', 'Descripción', existing.description, data.description)
  pushIfChanged('bpmnActivity', 'Actividad BPM', existing.bpmnActivity, data.bpmnActivity)
  pushIfChanged('inherentImpact', 'Impacto inherente', existing.inherentImpact, data.inherentImpact)
  pushIfChanged('inherentProbability', 'Probabilidad inherente', existing.inherentProbability, data.inherentProbability)
  pushIfChanged('residualImpact', 'Impacto residual', existing.residualImpact, data.residualImpact)
  pushIfChanged('residualProbability', 'Probabilidad residual', existing.residualProbability, data.residualProbability)
  pushIfChanged('treatment', 'Tratamiento', existing.treatment, data.treatment)
  // acceptanceStatus queda fuera: no es editable desde la edición general del riesgo, así que aquí
  // nunca hay un valor nuevo que comparar ni registrar en el historial.
  pushIfChanged('mitigationDueDate', 'Fecha de vencimiento del plan', existing.mitigationDueDate, data.mitigationDueDate)
  if (data.riskOwnerId !== undefined && data.riskOwnerId !== existing.riskOwnerId) {
    changes.push({ field: 'riskOwnerId', label: 'Dueño del riesgo', previousValue: existing.riskOwner?.name ?? null, newValue: owners.riskOwner ?? null })
  }
  if (data.mitigationOwnerId !== undefined && data.mitigationOwnerId !== existing.mitigationOwnerId) {
    changes.push({ field: 'mitigationOwnerId', label: 'Responsable del plan', previousValue: existing.mitigationOwner?.name ?? null, newValue: owners.mitigationOwner ?? null })
  }
  return changes
}

// Cambios de un control (alta, edición o baja). Las filas sin variación se descartan, de modo que
// el alta solo muestra lo nuevo y la baja solo lo que se perdió.
const controlAuditChanges = (previous: { description: string; evaluation: string } | null, next: { description: string; evaluation: string } | null): RiskAuditChange[] => [
  { field: 'description', label: 'Descripción del control', previousValue: previous?.description ?? null, newValue: next?.description ?? null },
  { field: 'evaluation', label: 'Evaluación de efectividad', previousValue: previous?.evaluation ?? null, newValue: next?.evaluation ?? null },
].filter((change) => change.previousValue !== change.newValue)

const evidenceAuditChanges = (previous: { name: string; description: string; url: string } | null, next: { name: string; description: string; url: string } | null): RiskAuditChange[] => [
  { field: 'name', label: 'Nombre de la evidencia', previousValue: previous?.name ?? null, newValue: next?.name ?? null },
  { field: 'description', label: 'Descripción de la evidencia', previousValue: previous?.description ?? null, newValue: next?.description ?? null },
  { field: 'url', label: 'Enlace de la evidencia', previousValue: previous?.url ?? null, newValue: next?.url ?? null },
].filter((change) => change.previousValue !== change.newValue)

// Estado del ticket en español para el resumen del evento (misma escala TicketStatus de siempre).
const ticketStatusNames: Record<TicketStatus, string> = {
  [TicketStatus.OPEN]: 'Abierto',
  [TicketStatus.IN_PROGRESS]: 'En curso',
  [TicketStatus.RESOLVED]: 'Resuelto',
  [TicketStatus.CLOSED]: 'Cerrado',
}

/**
 * Alta de un riesgo con su código y su evento RISK_CREATED en la MISMA transacción: la secuencia
 * por categoría se lee dentro del tx (el lock de fila se sostiene hasta el commit) y withCodeRetry
 * reinicia la transacción completa ante un conflicto de índice único, de modo que un reintento
 * jamás deja un riesgo sin su evento ni un evento sin su riesgo. El actor sale de la sesión.
 */
const createRiskWithAudit = async (db: PrismaClient, actor: RiskAuditActor, data: Prisma.RiskUncheckedCreateInput): Promise<RiskWithInclude> => {
  if (!isRiskCodeCategory(data.riskType)) throw new Error(`No code prefix for risk type ${String(data.riskType)}`)
  // Se captura fuera del closure: TypeScript no mantiene el estrechamiento de data.riskType dentro
  // de las funciones anidadas y nextRiskCodeFor exige la categoría ya validada.
  const riskType = data.riskType
  return withCodeRetry(() => db.$transaction(async (tx) => {
    const code = await nextRiskCodeFor(tx, riskType)
    const risk = await tx.risk.create({ data: { ...data, riskType, code }, include: riskInclude })
    await riskAuditWrite(tx, {
      riskId: risk.id,
      eventType: 'RISK_CREATED',
      summary: `Riesgo ${code} creado`,
      actor,
      changes: riskCreationChanges(risk),
    })
    return risk
  }))
}

// ---- Auditorías de calidad (Trazabilidad y Control / Seguimiento y evidencia) ----
// No confundir con RiskAuditEvent (auditoría del sistema del ciclo de vida de un riesgo): aquí se
// planifican y ejecutan auditorías de calidad sobre un proceso. La empresa se deriva de
// process.companyId (mismo criterio que Procedure y Kpi). El código automático es único dentro de
// la empresa y lo genera el backend con advisory lock (patrón de Process.code); NO usa
// RiskCodeSequence.

const auditInclude = {
  process: { select: { id: true, companyId: true, name: true, code: true } },
  leadAuditor: { select: { id: true, name: true } },
  responsible: { select: { id: true, name: true } },
  findings: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      responsible: { select: { id: true, name: true } },
      verifiedBy: { select: { id: true, name: true } },
      efficacyVerifiedBy: { select: { id: true, name: true } },
      item: { select: { id: true, description: true, checklistId: true } },
      process: { select: { id: true, name: true, code: true } },
      procedure: { select: { id: true, code: true, name: true } },
    },
  },
  evidences: { orderBy: { createdAt: 'asc' as const } },
} as const
type AuditWithInclude = Prisma.AuditGetPayload<{ include: typeof auditInclude }>

const auditFindingInclude = {
  responsible: { select: { id: true, name: true } },
  verifiedBy: { select: { id: true, name: true } },
  efficacyVerifiedBy: { select: { id: true, name: true } },
  item: { select: { id: true, description: true, checklistId: true } },
  process: { select: { id: true, name: true, code: true } },
  procedure: { select: { id: true, code: true, name: true } },
} as const
type AuditFindingWithInclude = Prisma.AuditFindingGetPayload<{ include: typeof auditFindingInclude }>

const auditFindingView = (finding: AuditFindingWithInclude) => ({
  id: finding.id,
  auditId: finding.auditId,
  title: finding.title,
  description: finding.description,
  type: finding.type,
  severity: finding.severity,
  status: finding.status,
  dueDate: finding.dueDate,
  responsible: finding.responsible,
  resolution: finding.resolution,
  verifiedBy: finding.verifiedBy,
  verifiedAt: finding.verifiedAt,
  itemId: finding.itemId,
  item: finding.item ?? null,
  processId: finding.processId,
  process: finding.process ?? null,
  procedureId: finding.procedureId,
  procedure: finding.procedure ?? null,
  efficacyVerification: finding.efficacyVerification,
  efficacyVerifiedBy: finding.efficacyVerifiedBy ?? null,
  efficacyVerifiedAt: finding.efficacyVerifiedAt ?? null,
  createdAt: finding.createdAt,
  updatedAt: finding.updatedAt,
})

const auditEvidenceView = (evidence: { id: string; auditId: string; findingId: string | null; name: string; description: string; url: string; createdAt: Date; updatedAt: Date }) => ({
  id: evidence.id,
  auditId: evidence.auditId,
  findingId: evidence.findingId,
  name: evidence.name,
  description: evidence.description,
  url: evidence.url,
  createdAt: evidence.createdAt,
  updatedAt: evidence.updatedAt,
})

const auditView = (audit: AuditWithInclude) => ({
  id: audit.id,
  processId: audit.processId,
  companyId: audit.process.companyId,
  process: { id: audit.process.id, name: audit.process.name, code: audit.process.code },
  code: audit.code,
  title: audit.title,
  auditType: audit.auditType,
  scope: audit.scope,
  objectives: audit.objectives,
  criteria: audit.criteria,
  status: audit.status,
  plannedDate: audit.plannedDate,
  startDate: audit.startDate,
  endDate: audit.endDate,
  summary: audit.summary,
  leadAuditor: audit.leadAuditor,
  responsible: audit.responsible,
  findings: audit.findings.map(auditFindingView),
  evidences: audit.evidences.map(auditEvidenceView),
  createdAt: audit.createdAt,
  updatedAt: audit.updatedAt,
})

// ---- Vistas del módulo Aseguramiento de Calidad (checklists, acciones, evidencias en disco) ----

type AuditChecklistItemRow = Prisma.AuditChecklistItemGetPayload<{
  select: {
    id: true
    checklistId: true
    position: true
    description: true
    criteria: true
    result: true
    observations: true
    required: true
    createdAt: true
    updatedAt: true
  }
}>

const checklistItemView = (item: AuditChecklistItemRow) => ({
  id: item.id,
  checklistId: item.checklistId,
  position: item.position,
  description: item.description,
  criteria: item.criteria,
  result: item.result,
  observations: item.observations,
  required: item.required,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
})

const checklistInclude = { items: { orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }] } }
type AuditChecklistWithItems = Prisma.AuditChecklistGetPayload<{ include: typeof checklistInclude }>

const checklistView = (checklist: AuditChecklistWithItems) => ({
  id: checklist.id,
  auditId: checklist.auditId,
  name: checklist.name,
  items: checklist.items.map(checklistItemView),
  createdAt: checklist.createdAt,
  updatedAt: checklist.updatedAt,
})

/** Progreso de una lista: total, evaluados (resultado distinto de PENDING) y pendientes obligatorios. */
const checklistProgress = (checklist: { items: Array<{ result: AuditChecklistResult; required: boolean }> }) => ({
  total: checklist.items.length,
  completed: checklist.items.filter((item) => item.result !== 'PENDING').length,
  requiredPending: checklist.items.filter((item) => item.required && item.result === 'PENDING').length,
})

const auditActionInclude = {
  responsible: { select: { id: true, name: true } },
  progress: { orderBy: { createdAt: 'desc' as const }, include: { createdBy: { select: { id: true, name: true } } } },
} as const
type AuditActionWithInclude = Prisma.AuditCorrectiveActionGetPayload<{ include: typeof auditActionInclude }>

const auditActionProgressView = (entry: AuditActionWithInclude['progress'][number]) => ({
  id: entry.id,
  actionId: entry.actionId,
  note: entry.note,
  percent: entry.percent,
  createdBy: entry.createdBy,
  createdAt: entry.createdAt,
})

const auditActionView = (action: AuditActionWithInclude) => ({
  id: action.id,
  findingId: action.findingId,
  title: action.title,
  description: action.description,
  responsible: action.responsible,
  priority: action.priority,
  status: action.status,
  required: action.required,
  dueDate: action.dueDate,
  completedAt: action.completedAt,
  progress: action.progress.map(auditActionProgressView),
  createdAt: action.createdAt,
  updatedAt: action.updatedAt,
})

// Vista de una evidencia en PDF de auditoría. No expone storedName (el nombre en disco es interno
// del servidor, mismo criterio que TicketEvidenceFile).
const auditEvidenceFileInclude = { uploadedBy: { select: { id: true, name: true } } } as const
type AuditEvidenceFileWithInclude = Prisma.AuditEvidenceFileGetPayload<{ include: typeof auditEvidenceFileInclude }>
const auditEvidenceFileView = (file: AuditEvidenceFileWithInclude) => ({
  id: file.id,
  auditId: file.auditId,
  findingId: file.findingId,
  actionId: file.actionId,
  itemId: file.itemId,
  filename: file.filename,
  mimeType: file.mimeType,
  size: file.size,
  uploadedBy: file.uploadedBy,
  createdAt: file.createdAt,
})

const auditRelationsInclude = {
  relatedProcesses: { include: { process: { select: { id: true, name: true, code: true, companyId: true } } }, orderBy: { createdAt: 'asc' as const } },
  procedures: { include: { procedure: { select: { id: true, code: true, name: true, processId: true } } }, orderBy: { createdAt: 'asc' as const } },
} as const
type AuditWithRelations = AuditWithInclude & Prisma.AuditGetPayload<{ include: typeof auditRelationsInclude }>

const auditRelationsView = (audit: AuditWithRelations) => ({
  relatedProcesses: audit.relatedProcesses.map((row) => row.process),
  procedures: audit.procedures.map((row) => row.procedure),
})

const auditDetailInclude = {
  ...auditInclude,
  ...auditRelationsInclude,
  findings: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      ...auditFindingInclude,
      actions: { orderBy: { createdAt: 'asc' as const }, include: auditActionInclude },
    },
  },
  checklists: { orderBy: { createdAt: 'asc' as const }, include: checklistInclude },
  evidenceFiles: { orderBy: { createdAt: 'desc' as const }, include: auditEvidenceFileInclude },
}
type AuditWithDetail = Prisma.AuditGetPayload<{ include: typeof auditDetailInclude }>

const auditDetailView = (audit: AuditWithDetail) => ({
  ...auditView(audit as unknown as AuditWithInclude),
  ...auditRelationsView(audit as unknown as AuditWithRelations),
  findings: audit.findings.map((finding) => ({
    ...auditFindingView(finding),
    actions: finding.actions.map(auditActionView),
  })),
  checklists: audit.checklists.map(checklistView),
  checklistProgress: audit.checklists.map(checklistProgress).reduce(
    (total, progress) => ({
      total: total.total + progress.total,
      completed: total.completed + progress.completed,
      requiredPending: total.requiredPending + progress.requiredPending,
    }),
    { total: 0, completed: 0, requiredPending: 0 },
  ),
  evidenceFiles: audit.evidenceFiles.map(auditEvidenceFileView),
})

// Máquina de transiciones del flujo de auditoría. CLOSED y CANCELLED son terminales: no se sale
// de ellas y, salvo que se indique lo contrario, bloquean toda escritura posterior.
const auditTransitions: Record<AuditStatus, AuditStatus[]> = {
  [AuditStatus.PLANNED]: [AuditStatus.IN_PROGRESS, AuditStatus.CANCELLED],
  [AuditStatus.IN_PROGRESS]: [AuditStatus.CLOSED, AuditStatus.CANCELLED],
  [AuditStatus.CLOSED]: [],
  [AuditStatus.CANCELLED]: [],
}
const canTransitionAudit = (from: AuditStatus, to: AuditStatus): boolean =>
  from !== to && auditTransitions[from].includes(to)

const isTerminalAuditStatus = (status: AuditStatus): boolean =>
  status === AuditStatus.CLOSED || status === AuditStatus.CANCELLED

// Flujo de un hallazgo: solo avances hacia adelante; VERIFIED es terminal.
const auditFindingTransitions: Record<AuditFindingStatus, AuditFindingStatus[]> = {
  [AuditFindingStatus.OPEN]: [AuditFindingStatus.IN_PROGRESS, AuditFindingStatus.RESOLVED],
  [AuditFindingStatus.IN_PROGRESS]: [AuditFindingStatus.RESOLVED],
  [AuditFindingStatus.RESOLVED]: [AuditFindingStatus.VERIFIED],
  [AuditFindingStatus.VERIFIED]: [],
}
const canTransitionAuditFinding = (from: AuditFindingStatus, to: AuditFindingStatus): boolean =>
  from !== to && auditFindingTransitions[from].includes(to)

// Flujo de una acción correctiva. Solo avances hacia estados finales; CANCELLED y COMPLETED son
// terminales. El servidor nunca "cierra" acciones automáticamente: cada cambio llega explícito.
const auditActionTransitions: Record<AuditCorrectiveActionStatus, AuditCorrectiveActionStatus[]> = {
  [AuditCorrectiveActionStatus.OPEN]: [AuditCorrectiveActionStatus.IN_PROGRESS, AuditCorrectiveActionStatus.CANCELLED],
  [AuditCorrectiveActionStatus.IN_PROGRESS]: [AuditCorrectiveActionStatus.COMPLETED, AuditCorrectiveActionStatus.CANCELLED],
  [AuditCorrectiveActionStatus.COMPLETED]: [],
  [AuditCorrectiveActionStatus.CANCELLED]: [],
}
const canTransitionAuditAction = (from: AuditCorrectiveActionStatus, to: AuditCorrectiveActionStatus): boolean =>
  from !== to && auditActionTransitions[from].includes(to)

const auditActionStatusNames: Record<AuditCorrectiveActionStatus, string> = {
  [AuditCorrectiveActionStatus.OPEN]: 'Abierta',
  [AuditCorrectiveActionStatus.IN_PROGRESS]: 'En curso',
  [AuditCorrectiveActionStatus.COMPLETED]: 'Completada',
  [AuditCorrectiveActionStatus.CANCELLED]: 'Cancelada',
}

const auditStatusNames: Record<AuditStatus, string> = {
  [AuditStatus.PLANNED]: 'Planificada',
  [AuditStatus.IN_PROGRESS]: 'En curso',
  [AuditStatus.CLOSED]: 'Cerrada',
  [AuditStatus.CANCELLED]: 'Cancelada',
}
const auditFindingStatusNames: Record<AuditFindingStatus, string> = {
  [AuditFindingStatus.OPEN]: 'Abierto',
  [AuditFindingStatus.IN_PROGRESS]: 'En curso',
  [AuditFindingStatus.RESOLVED]: 'Resuelto',
  [AuditFindingStatus.VERIFIED]: 'Verificado',
}

// Única vía de escritura del historial y siempre desde el backend con el cliente (db o tx) de la
// operación auditada: no existe endpoint que reciba eventos del cliente (mismo contrato que
// riskAuditWrite y procedureHistoryWrite).
const auditEventWrite = (client: RiskAuditClient, data: {
  auditId: string
  eventType: AuditEventType
  summary: string
  actor: RiskAuditActor | null | undefined
  changes?: RiskAuditChange[]
  metadata?: Record<string, unknown>
}) => client.auditEvent.create({
  data: {
    auditId: data.auditId,
    eventType: data.eventType,
    summary: data.summary,
    ...(data.changes && data.changes.length > 0 ? { changes: data.changes as unknown as Prisma.InputJsonValue } : {}),
    ...(data.metadata ? { metadata: data.metadata as unknown as Prisma.InputJsonValue } : {}),
    ...auditActorFields(data.actor),
  },
})

const auditEventInclude = { actor: { select: { id: true, name: true } } } as const
type AuditEventWithActor = Prisma.AuditEventGetPayload<{ include: typeof auditEventInclude }>
const auditEventView = (event: AuditEventWithActor) => ({
  id: event.id,
  auditId: event.auditId,
  eventType: event.eventType,
  summary: event.summary,
  actorId: event.actorId,
  actor: event.actor,
  actorName: event.actorName,
  actorEmail: event.actorEmail,
  occurredAt: event.occurredAt,
  changes: Array.isArray(event.changes) ? event.changes : [],
  metadata: riskAuditMetadataView(event.metadata),
})

const auditCreationChanges = (audit: AuditWithInclude): RiskAuditChange[] => [
  { field: 'code', label: 'Código', previousValue: null, newValue: auditValue(audit.code) },
  { field: 'title', label: 'Título', previousValue: null, newValue: auditValue(audit.title) },
  { field: 'auditType', label: 'Tipo de auditoría', previousValue: null, newValue: auditValue(audit.auditType) },
  { field: 'scope', label: 'Alcance', previousValue: null, newValue: auditValue(audit.scope) },
  { field: 'criteria', label: 'Criterios', previousValue: null, newValue: auditValue(audit.criteria) },
  { field: 'plannedDate', label: 'Fecha planificada', previousValue: null, newValue: auditValue(audit.plannedDate) },
  { field: 'leadAuditorId', label: 'Auditor líder', previousValue: null, newValue: audit.leadAuditor?.name ?? null },
  { field: 'responsibleId', label: 'Responsable', previousValue: null, newValue: audit.responsible?.name ?? null },
]

/**
 * Diferencia campo a campo entre la auditoría guardada y el payload de PATCH. Solo se registran
 * campos editables; los usuarios se muestran por nombre, con el nombre nuevo resuelto por la ruta.
 */
const updatedAuditChanges = (existing: AuditWithInclude, data: Prisma.AuditUncheckedUpdateInput, people: { leadAuditor?: string | null; responsible?: string | null }): RiskAuditChange[] => {
  const changes: RiskAuditChange[] = []
  const pushIfChanged = (field: string, label: string, previous: unknown, next: unknown) => {
    if (next === undefined) return
    const previousValue = auditValue(previous)
    const newValue = auditValue(next)
    if (previousValue === newValue) return
    changes.push({ field, label, previousValue, newValue })
  }
  pushIfChanged('title', 'Título', existing.title, data.title)
  pushIfChanged('auditType', 'Tipo de auditoría', existing.auditType, data.auditType)
  pushIfChanged('scope', 'Alcance', existing.scope, data.scope)
  pushIfChanged('objectives', 'Objetivos', existing.objectives, data.objectives)
  pushIfChanged('criteria', 'Criterios', existing.criteria, data.criteria)
  pushIfChanged('plannedDate', 'Fecha planificada', existing.plannedDate, data.plannedDate)
  if (data.leadAuditorId !== undefined && data.leadAuditorId !== existing.leadAuditorId) {
    changes.push({ field: 'leadAuditorId', label: 'Auditor líder', previousValue: existing.leadAuditor?.name ?? null, newValue: people.leadAuditor ?? null })
  }
  if (data.responsibleId !== undefined && data.responsibleId !== existing.responsibleId) {
    changes.push({ field: 'responsibleId', label: 'Responsable', previousValue: existing.responsible?.name ?? null, newValue: people.responsible ?? null })
  }
  return changes
}

const findingAuditChanges = (previous: { title: string; description: string; type: string; severity: string; dueDate: Date | null; responsibleName: string | null; itemId: string | null; itemDescription: string | null; processId: string | null; processName: string | null; procedureId: string | null; procedureName: string | null; efficacyVerification: string | null } | null, next: { title?: string; description?: string; type?: string; severity?: string; dueDate?: Date | null; responsibleName?: string | null; itemId?: string | null; itemDescription?: string | null; processId?: string | null; processName?: string | null; procedureId?: string | null; procedureName?: string | null; efficacyVerification?: string | null }): RiskAuditChange[] => {
  const rows: Array<{ field: string; label: string; previousValue: ProcessChangeValue; newValue: ProcessChangeValue }> = [
    { field: 'title', label: 'Título del hallazgo', previousValue: previous?.title ?? null, newValue: next.title !== undefined ? next.title : previous?.title ?? null },
    { field: 'description', label: 'Descripción del hallazgo', previousValue: previous?.description ?? null, newValue: next.description !== undefined ? next.description : previous?.description ?? null },
    { field: 'type', label: 'Tipo', previousValue: previous?.type ?? null, newValue: next.type !== undefined ? next.type : previous?.type ?? null },
    { field: 'severity', label: 'Severidad', previousValue: previous?.severity ?? null, newValue: next.severity !== undefined ? next.severity : previous?.severity ?? null },
    { field: 'dueDate', label: 'Fecha límite', previousValue: auditValue(previous?.dueDate ?? null), newValue: next.dueDate !== undefined ? auditValue(next.dueDate) : auditValue(previous?.dueDate ?? null) },
    { field: 'responsibleId', label: 'Responsable del hallazgo', previousValue: previous?.responsibleName ?? null, newValue: next.responsibleName !== undefined ? next.responsibleName : previous?.responsibleName ?? null },
    { field: 'itemId', label: 'Ítem de la lista de verificación', previousValue: previous?.itemDescription ?? null, newValue: next.itemDescription !== undefined ? next.itemDescription : previous?.itemDescription ?? null },
    { field: 'processId', label: 'Proceso relacionado', previousValue: previous?.processName ?? null, newValue: next.processName !== undefined ? next.processName : previous?.processName ?? null },
    { field: 'procedureId', label: 'Procedimiento relacionado', previousValue: previous?.procedureName ?? null, newValue: next.procedureName !== undefined ? next.procedureName : previous?.procedureName ?? null },
    { field: 'efficacyVerification', label: 'Verificación de eficacia', previousValue: previous?.efficacyVerification ?? null, newValue: next.efficacyVerification !== undefined ? next.efficacyVerification : previous?.efficacyVerification ?? null },
  ]
  return rows.filter((row) => row.previousValue !== row.newValue)
}

const auditEvidenceAuditChanges = (previous: { name: string; description: string; url: string } | null, next: { name?: string; description?: string; url?: string }): RiskAuditChange[] => {
  const rows: Array<{ field: string; label: string; previousValue: ProcessChangeValue; newValue: ProcessChangeValue }> = [
    { field: 'name', label: 'Nombre de la evidencia', previousValue: previous?.name ?? null, newValue: next.name !== undefined ? next.name : previous?.name ?? null },
    { field: 'description', label: 'Descripción de la evidencia', previousValue: previous?.description ?? null, newValue: next.description !== undefined ? next.description : previous?.description ?? null },
    { field: 'url', label: 'Enlace de la evidencia', previousValue: previous?.url ?? null, newValue: next.url !== undefined ? next.url : previous?.url ?? null },
  ]
  return rows.filter((row) => row.previousValue !== row.newValue)
}

// Prefijo del código automático de auditoría; la numeración es por empresa (no global como
// RiskCodeSequence) y se serializa con advisory lock sobre el id de la empresa.
const auditCodePrefix = 'AUD'
const auditCodePattern = /^AUD-(\d{3,})$/

export const nextAuditCode = (codes: readonly (string | null | undefined)[]): string => {
  const usedNumbers = new Set(
    codes.flatMap((code) => {
      const match = code?.match(auditCodePattern)
      return match ? [Number(match[1])] : []
    }),
  )
  let nextNumber = 1
  while (usedNumbers.has(nextNumber)) nextNumber += 1
  return `${auditCodePrefix}-${String(nextNumber).padStart(3, '0')}`
}

/**
 * Alta de una auditoría con su código automático y su evento AUDIT_CREATED en la MISMA transacción.
 * El código es único dentro de la empresa: se toma advisory lock sobre companyId, se escanean los
 * códigos de la empresa y se emite el siguiente libre. El índice único (processId, code) actúa
 * como red de seguridad y withCodeRetry reinicia la transacción ante un hipotético conflicto.
 * Los vínculos con procesos y procedimientos adicionales (ya validados contra la empresa por la
 * ruta) se crean en la misma transacción: una auditoría nunca queda a medias.
 */
const createAuditWithCode = async (db: PrismaClient, actor: RiskAuditActor, processId: string, companyId: string, data: Omit<Prisma.AuditUncheckedCreateInput, 'code' | 'processId'>, relations?: { processIds?: string[]; procedureIds?: string[] }): Promise<AuditWithInclude> => {
  return withCodeRetry(() => db.$transaction(async (tx) => {
    if (typeof tx.$queryRaw === 'function') {
      await tx.$queryRaw`
        WITH advisory_lock AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtext(${companyId}))
        )
        SELECT true AS locked
        FROM advisory_lock
      `
    }
    const existing = await tx.audit.findMany({
      where: { process: { companyId } },
      select: { code: true },
    })
    const code = nextAuditCode(existing.map((audit) => audit.code))
    const audit = await tx.audit.create({ data: { ...data, processId, code }, include: auditInclude })
    const relatedProcessIds = [...new Set(relations?.processIds ?? [])].filter((id) => id !== processId)
    const procedureIds = [...new Set(relations?.procedureIds ?? [])]
    if (relatedProcessIds.length > 0) {
      await tx.auditProcess.createMany({
        data: relatedProcessIds.map((relatedId) => ({ auditId: audit.id, processId: relatedId })),
        skipDuplicates: true,
      })
    }
    if (procedureIds.length > 0) {
      await tx.auditProcedure.createMany({
        data: procedureIds.map((procedureId) => ({ auditId: audit.id, procedureId })),
        skipDuplicates: true,
      })
    }
    await auditEventWrite(tx, {
      auditId: audit.id,
      eventType: 'AUDIT_CREATED',
      summary: `Auditoría ${code} creada`,
      actor,
      changes: auditCreationChanges(audit),
      ...(relatedProcessIds.length > 0 || procedureIds.length > 0
        ? { metadata: { relatedProcessIds, procedureIds } }
        : {}),
    })
    return audit
  }))
}

const actionItemToTicketStatus: Record<ActionItemStatus, TicketStatus> = {
  [ActionItemStatus.PENDING]: TicketStatus.OPEN,
  [ActionItemStatus.IN_PROGRESS]: TicketStatus.IN_PROGRESS,
  [ActionItemStatus.COMPLETED]: TicketStatus.RESOLVED,
  [ActionItemStatus.CANCELLED]: TicketStatus.CLOSED,
}

const actionItemToTicketPriority: Record<Priority, TicketPriority> = {
  [Priority.LOW]: TicketPriority.LOW,
  [Priority.MEDIUM]: TicketPriority.MEDIUM,
  [Priority.HIGH]: TicketPriority.HIGH,
}

/**
 * Sentido inverso de actionItemToTicketStatus, usado solo por PATCH /api/tickets/:id: es la única
 * escritura que llega desde la pantalla de Tickets, y ahí quien decide el estado es el ticket. La
 * tarea vinculada es la fuente de verdad que Ponderación lee para el progreso de sus tarjetas
 * (ActionItem.status), así que acompañe el cambio. Resuelto y cerrado cuentan como terminados para
 * la tarea, y solo se sincroniza cuando el estado del ticket cambia de verdad: un ticket que ya
 * estaba cerrado por una cancelación no se marca completado al editarlo sin tocar el estado.
 */
const ticketStatusToActionItemStatus: Record<TicketStatus, ActionItemStatus> = {
  [TicketStatus.OPEN]: ActionItemStatus.PENDING,
  [TicketStatus.IN_PROGRESS]: ActionItemStatus.IN_PROGRESS,
  [TicketStatus.RESOLVED]: ActionItemStatus.COMPLETED,
  [TicketStatus.CLOSED]: ActionItemStatus.COMPLETED,
}

/**
 * Aviso "el plan de mitigación quedó completo": se lo manda al creador del riesgo y a su dueño
 * (sin duplicar ids si son la misma persona; si un riesgo legado no tiene evento de creación o no
 * tiene dueño, el destinatario faltante se descarta y con ninguno no se avisa).
 *
 * Se ejecuta DESPUÉS de escribir la actividad completada y DENTRO de la misma transacción de
 * negocio: la condición se evalúa sobre los datos reales de esa transacción (misma vista de los
 * planes y actividades que acaba de modificar la petición), no sobre un snapshot leído antes de
 * empezar. Así dos peticiones concurrentes que cierren el último pendiente juntas no pueden dejar
 * el plan completo sin aviso, porque cada transacción ve primero su propia escritura y luego
 * espera la otra antes de decidir.
 *
 * El aviso es idempotente por diseño (mismo link por usuario): antes de insertar se busca ya
 * existente con ese link, y solo si no está se crea. La comprobación vive en la misma
 * transacción, así que en la carrera entre dos cierres simultáneos la segunda transacción se queda
 * esperando y al leer ve la notificación que ya insertó la primera. Preferimos que en el peor
 * caso (una doble escritura de la notificación a milisegundos de distancia, ante el mismo enlace)
 * se repita el aviso a que un cierre concurrente deje el riesgo completo sin notificar a nadie.
 */
const notifyMitigationPlanCompleted = async (client: RiskAuditClient, actionPlanId: string): Promise<void> => {
  const plan = await client.actionPlan.findUnique({ where: { id: actionPlanId }, select: { id: true, riskId: true } })
  // Plan sin riesgo asociado (p. ej. las tareas generadas desde ponderación, o un plan todavía
  // no vinculado): no hay riesgo cuya mitigación haya terminado.
  if (!plan?.riskId) return
  const risk = await client.risk.findUnique({
    where: { id: plan.riskId },
    select: {
      id: true,
      code: true,
      name: true,
      processId: true,
      riskOwnerId: true,
      // Quien se comprometió con ejecutar la mitigación: si el riesgo lo tiene, el aviso es solo
      // para él (los destinatarios resuelven el resto: sin responsable, creador + dueño).
      mitigationOwnerId: true,
      // El creador no es una columna del riesgo: queda en el historial como RISK_CREATED.
      auditEvents: {
        where: { eventType: RiskAuditEventType.RISK_CREATED },
        orderBy: { occurredAt: 'asc' },
        take: 1,
        select: { actorId: true },
      },
      // El estado se lee de las relaciones persistidas: si el riesgo no tiene planes, o uno de
      // sus planes quedó sin actividades, no hay nada completado. El ticket de cada actividad
      // viaja junto (cuando existe) para corroborar que su estado real también está cerrado.
      mitigationPlans: { select: { id: true, items: { select: { status: true, ticket: { select: { status: true } } } } } },
    },
  })
  if (!risk) return
  const plansSnapshot = risk.mitigationPlans.map((plan) => ({
    id: plan.id,
    items: plan.items.map((item) => ({ status: item.status, ticketStatus: item.ticket?.status ?? null })),
  }))
  if (!mitigationPlansCompleted(plansSnapshot)) return
  const candidateIds = mitigationNotificationRecipients(risk.mitigationOwnerId, risk.riskOwnerId, risk.auditEvents[0]?.actorId)
  if (candidateIds.length === 0) return
  const recipients = await client.user.findMany({ where: { id: { in: candidateIds } }, select: { id: true } })
  const link = riskResidualSectionLink(risk.processId, risk.id)
  const { title, body } = mitigationCompletedNotification(risk)
  for (const recipient of recipients) {
    const existing = await client.notification.findFirst({ where: { userId: recipient.id, link }, select: { id: true } })
    if (existing) continue
    await client.notification.create({ data: { userId: recipient.id, title, body, link } })
  }
}

/**
 * Aviso "tu asignaste un ticket": cuando una actividad (o un ticket manual) queda con
 * responsable, esa persona recibe el aviso in-app con enlace directo al ticket. Idempotente por
 * diseño, igual que el resto de avisos: el link es "tickets/<id>", así que si el ticket se
 * reasigna (o vuelve a alguien ya avisado) no se acumulan copias del mismo aviso, y el que se
 * asigna a sí mismo no se avisa.
 *
 * Se invoca dentro de la transacción que escribe la asignación: si la petición acaba fallando,
 * el aviso tampoco queda suelto apuntando a un cambio que no llegó a ocurrir. El creador del
 * ticket no recibe aviso propio (ya está viendo lo que hizo).
 */
const notifyTicketAssigned = async (client: RiskAuditClient, ticket: { id: string; title: string }, assigneeId: string | null, actorId: string): Promise<void> => {
  if (!assigneeId || assigneeId === actorId) return
  const link = ticketAssignmentNotificationLink(ticket.id)
  const existing = await client.notification.findFirst({ where: { userId: assigneeId, link }, select: { id: true } })
  if (existing) return
  await client.notification.create({
    data: {
      userId: assigneeId,
      title: `Ticket asignado: ${ticket.title}`,
      body: `Se te asignó el ticket «${ticket.title}». Ábrelo para revisar el detalle y trabajar en él.`,
      link,
    },
  })
}

const ticketDataFromActionItem = (item: { title: string; description: string; status: ActionItemStatus; priority: Priority; responsibleId: string | null; dueDate: Date | null; actionItemId: string; createdById: string }) => ({
  title: item.title,
  description: item.description,
  status: actionItemToTicketStatus[item.status],
  priority: actionItemToTicketPriority[item.priority],
  assignedToId: item.responsibleId,
  dueDate: item.dueDate,
  actionItemId: item.actionItemId,
  createdById: item.createdById,
})

/**
 * Reúne las estrategias de un diagnóstico desde sus tres fuentes y les engancha la ponderación que
 * ya está guardada: los cruces desde StrategicCrossWeighting, y las de IA y Checky desde
 * StrategyWeighting, que se localiza por el hash del texto. Es de solo lectura.
 *
 * Vive fuera de las rutas a propósito: la lectura la usa GET /diagnostics/:id/strategies y también
 * la revalidación de PUT /diagnostics/:id/strategies/weighting, que necesita exactamente la misma
 * consolidación para comprobar que un sourceRef recibido de verdad pertenece a este diagnóstico. Si
 * las dos rutas tuvieran su propia consulta, el ancla que valida una podría no ser la que ve la otra.
 * acceptedOnly se usa exclusivamente por Ponderación para recibir la lista de estrategias aceptadas
 * en Checky; el contexto de Checky conserva la consolidación completa.
 */
const loadDiagnosticStrategies = async (db: PrismaClient, diagnosticId: string, acceptedOnly = false): Promise<StrategyForPrioritization[]> => {
  const [analysis, crosses, acceptedSuggestions, storedWeightings, strategyTaskPlans] = await Promise.all([
    db.aIAnalysis.findUnique({ where: { diagnosticId }, select: { id: true, foStrategies: true, doStrategies: true, faStrategies: true, daStrategies: true } }),
    db.strategicCross.findMany({ where: { diagnosticId }, include: { ...crossInclude, weighting: true }, orderBy: { updatedAt: 'desc' } }),
    // El filtro por diagnosticId en la sesión es lo que mantiene el aislamiento: una sugerencia de
    // otra empresa nunca llega a la lista aunque el id del mensaje sea válido.
    db.checkyMessage.findMany({
      where: { role: 'CHECKY', status: 'ACCEPTED', session: { diagnosticId } },
      select: { id: true, category: true, evidenceIds: true, suggestedStrategyTitle: true, suggestedStrategyDescription: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    db.strategyWeighting.findMany({ where: { diagnosticId } }),
    db.actionPlan.findMany({
      where: { diagnosticId, strategySource: { not: null }, strategySourceRef: { not: null } },
      select: {
        id: true,
        strategySource: true,
        strategySourceRef: true,
        strategyTitle: true,
        strategyDescription: true,
        items: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            title: true,
            status: true,
            responsibleId: true,
            responsible: { select: { id: true, name: true } },
            dueDate: true,
            ticket: { select: { id: true, status: true } },
          },
        },
      },
    }),
  ])

  const aiStrategies: AiStrategySource[] = []
  if (analysis) {
    const byQuadrant = { FO: analysis.foStrategies, DO: analysis.doStrategies, FA: analysis.faStrategies, DA: analysis.daStrategies }
    for (const quadrant of AI_STRATEGY_QUADRANTS) {
      readAiStrategyTexts(byQuadrant[quadrant]).forEach((text, index) => aiStrategies.push({ analysisId: analysis.id, quadrant, index, text }))
    }
  }

  // Los factores citados por la sugerencia solo se leen si hay sugerencias que resolver, y siempre
  // acotados a este diagnóstico. Si la pareja viene de un cruce citado, se traen además los factores
  // de ese cruce: son los que hay que validar para saber si la sugerencia sí tiene pareja DOFA.
  const crossRefs: CheckyCrossRef[] = crosses.map((cross) => ({ id: cross.id, factor1Id: cross.factor1Id, factor2Id: cross.factor2Id }))
  const citedCrossIds = new Set(acceptedSuggestions.flatMap((suggestion) => suggestion.evidenceIds).filter((id) => crossRefs.some((cross) => cross.id === id)))
  const citedFactorIds = new Set([
    ...acceptedSuggestions.flatMap((suggestion) => suggestion.evidenceIds),
    ...crossRefs.filter((cross) => citedCrossIds.has(cross.id)).flatMap((cross) => [cross.factor1Id, cross.factor2Id]),
  ])
  const citedItems = citedFactorIds.size > 0
    ? await db.sWOTItem.findMany({ where: { id: { in: [...citedFactorIds] }, swot: { diagnosticId } }, select: { id: true, type: true, description: true } })
    : []
  const factorById = new Map<string, StrategyFactor>(citedItems.map((item) => [item.id, { id: item.id, type: item.type, description: item.description }]))

  // Mismo gate que en la escritura: una sugerencia de estrategia sin pareja DOFA válida no se
  // proyecta en Checky ni en los endpoints de estrategias, aunque esté aceptada y guardada.
  const usableSuggestions = filterCheckySuggestions(acceptedSuggestions, citedItems, crossRefs)
  // Una sugerencia puede citar el cruce en lugar de los dos factores: la pareja ya se resolvió arriba,
  // así que aquí se desdobla el cruce en sus factores para que la estrategia muestre de qué DOFA vive.
  const factorsOfCitedCross = new Map(crossRefs.filter((cross) => citedCrossIds.has(cross.id)).map((cross) => [cross.id, [cross.factor1Id, cross.factor2Id]]))
  const checkySuggestions: CheckyStrategySource[] = usableSuggestions.map((suggestion) => ({
    messageId: suggestion.id,
    category: suggestion.category ?? '',
    evidenceIds: suggestion.evidenceIds,
    title: suggestion.suggestedStrategyTitle,
    description: suggestion.suggestedStrategyDescription,
    factors: suggestion.evidenceIds
      .flatMap((id) => factorsOfCitedCross.get(id) ?? [id])
      .map((id) => factorById.get(id))
      .filter((item): item is StrategyFactor => item !== undefined),
  }))

  const crossSources: CrossStrategySource[] = crosses.map((cross) => ({
    id: cross.id,
    crossType: cross.crossType,
    origin: cross.origin,
    factor1: { id: cross.factor1.id, type: cross.factor1.type, description: cross.factor1.description },
    factor2: { id: cross.factor2.id, type: cross.factor2.type, description: cross.factor2.description },
    strategy: cross.strategy,
    strategyStatus: cross.strategyStatus,
    weighting: cross.weighting
      ? {
          id: cross.weighting.id,
          crossId: cross.weighting.crossId,
          impactoEstrategico: cross.weighting.impactoEstrategico,
          viabilidad: cross.weighting.viabilidad,
          urgencia: cross.weighting.urgencia,
          sinergiaInterna: cross.weighting.sinergiaInterna,
          impactoReputacional: cross.weighting.impactoReputacional,
          weightedScore: cross.weighting.weightedScore,
        }
      : null,
  }))

  const sources = acceptedOnly
    ? (() => {
        // Ponderación muestra la aceptación explícita hecha en Checky, y esa pantalla acepta dos
        // cosas: las sugerencias de Checky y la estrategia de un cruce de la matriz DOFA que la
        // persona aceptó ahí mismo. El cruce entra con su fuente STRATEGIC_CROSS y con la
        // ponderación que ya tiene en la matriz; el análisis con IA sigue fuera.
        // Un texto que ya es una sugerencia aceptada no se suma dos veces: gana la sugerencia, que
        // es la que la persona vio aceptar y la que desde aquí se puede valorar.
        const acceptedByText = new Set(checkySuggestions.map((suggestion) => normalizeStrategyText(suggestion.description ?? '')))
        const acceptedCrosses = crossSources.filter((cross) => {
          const description = cross.strategy?.trim() ?? ''
          return description.length > 0 && cross.strategyStatus === 'ACCEPTED' && !acceptedByText.has(normalizeStrategyText(description))
        })
        return { crosses: acceptedCrosses, aiStrategies: [], checkySuggestions, includeMissingCrossStrategies: true }
      })()
    : { crosses: crossSources, aiStrategies, checkySuggestions }
  const strategies = collectStrategies({ ...sources, weightings: indexStrategyWeightings(storedWeightings) })
  return strategies.map((strategy) => ({
    ...strategy,
    actionPlan: strategyTaskPlans.find((plan) => plan.strategySource === strategy.source && plan.strategySourceRef === strategySourceRef(strategy.description)) ?? null,
  }))
}

const sanitizedStrategyView = (strategy: StrategyForPrioritization, items: readonly SwotTextItem[]): StrategyForPrioritization => ({
  ...strategy,
  title: sanitizeTextWithSwotItems(strategy.title, items),
  description: sanitizeTextWithSwotItems(strategy.description, items),
  actionPlan: strategy.actionPlan
    ? {
        ...strategy.actionPlan,
        strategyTitle: strategy.actionPlan.strategyTitle === null ? null : sanitizeTextWithSwotItems(strategy.actionPlan.strategyTitle, items),
        strategyDescription: strategy.actionPlan.strategyDescription === null ? null : sanitizeTextWithSwotItems(strategy.actionPlan.strategyDescription, items),
      }
    : null,
})

const sanitizeCrossAnalysis = (analysis: CrossAnalysisResult, items: readonly SwotTextItem[]): CrossAnalysisResult => ({
  ...analysis,
  relevance: sanitizeTextWithSwotItems(analysis.relevance, items),
  strategy: sanitizeTextWithSwotItems(analysis.strategy, items),
  expectedImpact: sanitizeTextWithSwotItems(analysis.expectedImpact, items),
  risks: analysis.risks.map((text) => sanitizeTextWithSwotItems(text, items)),
  opportunities: analysis.opportunities.map((text) => sanitizeTextWithSwotItems(text, items)),
  recommendation: sanitizeTextWithSwotItems(analysis.recommendation, items),
})

const strategyBandToActionPriority: Record<string, Priority> = {
  INMEDIATA: Priority.HIGH,
  CORTO_PLAZO: Priority.HIGH,
  MEDIANO_PLAZO: Priority.MEDIUM,
  LARGO_PLAZO: Priority.LOW,
}


export const createApp = (db: PrismaClient = prisma, aiService: AIService = new AIService()) => {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', env.TRUST_PROXY_HOPS)
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Permitted-Cross-Domain-Policies', 'none')
    response.setHeader('Cache-Control', 'no-store')
    if (env.NODE_ENV === 'production') response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    next()
  })

  const authMiddleware = authenticate(db)
  const userWriteGuard = requireRole(Role.SUPERUSER, Role.COMPANY_ADMIN)
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts' } })
  const aiAnalysisLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many AI analysis requests' } })
  const checkyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many Checky consultation requests' } })

  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))

  app.post('/api/auth/login', loginLimiter, asyncHandler(async (request, response) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid credentials format' })
      return
    }
    const user = await db.user.findUnique({ where: { email: parsed.data.email } })
    const valid = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
    if (!user || !valid) {
      response.status(401).json({ error: 'Invalid email or password' })
      return
    }
    await createSession(db, user.id, response)
    response.json({ user: publicUser(user) })
  }))

  app.post('/api/auth/logout', asyncHandler(async (request, response) => {
    const token = request.cookies?.[env.SESSION_COOKIE]
    if (token) {
      await db.session.deleteMany({ where: { tokenHash: createHash('sha256').update(token).digest('hex') } })
    }
    clearSessionCookie(response)
    response.status(204).send()
  }))

  app.get('/api/auth/me', authMiddleware, (request, response) => response.json({ user: request.user }))

  app.get('/api/users', authMiddleware, asyncHandler(async (request, response) => {
    const where: Prisma.UserWhereInput = request.user?.role === Role.SUPERUSER ? {} : { companyId: request.user?.companyId ?? 'none' }
    const users = await db.user.findMany({ where, select: { id: true, name: true, role: true, companyId: true }, orderBy: { name: 'asc' } })
    response.json({ users })
  }))

  app.post('/api/users', authMiddleware, asyncHandler(async (request, response) => {
    if (request.user?.role === Role.COMPANY_USER) {
      response.status(403).json({ error: 'Insufficient permissions' })
      return
    }
    const parsed = userCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid user data', details: parsed.error.issues })
      return
    }
    const { password, role, companyId: requestedCompanyId } = parsed.data
    if (role === Role.SUPERUSER) {
      response.status(403).json({ error: 'Superuser accounts cannot be created from the application' })
      return
    }
    let companyId = requestedCompanyId ?? null
    if (request.user?.role === Role.COMPANY_ADMIN) {
      if (role !== Role.COMPANY_USER) {
        response.status(403).json({ error: 'Company admins can only create company users' })
        return
      }
      if (requestedCompanyId !== undefined && requestedCompanyId !== request.user?.companyId) {
        response.status(403).json({ error: 'You can only create users for your own company' })
        return
      }
      companyId = request.user?.companyId ?? null
    } else if (!companyId) {
      response.status(400).json({ error: 'A company is required for company roles' })
      return
    }
    if (companyId) {
      const company = await db.company.findUnique({ where: { id: companyId }, select: { id: true } })
      if (!company) {
        response.status(400).json({ error: 'Company not found' })
        return
      }
    }
    const user = await db.user.create({ data: { name: parsed.data.name, email: parsed.data.email, passwordHash: await bcrypt.hash(password, 12), role, companyId }, select: { id: true, name: true, email: true, role: true, companyId: true } })
    response.status(201).json({ user })
  }))

  app.patch('/api/users/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = userUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid user data', details: parsed.error.issues })
      return
    }
    const existing = await db.user.findUnique({ where: { id: String(request.params.id) }, select: { id: true, role: true, companyId: true } })
    if (!existing) {
      response.status(404).json({ error: 'User not found' })
      return
    }
    if (request.user?.role === Role.COMPANY_ADMIN) {
      if (existing.companyId !== request.user.companyId || existing.role !== Role.COMPANY_USER) {
        response.status(404).json({ error: 'User not found' })
        return
      }
      if (parsed.data.role && parsed.data.role !== Role.COMPANY_USER) {
        response.status(403).json({ error: 'Company admins can only manage company users' })
        return
      }
      if (parsed.data.companyId !== undefined && parsed.data.companyId !== request.user.companyId) {
        response.status(403).json({ error: 'You can only manage users of your own company' })
        return
      }
    } else if (request.user?.role === Role.SUPERUSER) {
      if (parsed.data.role === Role.SUPERUSER) {
        response.status(403).json({ error: 'Superuser accounts cannot be created from the application' })
        return
      }
      if (existing.role === Role.SUPERUSER && (parsed.data.role || parsed.data.companyId !== undefined)) {
        response.status(403).json({ error: 'A superuser account cannot change its role or company' })
        return
      }
    }
    const finalRole = parsed.data.role ?? existing.role
    const finalCompanyId = parsed.data.companyId !== undefined ? parsed.data.companyId : existing.companyId
    if (finalRole !== Role.SUPERUSER && !finalCompanyId) {
      response.status(400).json({ error: 'A company is required for company roles' })
      return
    }
    if (finalRole === Role.SUPERUSER && finalCompanyId) {
      response.status(400).json({ error: 'A superuser cannot belong to a company' })
      return
    }
    const data: { name?: string; email?: string; passwordHash?: string; role?: Role; companyId?: string | null } = {}
    if (parsed.data.name) data.name = parsed.data.name
    if (parsed.data.email) data.email = parsed.data.email
    if (parsed.data.password) data.passwordHash = await bcrypt.hash(parsed.data.password, 12)
    if (parsed.data.role && parsed.data.role !== existing.role) data.role = parsed.data.role
    if (parsed.data.companyId !== undefined && parsed.data.companyId !== existing.companyId) data.companyId = parsed.data.companyId
    const user = await db.user.update({ where: { id: existing.id }, data, select: { id: true, name: true, email: true, role: true, companyId: true } })
    response.json({ user })
  }))

  app.delete('/api/users/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const existing = await db.user.findUnique({ where: { id: String(request.params.id) }, select: { id: true, role: true, companyId: true } })
    if (!existing) {
      response.status(404).json({ error: 'User not found' })
      return
    }
    if (request.user?.role === Role.COMPANY_ADMIN) {
      if (existing.companyId !== request.user.companyId || existing.role !== Role.COMPANY_USER) {
        response.status(404).json({ error: 'User not found' })
        return
      }
    }
    if (existing.role === Role.SUPERUSER) {
      response.status(403).json({ error: 'Superuser accounts cannot be deleted' })
      return
    }
    if (existing.id === request.user?.id) {
      response.status(403).json({ error: 'You cannot delete your own account' })
      return
    }
    await db.user.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  app.get('/api/companies', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = companyQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid company filters', details: parsed.error.issues })
      return
    }
    const where: Prisma.CompanyWhereInput = scopeForCompany(request)
    if (parsed.data.search) {
      where.OR = [
        { name: { contains: parsed.data.search, mode: 'insensitive' } },
        { identification: { contains: parsed.data.search, mode: 'insensitive' } },
        { industry: { contains: parsed.data.search, mode: 'insensitive' } },
      ]
    }
    const companies = await db.company.findMany({ where, include: companyInclude, orderBy: { updatedAt: 'desc' } })
    response.json({ companies: companies.map(companyView) })
  }))

  app.post('/api/companies', authMiddleware, requireRole(Role.SUPERUSER), asyncHandler(async (request, response) => {
    const parsed = companyCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid company data', details: parsed.error.issues })
      return
    }
    const admin = parsed.data.admin
    const company = await db.company.create({
      data: {
        name: parsed.data.name,
        identification: parsed.data.identification,
        industry: parsed.data.industry,
        description: parsed.data.description,
        ...(admin ? { users: { create: { name: admin.name, email: admin.email, passwordHash: await bcrypt.hash(admin.password, 12), role: Role.COMPANY_ADMIN } } } : {}),
      },
      include: companyInclude,
    })
    response.status(201).json({ company: companyView(company) })
  }))

  app.get('/api/companies/:id', authMiddleware, asyncHandler(async (request, response) => {
    const company = await db.company.findUnique({ where: { id: String(request.params.id) }, include: companyInclude })
    if (!company || !canAccessCompany(request, company)) {
      response.status(404).json({ error: 'Company not found' })
      return
    }
    response.json({ company: companyView(company) })
  }))

  app.patch('/api/companies/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = companyUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid company data', details: parsed.error.issues })
      return
    }
    const existing = await db.company.findUnique({ where: { id: String(request.params.id) }, select: { id: true } })
    if (!existing || !canAccessCompany(request, existing)) {
      response.status(404).json({ error: 'Company not found' })
      return
    }
    const company = await db.company.update({ where: { id: existing.id }, data: parsed.data, include: companyInclude })
    response.json({ company: companyView(company) })
  }))

  app.delete('/api/companies/:id', authMiddleware, requireRole(Role.SUPERUSER), asyncHandler(async (request, response) => {
    const existing = await db.company.findUnique({ where: { id: String(request.params.id) }, select: { id: true } })
    if (!existing) {
      response.status(404).json({ error: 'Company not found' })
      return
    }
    await db.company.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  app.get('/api/companies/:companyId/diagnostics', authMiddleware, asyncHandler(async (request, response) => {
    const company = await db.company.findUnique({ where: { id: String(request.params.companyId) }, select: { id: true } })
    if (!company || !canAccessCompany(request, company)) {
      response.status(404).json({ error: 'Company not found' })
      return
    }
    const diagnostics = await db.qualityDiagnostic.findMany({ where: { companyId: company.id }, include: diagnosticInclude, orderBy: { updatedAt: 'desc' } })
    response.json({ diagnostics: diagnostics.map(diagnosticView) })
  }))

  app.post('/api/companies/:companyId/diagnostics', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = diagnosticCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid diagnostic data', details: parsed.error.issues })
      return
    }
    const company = await db.company.findUnique({ where: { id: String(request.params.companyId) }, select: { id: true } })
    if (!company || !canAccessCompany(request, company)) {
      response.status(404).json({ error: 'Company not found' })
      return
    }
    const diagnostic = await db.qualityDiagnostic.create({
      data: { companyId: company.id, title: parsed.data.title, description: parsed.data.description, status: parsed.data.status, createdById: request.user!.id, swotAnalysis: { create: {} } },
      include: diagnosticInclude,
    })
    response.status(201).json({ diagnostic: diagnosticView(diagnostic) })
  }))

  app.get('/api/diagnostics/:id', authMiddleware, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: diagnosticInclude })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    response.json({ diagnostic: diagnosticView(diagnostic) })
  }))

  app.patch('/api/diagnostics/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = diagnosticUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid diagnostic data', details: parsed.error.issues })
      return
    }
    const existing = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!existing || !canAccessCompany(request, existing.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const diagnostic = await db.qualityDiagnostic.update({ where: { id: existing.id }, data: parsed.data, include: diagnosticInclude })
    response.json({ diagnostic: diagnosticView(diagnostic) })
  }))

  app.delete('/api/diagnostics/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const existing = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!existing || !canAccessCompany(request, existing.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    await db.qualityDiagnostic.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  /**
   * Any user assigned to a process resource must belong to the process company. The id comes from
   * the client, so the company check stays on the server even when the UI filters the directory.
   */
  const resolveUserInCompany = async (userId: string | null | undefined, companyId: string, roleLabel: 'responsible' | 'risk owner' | 'mitigation responsible' | 'lead auditor' | 'audit responsible' | 'finding responsible' | 'action responsible'): Promise<{ ok: true; userId: string | null } | { ok: false; status: number; error: string }> => {
    if (!userId) return { ok: true, userId: null }
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, companyId: true } })
    const label = roleLabel === 'risk owner' ? 'Risk owner'
      : roleLabel === 'mitigation responsible' ? 'Mitigation responsible'
      : roleLabel === 'lead auditor' ? 'Lead auditor'
      : roleLabel === 'audit responsible' ? 'Audit responsible'
      : roleLabel === 'finding responsible' ? 'Finding responsible'
      : roleLabel === 'action responsible' ? 'Action responsible'
      : 'Responsible'
    if (!user) return { ok: false, status: 400, error: `${label} user not found` }
    if (user.companyId !== companyId) return { ok: false, status: 403, error: `You can only assign a ${roleLabel} from your own company` }
    return { ok: true, userId }
  }

  const resolveResponsible = async (responsibleId: string | null | undefined, companyId: string) => {
    const resolved = await resolveUserInCompany(responsibleId, companyId, 'responsible')
    return resolved.ok ? { ok: true as const, responsibleId: resolved.userId } : resolved
  }

  /** El nombre identifica el proceso dentro de la empresa, y solo dentro de ella. */
  const duplicateProcessName = async (companyId: string, name: string, exceptId?: string) => db.process.findFirst({
    where: { companyId, name, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  })

  app.get('/api/processes', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = processQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid filters', details: parsed.error.issues })
      return
    }
    let where: Prisma.ProcessWhereInput = scopeForProcess(request)
    if (parsed.data.companyId) {
      const company = await db.company.findUnique({ where: { id: parsed.data.companyId }, select: { id: true } })
      if (!company || !canAccessCompany(request, company)) {
        response.status(404).json({ error: 'Company not found' })
        return
      }
      where = { companyId: company.id }
    }
    const processes = await db.process.findMany({ where, include: processInclude, orderBy: [{ type: 'asc' }, { name: 'asc' }] })
    response.json({ processes: processes.map(processView) })
  }))

  app.post('/api/processes', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = processCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid process data', details: parsed.error.issues })
      return
    }
    // La empresa nunca sale del cuerpo de la petición para un rol de empresa: sale de la sesión.
    let companyId: string
    if (request.user?.role === Role.SUPERUSER) {
      if (!parsed.data.companyId) {
        response.status(400).json({ error: 'A company is required' })
        return
      }
      const company = await db.company.findUnique({ where: { id: parsed.data.companyId }, select: { id: true } })
      if (!company) {
        response.status(400).json({ error: 'Company not found' })
        return
      }
      companyId = company.id
    } else {
      if (parsed.data.companyId && parsed.data.companyId !== request.user?.companyId) {
        response.status(403).json({ error: 'You can only create processes for your own company' })
        return
      }
      if (!request.user?.companyId) {
        response.status(400).json({ error: 'A company is required for company roles' })
        return
      }
      companyId = request.user.companyId
    }
    const responsible = await resolveResponsible(parsed.data.responsibleId, companyId)
    if (!responsible.ok) {
      response.status(responsible.status).json({ error: responsible.error })
      return
    }
    if (await duplicateProcessName(companyId, parsed.data.name)) {
      response.status(409).json({ error: 'A process with that name already exists in this company' })
      return
    }
    const process = await createProcessWithCode(db, request.user!, companyId, {
      companyId,
      name: parsed.data.name,
      type: parsed.data.type,
      version: '1.0',
      frequency: parsed.data.frequency || null,
      organizationalArea: parsed.data.organizationalArea || null,
      supervision: parsed.data.supervision || null,
      executionType: parsed.data.executionType || null,
      objective: parsed.data.objective,
      description: parsed.data.description || null,
      status: parsed.data.status ?? 'ACTIVE',
      thirdPartyProvided: parsed.data.thirdPartyProvided ?? false,
      critical: parsed.data.critical ?? false,
      affectsAccounting: parsed.data.affectsAccounting ?? false,
      personalData: parsed.data.personalData ?? false,
      responsibleId: responsible.responsibleId,
    })
    response.status(201).json({ process: processView(process) })
  }))

  app.get('/api/processes/:id', authMiddleware, asyncHandler(async (request, response) => {
    const process = await db.process.findUnique({ where: { id: String(request.params.id) }, include: processInclude })
    if (!process || !canAccessCompany(request, process.company)) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    response.json({ process: processView(process) })
  }))

  app.patch('/api/processes/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = processUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid process data', details: parsed.error.issues })
      return
    }
    const existing = await db.process.findUnique({ where: { id: String(request.params.id) }, include: processInclude })
    if (!existing || !canAccessCompany(request, existing.company)) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    if (parsed.data.name !== undefined && await duplicateProcessName(existing.companyId, parsed.data.name, existing.id)) {
      response.status(409).json({ error: 'A process with that name already exists in this company' })
      return
    }
    if (parsed.data.responsibleId) {
      const responsible = await resolveResponsible(parsed.data.responsibleId, existing.companyId)
      if (!responsible.ok) {
        response.status(responsible.status).json({ error: responsible.error })
        return
      }
    }
    const data: Prisma.ProcessUncheckedUpdateInput = {}
    if (parsed.data.name !== undefined) data.name = parsed.data.name
    if (parsed.data.objective !== undefined) data.objective = parsed.data.objective
    if (parsed.data.description !== undefined) data.description = parsed.data.description || null
    if (parsed.data.frequency !== undefined) data.frequency = parsed.data.frequency || null
    if (parsed.data.organizationalArea !== undefined) data.organizationalArea = parsed.data.organizationalArea || null
    if (parsed.data.supervision !== undefined) data.supervision = parsed.data.supervision || null
    if (parsed.data.executionType !== undefined) data.executionType = parsed.data.executionType || null
    if (parsed.data.status !== undefined) data.status = parsed.data.status
    if (parsed.data.responsibleId !== undefined) data.responsibleId = parsed.data.responsibleId
    if (parsed.data.thirdPartyProvided !== undefined) data.thirdPartyProvided = parsed.data.thirdPartyProvided
    if (parsed.data.critical !== undefined) data.critical = parsed.data.critical
    if (parsed.data.affectsAccounting !== undefined) data.affectsAccounting = parsed.data.affectsAccounting
    if (parsed.data.personalData !== undefined) data.personalData = parsed.data.personalData
    const update = await updateProcessWithVersion(db, existing.id, request.user!, data)
    if (!update) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    response.json({ process: processView(update.process) })
  }))

  app.delete('/api/processes/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const existing = await db.process.findUnique({ where: { id: String(request.params.id) }, include: processInclude })
    if (!existing || !canAccessCompany(request, existing.company)) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const history = await db.processChange.findFirst({ where: { processId: existing.id }, select: { id: true } })
    if (history) {
      response.status(409).json({ error: 'Process cannot be deleted because it has change history', reason: 'CHANGE_HISTORY' })
      return
    }
    try {
      await db.process.delete({ where: { id: existing.id } })
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'P2003') {
        response.status(409).json({ error: 'Process cannot be deleted because it still has related records (risks, indicators, procedures, audits or SIPOC entries)', reason: 'RELATED_RECORDS' })
        return
      }
      throw error
    }
    response.status(204).send()
  }))

  const findAccessibleProcess = async (request: Request, processId: string) => {
    const process = await db.process.findUnique({ where: { id: processId }, include: { company: { select: { id: true } } } })
    return process && canAccessCompany(request, process.company) ? process : null
  }

  app.get('/api/processes/:processId/change-history', authMiddleware, asyncHandler(async (request, response) => {
    const parsedProcessId = idReference.safeParse(String(request.params.processId))
    if (!parsedProcessId.success) {
      response.status(400).json({ error: 'Invalid process id' })
      return
    }
    const process = await findAccessibleProcess(request, parsedProcessId.data)
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const history = await db.processChange.findMany({
      where: { processId: process.id },
      include: processChangeInclude,
      orderBy: { changedAt: 'desc' },
    })
    response.json({ history: history.map(processChangeView) })
  }))

  /**
   * Historial del ciclo de vida de un riesgo (append-only): solo lectura con paginación y filtros;
   * no existe ningún método que inserte o altere eventos desde una petición. El acceso exige
   * proceso visible para la sesión y que el riesgo pertenezca exactamente a ese proceso (404 en
   * caso contrario, sin filtros que deliten la existencia de recursos ajenos).
   */
  app.get('/api/processes/:processId/risks/:riskId/history', authMiddleware, asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, riskId: idReference }).safeParse({
      processId: String(request.params.processId),
      riskId: String(request.params.riskId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid process id' })
      return
    }
    const parsedQuery = riskAuditQuerySchema.safeParse(request.query)
    if (!parsedQuery.success) {
      response.status(400).json({ error: 'Invalid history query' })
      return
    }
    const process = await findAccessibleProcess(request, parsedIds.data.processId)
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const risk = await db.risk.findUnique({ where: { id: parsedIds.data.riskId }, select: { id: true, processId: true } })
    if (!risk || risk.processId !== process.id) {
      response.status(404).json({ error: 'Risk not found' })
      return
    }
    const { page, pageSize, eventType, from, to } = parsedQuery.data
    const where = {
      riskId: risk.id,
      ...(eventType ? { eventType } : {}),
      ...((from || to) ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    }
    const [total, events] = await Promise.all([
      db.riskAuditEvent.count({ where }),
      db.riskAuditEvent.findMany({
        where,
        include: riskAuditInclude,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    response.json({ events: events.map(riskAuditEventView), total, page, pageSize })
  }))

  const sipocDelegatesFor = (client: ProcessTransaction): Record<SipocKind, SipocDelegate> => ({
    suppliers: client.sipocSupplier as unknown as SipocDelegate,
    inputs: client.sipocInput as unknown as SipocDelegate,
    processes: client.sipocProcess as unknown as SipocDelegate,
    outputs: client.sipocOutput as unknown as SipocDelegate,
    customers: client.sipocCustomer as unknown as SipocDelegate,
  })
  const sipocDelegates = sipocDelegatesFor(db)

  app.get('/api/processes/:processId/sipoc', authMiddleware, asyncHandler(async (request, response) => {
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const [suppliers, inputs, processes, outputs, customers] = await Promise.all(
      (Object.keys(sipocDelegates) as Array<keyof typeof sipocDelegates>).map(async (kind) => [kind, await sipocDelegates[kind].findMany({ where: { processId: process.id }, orderBy: { createdAt: 'asc' } })] as const),
    )
    response.json(Object.fromEntries([suppliers, inputs, processes, outputs, customers].map(([kind, items]) => [kind, items.map(sipocItemView)])))
  }))

  app.post('/api/processes/:processId/sipoc/:kind', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsedKind = sipocKindSchema.safeParse(String(request.params.kind))
    const parsed = sipocItemCreateSchema.safeParse(request.body)
    if (!parsedKind.success) {
      response.status(400).json({ error: 'Invalid SIPOC data', details: parsedKind.error.issues })
      return
    }
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid SIPOC data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const kind = parsedKind.data
    const update = await updateProcessWithVersion(db, process.id, request.user!, {}, async (transaction) => {
      const item = await sipocDelegatesFor(transaction)[kind].create({ data: { processId: process.id, description: parsed.data.description } })
      return { result: item, changes: [] }
    })
    if (!update) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    response.status(201).json({ item: sipocItemView(update.result) })
  }))

  app.patch('/api/processes/:processId/sipoc/:kind/:itemId', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsedKind = sipocKindSchema.safeParse(String(request.params.kind))
    const parsed = sipocItemUpdateSchema.safeParse(request.body)
    if (!parsedKind.success) {
      response.status(400).json({ error: 'Invalid SIPOC data', details: parsedKind.error.issues })
      return
    }
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid SIPOC data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const kind = parsedKind.data
    const update = await updateProcessWithVersion(db, process.id, request.user!, {}, async (transaction) => {
      const delegate = sipocDelegatesFor(transaction)[kind]
      const existing = await delegate.findUnique({ where: { id: String(request.params.itemId) } })
      if (!existing || existing.processId !== process.id) return { result: null, changes: [] }
      if (existing.description === parsed.data.description) return { result: existing, changes: [] }
      const item = await delegate.update({ where: { id: existing.id }, data: { description: parsed.data.description } })
      return { result: item, changes: [sipocChange(kind, existing.description, item.description)] }
    })
    if (!update?.result) {
      response.status(404).json({ error: 'SIPOC item not found' })
      return
    }
    response.json({ item: sipocItemView(update.result) })
  }))

  app.delete('/api/processes/:processId/sipoc/:kind/:itemId', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsedKind = sipocKindSchema.safeParse(String(request.params.kind))
    if (!parsedKind.success) {
      response.status(400).json({ error: 'Invalid SIPOC type', details: parsedKind.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const kind = parsedKind.data
    const update = await updateProcessWithVersion(db, process.id, request.user!, {}, async (transaction) => {
      const delegate = sipocDelegatesFor(transaction)[kind]
      const existing = await delegate.findUnique({ where: { id: String(request.params.itemId) } })
      if (!existing || existing.processId !== process.id) return { result: false, changes: [] }
      await delegate.delete({ where: { id: existing.id } })
      return { result: true, changes: [] }
    })
    if (!update?.result) {
      response.status(404).json({ error: 'SIPOC item not found' })
      return
    }
    response.status(204).send()
  }))

  app.get('/api/processes/:processId/risks', authMiddleware, asyncHandler(async (request, response) => {
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const risks = await db.risk.findMany({ where: { processId: process.id }, include: riskInclude, orderBy: { createdAt: 'asc' } })
    response.json({ risks: risks.map(riskView) })
  }))

  /**
   * Planes de acción que el detalle de un riesgo puede vincular a su plan de mitigación. Son los
   * planes de los diagnósticos de la misma empresa que el proceso (el vínculo plan↔riesgo solo se
   * permite dentro de la compañía), con su progreso de actividades y el riesgo al que apuntan hoy,
   * para que la interfaz muestre los ya vinculados y ofrezca solo los disponibles. Sin este
   * enlace no hay forma de poblar ActionPlan.riskId desde la UI y el aviso de mitigación completa
   * no puede dispararse al cerrar las actividades.
   */
  app.get('/api/processes/:processId/action-plans', authMiddleware, asyncHandler(async (request, response) => {
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const plans = await db.actionPlan.findMany({
      where: { diagnostic: { companyId: process.companyId } },
      select: {
        id: true,
        title: true,
        riskId: true,
        items: { select: { status: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })
    response.json({
      actionPlans: plans.map((plan) => ({
        id: plan.id,
        title: plan.title,
        riskId: plan.riskId,
        itemsTotal: plan.items.length,
        itemsCompleted: plan.items.filter((item) => item.status === ActionItemStatus.COMPLETED).length,
      })),
    })
  }))

  app.post('/api/processes/:processId/risks', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = riskCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid risk data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const riskOwner = await resolveUserInCompany(parsed.data.riskOwnerId, process.companyId, 'risk owner')
    if (!riskOwner.ok) {
      response.status(riskOwner.status).json({ error: riskOwner.error })
      return
    }
    const mitigationOwner = await resolveUserInCompany(parsed.data.mitigationOwnerId, process.companyId, 'mitigation responsible')
    if (!mitigationOwner.ok) {
      response.status(mitigationOwner.status).json({ error: mitigationOwner.error })
      return
    }
    // La categoría sale del proceso, nunca del cuerpo. El riskType del cliente se acepta solo como
    // guarda de compatibilidad con clientes antiguos: si no coincide con la categoría del proceso,
    // el alta se rechaza en lugar de guardar un riesgo con una categoría incompatible.
    const riskCategory = processTypeToRiskCategory[process.type]
    if (parsed.data.riskType !== undefined && parsed.data.riskType !== riskCategory) {
      response.status(400).json({ error: `Risk type must match the process category (${riskCategory})` })
      return
    }
    // Un riesgo nace PENDING y sin decisión autorizada, así que el paso 3 (plan de mitigación) no
    // puede escribirse en la misma petición que lo crea: responsable y vencimiento se registran
    // recién cuando el dueño acepta el riesgo. Sin este gate, el 409 de edición se eludiría con un
    // alta manipulada. El mensaje nombra lo que falta para el paso 3, que es la aceptación.
    if (parsed.data.mitigationOwnerId || parsed.data.mitigationDueDate) {
      response.status(409).json({ error: riskStageMessages['acceptance-pending'] })
      return
    }
    // Un riesgo nace sin controles, así que en el alta solo se admite el residual neutro (1×1).
    // Cualquier otro valor se rechaza explícitamente para no poder eludir la regla desde una
    // petición HTTP; la evaluación residual real comienza con el primer control.
    if (parsed.data.residualImpact !== residualBaselineImpact || parsed.data.residualProbability !== residualBaselineProbability) {
      response.status(400).json({ error: residualRequiresControlsError })
      return
    }
    // El actor de auditoría sale SIEMPRE de la sesión autenticada, nunca del cuerpo de la petición.
    const actor = request.user!
    const risk = await createRiskWithAudit(db, actor, {
      processId: process.id,
      ...parsed.data,
      // Se escribe después del spread para que la categoría derivada del proceso pase siempre por
      // encima de cualquier riskType recibido.
      riskType: riskCategory,
      // Igual regla para la aceptación: un riesgo siempre nace PENDING («Pendiente») y el valor
      // enviado por el cliente, exista o no, se descarta. El veredicto formal solo lo escribe la
      // decisión autorizada del ciclo de aprobación.
      acceptanceStatus: 'PENDING',
      bpmnActivity: parsed.data.bpmnActivity ?? legacyBpmnActivityValue,
      riskOwnerId: riskOwner.userId,
      mitigationOwnerId: mitigationOwner.userId,
    })
    // Si el riesgo nace con dueño, se abre su ciclo de aprobación y se le avisa in-app. Si algo
    // falla aquí el riesgo ya existe y se devuelve igual: el panel permite reenviarlo explícitamente
    // a aprobación, así que un fallo puntual de la notificación no pierde el registro del riesgo.
    const riskOwnerId = risk.riskOwner?.id
    if (riskOwnerId) {
      try {
        // Ciclo + notificación + evento APPROVAL_REQUESTED comparten transacción: nunca queda un
        // ciclo confirmado sin su evento de auditoría.
        await db.$transaction((tx) => createRiskApprovalCycle(tx, { riskId: risk.id, requestedById: actor.id, riskOwnerId, actor, risk }))
      } catch (cycleError) {
        console.error('[risk-approvals] failed to open approval cycle on risk creation', cycleError)
      }
    }
    // El ciclo se abre después de persistir el riesgo: se relee con su include para que la
    // respuesta ya traiga el estado de aprobación real (no el snapshot previo al ciclo).
    const refreshed = await db.risk.findUnique({ where: { id: risk.id }, include: riskInclude })
    response.status(201).json({ risk: riskView(refreshed ?? risk) })
  }))

  app.patch('/api/processes/:processId/risks/:riskId', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = riskUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid risk data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const existing = await db.risk.findUnique({ where: { id: String(request.params.riskId) }, include: riskInclude })
    if (!existing || existing.processId !== process.id) {
      response.status(404).json({ error: 'Risk not found' })
      return
    }
    const data = { ...parsed.data }
    if (parsed.data.riskOwnerId !== undefined) {
      const riskOwner = await resolveUserInCompany(parsed.data.riskOwnerId, process.companyId, 'risk owner')
      if (!riskOwner.ok) {
        response.status(riskOwner.status).json({ error: riskOwner.error })
        return
      }
      data.riskOwnerId = riskOwner.userId
    }
    if (parsed.data.mitigationOwnerId !== undefined) {
      const mitigationOwner = await resolveUserInCompany(parsed.data.mitigationOwnerId, process.companyId, 'mitigation responsible')
      if (!mitigationOwner.ok) {
        response.status(mitigationOwner.status).json({ error: mitigationOwner.error })
        return
      }
      data.mitigationOwnerId = mitigationOwner.userId
    }
    // El tipo de riesgo se deriva del proceso y no es editable. Si el cliente aún lo envía, solo se
    // acepta cuando coincide con la categoría del proceso o con el valor almacenado (eco de un
    // cliente antiguo); en ningún caso se persiste el valor recibido y una categoría incompatible
    // con el proceso rechaza la edición.
    // La aceptación (acceptanceStatus) no pasa por este camino en absoluto: riskUpdateSchema la
    // omite, así que aunque el cuerpo la traiga Zod la descarta antes de llegar aquí y `data` no la
    // contiene. Ningún PATCH puede alterar el veredicto; solo lo hace la decisión del ciclo de
    // aprobación (APPROVE → ACCEPTED, REJECT → REJECTED).
    const riskCategory = processTypeToRiskCategory[process.type]
    if (data.riskType !== undefined && data.riskType !== riskCategory && data.riskType !== existing.riskType) {
      response.status(400).json({ error: `Risk type is derived from the process and cannot be changed (${riskCategory})` })
      return
    }
    delete data.riskType
    // Escrituras del paso 3 (responsable/vencimiento del plan) y del paso 4 (residual): el gate de
    // etapas se comprueba ANTES de que nada de lo anterior, porque un riesgo sin evaluar, sin
    // tratamiento o sin aceptar no admite ninguno de esos avances. Un eco de los valores guardados
    // (el formulario completo que mandan los clientes antiguos) no cuenta como cambio y no bloquea
    // la edición de los campos de los pasos 1 y 2, que siguen siendo editables siempre.
    const planOwnerChanged = data.mitigationOwnerId !== undefined && data.mitigationOwnerId !== existing.mitigationOwnerId
    // El vencimiento se compara a nivel de día (como lo captura el formulario, `input type=date`):
    // así un eco del mismo día nunca se confunde con un cambio y no dispara el gate sin motivo.
    const planDueDateChanged = data.mitigationDueDate !== undefined
      && (data.mitigationDueDate === null
        ? existing.mitigationDueDate !== null
        : existing.mitigationDueDate === null || existing.mitigationDueDate.toISOString().slice(0, 10) !== data.mitigationDueDate.toISOString().slice(0, 10))
    // El residual solo es editable con al menos un control asociado. Un eco del valor almacenado
    // (clientes antiguos que envían el formulario completo) no cuenta como cambio y no bloquea la
    // edición de otros campos. Al eliminar el último control los valores ya guardados se
    // conservan (columnas NOT NULL): quedan bloqueados hasta que exista de nuevo un control.
    const residualChanged = (data.residualImpact !== undefined && data.residualImpact !== existing.residualImpact)
      || (data.residualProbability !== undefined && data.residualProbability !== existing.residualProbability)
    if (planOwnerChanged || planDueDateChanged || residualChanged) {
      const stageLock = riskStageLockError(existing)
      if (stageLock) {
        response.status(409).json({ error: stageLock })
        return
      }
    }
    if (residualChanged && existing.controls.length === 0) {
      response.status(400).json({ error: residualRequiresControlsError })
      return
    }
    // Si el último ciclo quedó APROBADO y cambian datos relevantes del riesgo, ese ciclo pasa a
    // OUTDATED sin alterar la decisión anterior: quién decidió, cuándo y con qué comentario se
    // conservan, y el dueño puede volver a enviar el riesgo corregido con una acción explícita.
    // El ticket generado por el ciclo aprobado queda como está (el trabajo ya se creó). El marcado
    // y su evento ocuren dentro de la transacción definida más abajo, junto con la edición.
    const relevantChanged = (data.name !== undefined && data.name !== existing.name)
      || (data.description !== undefined && data.description !== existing.description)
      || (data.inherentImpact !== undefined && data.inherentImpact !== existing.inherentImpact)
      || (data.inherentProbability !== undefined && data.inherentProbability !== existing.inherentProbability)
    // El código es inmutable: cambiar el proceso o el tipo nunca renumera el identificador histórico.
    // Solo se asigna cuando el riesgo aún no tiene código (dato legado sin clasificar) y, en ese
    // mismo momento, su riskType se completa con la categoría del proceso. Los riesgos que ya
    // tienen código conservan su tipo almacenado aunque sea anterior a esta regla.
    // Toda la escritura (marcado OUTDATED + su evento, edición del riesgo y evento RISK_UPDATED)
    // ocurre en una sola transacción: o se confirma todo con su auditoría, o no se guarda nada.
    const actor = request.user!
    const ownerNames: { riskOwner?: string | null; mitigationOwner?: string | null } = {}
    if (data.riskOwnerId !== undefined && data.riskOwnerId !== existing.riskOwnerId && data.riskOwnerId) {
      ownerNames.riskOwner = (await db.user.findUnique({ where: { id: data.riskOwnerId }, select: { name: true } }))?.name ?? null
    }
    if (data.mitigationOwnerId !== undefined && data.mitigationOwnerId !== existing.mitigationOwnerId && data.mitigationOwnerId) {
      ownerNames.mitigationOwner = (await db.user.findUnique({ where: { id: data.mitigationOwnerId }, select: { name: true } }))?.name ?? null
    }
    const risk = await withCodeRetry(() => db.$transaction(async (tx) => {
      if (relevantChanged) {
        const latestApproval = await tx.riskApproval.findFirst({ where: { riskId: existing.id }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true } })
        if (latestApproval?.status === 'APPROVED') {
          await tx.riskApproval.update({ where: { id: latestApproval.id }, data: { status: 'OUTDATED' } })
          await riskAuditWrite(tx, {
            riskId: existing.id,
            eventType: 'APPROVAL_OUTDATED',
            summary: 'Aprobación marcada para nueva revisión',
            actor,
            metadata: { approvalId: latestApproval.id, previousStatus: 'APPROVED' },
          })
        }
      }
      const updated = existing.code === null
        ? await tx.risk.update({ where: { id: existing.id }, data: { ...data, riskType: riskCategory, code: await nextRiskCodeFor(tx, riskCategory) }, include: riskInclude })
        : await tx.risk.update({ where: { id: existing.id }, data, include: riskInclude })
      // Solo se registra cuando hay variación real: un PATCH que no cambia nada no genera ruido,
      // y la asignación de código legado entra como cambio con su valor anterior (sin código).
      const changes: RiskAuditChange[] = [
        ...(existing.code === null && updated.code !== null ? [{ field: 'code', label: 'Código', previousValue: null, newValue: updated.code } as RiskAuditChange] : []),
        ...updatedRiskChanges(existing, data, ownerNames),
      ]
      if (changes.length > 0) {
        await riskAuditWrite(tx, { riskId: existing.id, eventType: 'RISK_UPDATED', summary: 'Riesgo actualizado', actor, changes })
      }
      return updated
    }))
    response.json({ risk: riskView(risk) })
  }))

  app.delete('/api/processes/:processId/risks/:riskId', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const existing = await db.risk.findUnique({ where: { id: String(request.params.riskId) }, include: riskInclude })
    if (!existing || existing.processId !== process.id) {
      response.status(404).json({ error: 'Risk not found' })
      return
    }
    await db.risk.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  // ---- Aprobación colaborativa de riesgos ----

  app.get('/api/approvals', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = riskApprovalQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid filters', details: parsed.error.issues })
      return
    }
    const approvals = await db.riskApproval.findMany({
      where: { ...approvalVisibilityWhere(request), ...(parsed.data.status ? { status: parsed.data.status } : {}) },
      include: riskApprovalInclude,
      orderBy: { createdAt: 'desc' },
    })
    response.json({ approvals: approvals.map(riskApprovalView) })
  }))

  app.get('/api/approvals/:id', authMiddleware, asyncHandler(async (request, response) => {
    const approval = await db.riskApproval.findUnique({ where: { id: String(request.params.id) }, include: riskApprovalInclude })
    // Fuera de la empresa (o del alcance del usuario) el ciclo simplemente no existe.
    if (!approval || !canDecideApproval(request, approval)) {
      response.status(404).json({ error: 'Approval not found' })
      return
    }
    response.json({ approval: riskApprovalView(approval) })
  }))

  app.post('/api/approvals/:id/decision', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = riskApprovalDecisionSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid approval decision', details: parsed.error.issues })
      return
    }
    const approval = await db.riskApproval.findUnique({ where: { id: String(request.params.id) }, include: riskApprovalInclude })
    if (!approval || !canDecideApproval(request, approval)) {
      response.status(404).json({ error: 'Approval not found' })
      return
    }
    if (approval.status !== 'PENDING') {
      response.status(409).json({ error: 'This approval was already decided' })
      return
    }
    const approving = parsed.data.decision === 'APPROVE'
    try {
      const settled = await db.$transaction(async (tx) => {
        // El guard `status: 'PENDING'` hace que una decisión repetida no pase de largo: si otro
        // usuario ya resolvió el ciclo, count === 0 y no se toca nada (evita doble ticket).
        const guarded = await tx.riskApproval.updateMany({
          where: { id: approval.id, status: 'PENDING' },
          data: { status: approving ? 'APPROVED' : 'REJECTED', openKey: null, decidedById: request.user!.id, decidedAt: new Date(), comment: parsed.data.comment ?? null },
        })
        if (guarded.count === 0) return false
        let createdTicketId: string | null = null
        if (approving) {
          // "Aprobar y aceptar": además del ciclo, el veredicto formal del riesgo queda ACCEPTED.
          await tx.risk.update({ where: { id: approval.riskId }, data: { acceptanceStatus: 'ACCEPTED' } })
          // Ticket único por ciclo (RiskApproval.ticketId es único): un reintento jamás duplica.
          const ticket = await tx.ticket.create({ data: ticketDataFromRiskApproval(approval, request.user!.id), include: ticketInclude })
          await tx.riskApproval.update({ where: { id: approval.id }, data: { ticketId: ticket.id } })
          createdTicketId = ticket.id
        } else {
          // "Rechazar": el veredicto formal queda REJECTED en la MISMA transacción que el ciclo.
          // Es la única vía (junto con APPROVE) para escribir acceptanceStatus: ningún alta ni
          // PATCH del riesgo puede tocarlo, de modo que el formulario siempre pinta lo persistido.
          await tx.risk.update({ where: { id: approval.riskId }, data: { acceptanceStatus: 'REJECTED' } })
        }
        // Decisión y ticket quedan en el historial dentro de la MISMA transacción que los cambió:
        // si la transacción revierte, tampoco se registran (nunca hay evento sin operación ni
        // operación sin evento). El actor es la sesión que decidió; el comentario, en metadata.
        await riskAuditWrite(tx, {
          riskId: approval.riskId,
          eventType: 'APPROVAL_DECIDED',
          summary: approving ? 'Riesgo aprobado' : 'Riesgo rechazado',
          actor: request.user!,
          metadata: {
            approvalId: approval.id,
            decision: approving ? 'APPROVED' : 'REJECTED',
            ...(parsed.data.comment ? { comment: parsed.data.comment } : {}),
          },
        })
        if (createdTicketId) {
          await riskAuditWrite(tx, {
            riskId: approval.riskId,
            eventType: 'TICKET_CREATED',
            summary: 'Ticket de seguimiento creado',
            actor: request.user!,
            metadata: { ticketId: createdTicketId, approvalId: approval.id },
          })
        }
        const level = riskLevelFor(approval.risk.inherentImpact, approval.risk.inherentProbability)
        await tx.notification.create({
          data: {
            userId: approval.requestedById,
            title: `${approval.risk.code ? `Riesgo ${approval.risk.code}` : 'Riesgo'} ${approving ? 'aprobado' : 'rechazado'}`,
            body: approving
              ? `«${approval.risk.name}» fue aprobado y aceptado; se generó un ticket de seguimiento.`
              : `«${approval.risk.name}» fue rechazado por ${request.user!.name} (nivel inherente ${riskLevelNames[level]}).${parsed.data.comment ? ` Motivo: ${parsed.data.comment}` : ''}`,
            link: approvalNotificationLink(approval.id),
          },
        })
        return true
      })
      if (!settled) {
        response.status(409).json({ error: 'This approval was already decided' })
        return
      }
    } catch (decisionError) {
      // Si la creación del ticket u otra escritura falla, la transacción revierte TODO: el ciclo
      // sigue PENDING con su openKey y el dueño puede reintentar la decisión sin perder datos ni
      // duplicar tickets (el índice único de ticketId corta cualquier duplicado residual).
      console.error('[risk-approvals] decision could not be persisted', decisionError)
      response.status(500).json({ error: 'The approval decision could not be saved; it can be retried' })
      return
    }
    const updated = await db.riskApproval.findUnique({ where: { id: approval.id }, include: riskApprovalInclude })
    // El ticket enlazado se relee con su include para devolver la referencia al riesgo de origen
    // ya resuelta (riskApprovals), que se calcula después de unirlo al ciclo.
    const finalTicket = updated?.ticketId
      ? (await db.ticket.findUnique({ where: { id: updated.ticketId }, include: ticketInclude })) ?? null
      : null
    response.json({ approval: updated ? riskApprovalView(updated) : null, ticket: finalTicket ? ticketView(finalTicket) : null })
  }))

  app.post('/api/processes/:processId/risks/:riskId/approvals', authMiddleware, asyncHandler(async (request, response) => {
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const risk = await db.risk.findUnique({ where: { id: String(request.params.riskId) }, include: riskInclude })
    if (!risk || risk.processId !== process.id) {
      response.status(404).json({ error: 'Risk not found' })
      return
    }
    const user = request.user!
    // Reenviar puede el dueño del riesgo o un autorizado de escritura de su empresa; crear el
    // riesgo no da derecho a aprobarlo por sí solo (solo a pedir la revisión del dueño).
    const isOwner = risk.riskOwner?.id === user.id
    const isCompanyWriter = user.role === Role.SUPERUSER || (user.role === Role.COMPANY_ADMIN && process.companyId === user.companyId)
    if (!isOwner && !isCompanyWriter) {
      response.status(403).json({ error: 'Only the risk owner or a company admin can request approval' })
      return
    }
    const approvalOwnerId = risk.riskOwner?.id
    if (!approvalOwnerId) {
      response.status(400).json({ error: 'Assign a risk owner before requesting approval' })
      return
    }
    const openCycle = await db.riskApproval.findFirst({ where: { riskId: risk.id, status: 'PENDING' }, select: { id: true } })
    if (openCycle) {
      response.status(409).json({ error: 'This risk already has a pending approval' })
      return
    }
    try {
      // Ciclo + notificación + evento APPROVAL_REQUESTED comparten transacción: el índice único
      // de openKey sigue coordinando los reenvíos simultáneos (uno gana, el otro recibe 409).
      const approval = await db.$transaction((tx) => createRiskApprovalCycle(tx, { riskId: risk.id, requestedById: user.id, riskOwnerId: approvalOwnerId, actor: user, risk }))
      const created = await db.riskApproval.findUnique({ where: { id: approval.id }, include: riskApprovalInclude })
      response.status(201).json({ approval: created ? riskApprovalView(created) : null })
    } catch (cycleError) {
      // Dos reenvíos simultáneos chocan en el índice único de openKey: solo uno gana.
      if (isUniqueConstraintError(cycleError)) {
        response.status(409).json({ error: 'This risk already has a pending approval' })
        return
      }
      throw cycleError
    }
  }))

  // ---- Notificaciones in-app ----

  app.get('/api/notifications', authMiddleware, asyncHandler(async (request, response) => {
    const userId = request.user!.id
    const [notifications, unread] = await Promise.all([
      db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      db.notification.count({ where: { userId, readAt: null } }),
    ])
    response.json({ notifications, unread })
  }))

  app.patch('/api/notifications/:id', authMiddleware, asyncHandler(async (request, response) => {
    const existing = await db.notification.findUnique({ where: { id: String(request.params.id) } })
    if (!existing || existing.userId !== request.user!.id) {
      response.status(404).json({ error: 'Notification not found' })
      return
    }
    const notification = existing.readAt ? existing : await db.notification.update({ where: { id: existing.id }, data: { readAt: new Date() } })
    response.json({ notification })
  }))

  app.post('/api/notifications/read-all', authMiddleware, asyncHandler(async (request, response) => {
    await db.notification.updateMany({ where: { userId: request.user!.id, readAt: null }, data: { readAt: new Date() } })
    response.status(204).send()
  }))

  app.post('/api/processes/:processId/risks/:riskId/controls', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = riskControlCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid control data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const risk = await db.risk.findUnique({ where: { id: String(request.params.riskId) }, include: riskInclude })
    if (!risk || risk.processId !== process.id) {
      response.status(404).json({ error: 'Risk not found' })
      return
    }
    // Orden de gestión: el paso 3 solo se habilita con evaluación inherente completa, tratamiento
    // y riesgo aceptado por el ciclo autorizado.
    const stageLock = riskStageLockError(risk)
    if (stageLock) {
      response.status(409).json({ error: stageLock })
      return
    }
    const control = await db.$transaction(async (tx) => {
      const created = await tx.riskControl.create({ data: { riskId: risk.id, ...parsed.data } })
      await riskAuditWrite(tx, {
        riskId: risk.id,
        eventType: 'CONTROL_CREATED',
        summary: 'Control agregado',
        actor: request.user!,
        changes: controlAuditChanges(null, created),
        metadata: { controlId: created.id },
      })
      return created
    })
    response.status(201).json({ control })
  }))

  app.patch('/api/processes/:processId/risks/:riskId/controls/:controlId', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = riskControlUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid control data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const risk = await db.risk.findUnique({ where: { id: String(request.params.riskId) }, include: riskInclude })
    if (!risk || risk.processId !== process.id) {
      response.status(404).json({ error: 'Risk not found' })
      return
    }
    // La edición comparte el gate del alta: el orden evaluación → tratamiento → aceptación →
    // controles rige también para modificar un control ya existente. La baja (DELETE) no pasa por
    // este filtro, de modo que un control heredado siempre se puede retirar.
    const stageLock = riskStageLockError(risk)
    if (stageLock) {
      response.status(409).json({ error: stageLock })
      return
    }
    const existing = await db.riskControl.findUnique({ where: { id: String(request.params.controlId) } })
    if (!existing || existing.riskId !== risk.id) {
      response.status(404).json({ error: 'Control not found' })
      return
    }
    const control = await db.$transaction(async (tx) => {
      const updated = await tx.riskControl.update({ where: { id: existing.id }, data: parsed.data })
      const changes = controlAuditChanges(existing, updated)
      // Una edición que no varía nada (eco del valor guardado) no genera evento.
      if (changes.length > 0) {
        await riskAuditWrite(tx, {
          riskId: risk.id,
          eventType: 'CONTROL_UPDATED',
          summary: 'Control modificado',
          actor: request.user!,
          changes,
          metadata: { controlId: updated.id },
        })
      }
      return updated
    })
    response.json({ control })
  }))

  app.delete('/api/processes/:processId/risks/:riskId/controls/:controlId', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const risk = await db.risk.findUnique({ where: { id: String(request.params.riskId) }, include: riskInclude })
    if (!risk || risk.processId !== process.id) {
      response.status(404).json({ error: 'Risk not found' })
      return
    }
    const existing = await db.riskControl.findUnique({ where: { id: String(request.params.controlId) } })
    if (!existing || existing.riskId !== risk.id) {
      response.status(404).json({ error: 'Control not found' })
      return
    }
    await db.$transaction(async (tx) => {
      await tx.riskControl.delete({ where: { id: existing.id } })
      await riskAuditWrite(tx, {
        riskId: risk.id,
        eventType: 'CONTROL_DELETED',
        summary: 'Control eliminado',
        actor: request.user!,
        changes: controlAuditChanges(existing, null),
        metadata: { controlId: existing.id },
      })
    })
    response.status(204).send()
  }))

  app.post('/api/processes/:processId/risks/:riskId/evidences', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = riskEvidenceCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid evidence data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const risk = await db.risk.findUnique({ where: { id: String(request.params.riskId) }, include: riskInclude })
    if (!risk || risk.processId !== process.id) {
      response.status(404).json({ error: 'Risk not found' })
      return
    }
    const evidence = await db.$transaction(async (tx) => {
      const created = await tx.riskEvidence.create({ data: { riskId: risk.id, ...parsed.data } })
      await riskAuditWrite(tx, {
        riskId: risk.id,
        eventType: 'EVIDENCE_CREATED',
        summary: 'Evidencia agregada',
        actor: request.user!,
        changes: evidenceAuditChanges(null, created),
        metadata: { evidenceId: created.id },
      })
      return created
    })
    response.status(201).json({ evidence })
  }))

  app.patch('/api/processes/:processId/risks/:riskId/evidences/:evidenceId', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = riskEvidenceUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid evidence data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const risk = await db.risk.findUnique({ where: { id: String(request.params.riskId) }, include: riskInclude })
    if (!risk || risk.processId !== process.id) {
      response.status(404).json({ error: 'Risk not found' })
      return
    }
    const existing = await db.riskEvidence.findUnique({ where: { id: String(request.params.evidenceId) } })
    if (!existing || existing.riskId !== risk.id) {
      response.status(404).json({ error: 'Evidence not found' })
      return
    }
    const evidence = await db.$transaction(async (tx) => {
      const updated = await tx.riskEvidence.update({ where: { id: existing.id }, data: parsed.data })
      const changes = evidenceAuditChanges(existing, updated)
      if (changes.length > 0) {
        await riskAuditWrite(tx, {
          riskId: risk.id,
          eventType: 'EVIDENCE_UPDATED',
          summary: 'Evidencia actualizada',
          actor: request.user!,
          changes,
          metadata: { evidenceId: updated.id },
        })
      }
      return updated
    })
    response.json({ evidence })
  }))

  app.delete('/api/processes/:processId/risks/:riskId/evidences/:evidenceId', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const risk = await db.risk.findUnique({ where: { id: String(request.params.riskId) }, include: riskInclude })
    if (!risk || risk.processId !== process.id) {
      response.status(404).json({ error: 'Risk not found' })
      return
    }
    const existing = await db.riskEvidence.findUnique({ where: { id: String(request.params.evidenceId) } })
    if (!existing || existing.riskId !== risk.id) {
      response.status(404).json({ error: 'Evidence not found' })
      return
    }
    await db.$transaction(async (tx) => {
      await tx.riskEvidence.delete({ where: { id: existing.id } })
      await riskAuditWrite(tx, {
        riskId: risk.id,
        eventType: 'EVIDENCE_DELETED',
        summary: 'Evidencia eliminada',
        actor: request.user!,
        changes: evidenceAuditChanges(existing, null),
        metadata: { evidenceId: existing.id },
      })
    })
    response.status(204).send()
  }))

  /**
   * Evidencia PDF del plan de mitigación de un riesgo: los PDF de TODOS los tickets de las
   * actividades de sus planes (los tickets de un plan existen mientras exista la actividad; el
   * enlace es ticket.actionItemId -> actionItem.actionPlan.riskId). Alimenta la sección de
   * evidencias del panel de riesgo, donde antes se listaba RiskEvidence: esos registros manuales
   * se conservan en base de datos y su API de más arriba no cambia.
   *
   * Visibilidad: primero el proceso (empresa) y después la de cada ticket (scopeForUser), igual
   * que el resto de rutas de tickets: cada fila que aparece aquí es una fila cuyo ticket el
   * usuario puede abrir y descargar, de modo que nunca se cuelan archivos de tickets ajenos.
   */
  app.get('/api/processes/:processId/risks/:riskId/plan-evidence', authMiddleware, asyncHandler(async (request, response) => {
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const risk = await db.risk.findUnique({ where: { id: String(request.params.riskId) }, select: { id: true, processId: true } })
    if (!risk || risk.processId !== process.id) {
      response.status(404).json({ error: 'Risk not found' })
      return
    }
    const evidence = await db.ticketEvidenceFile.findMany({
      where: { ticket: { AND: [scopeForUser(request), { actionItem: { actionPlan: { riskId: risk.id } } }] } },
      include: evidenceInclude,
      orderBy: { createdAt: 'desc' },
    })
    response.json({ evidence: evidence.map(evidenceView) })
  }))

  /**
   * Actividades del plan de mitigación de un riesgo, para el paso 3 del panel de riesgos. Una
   * actividad es un ActionItem de un plan de acción vinculado al riesgo (ActionPlan.riskId); el
   * modelo permite varios planes por riesgo, así que la lista concatena los ítems de todos ellos
   * en orden de creación. El acceso es el mismo que plan-evidence: proceso visible para la sesión
   * y riesgo que pertenezca exactamente a ese proceso.
   */
  const mitigationActivityInclude = {
    responsible: { select: { id: true, name: true } },
    ticket: { select: { id: true, status: true } },
  } as const

  const mitigationActivityView = (item: Prisma.ActionItemGetPayload<{ include: typeof mitigationActivityInclude }>) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    status: item.status,
    dueDate: item.dueDate,
    responsible: item.responsible,
    ticket: item.ticket,
    createdAt: item.createdAt,
  })

  app.get('/api/processes/:processId/risks/:riskId/plan-activities', authMiddleware, asyncHandler(async (request, response) => {
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const risk = await db.risk.findUnique({ where: { id: String(request.params.riskId) }, select: { id: true, processId: true } })
    if (!risk || risk.processId !== process.id) {
      response.status(404).json({ error: 'Risk not found' })
      return
    }
    const plans = await db.actionPlan.findMany({
      where: { riskId: risk.id },
      select: { id: true, items: { include: mitigationActivityInclude, orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    })
    response.json({ activities: plans.flatMap((plan) => plan.items).map(mitigationActivityView) })
  }))

  /**
   * Agrega una actividad al plan de mitigación del riesgo desde el paso 3 del panel, sin pasar
   * por la vinculación manual de planes. El plan "primario" del riesgo es el más antiguo con
   * riskId = riesgo (el modelo permite varios; la lista de actividades los concatena igual). Si
   * el riesgo todavía no tiene plan, se crea uno nuevo ligado al riesgo (ActionPlan.diagnosticId
   * es NOT NULL en el modelo, así que el plan nace bajo el diagnóstico más reciente de la
   * empresa; sin diagnóstico no hay dónde anclarlo y la petición se rechaza con 400). Los planes
   * existentes nunca se renombran ni se duplican.
   *
   * La actividad nace PENDING con prioridad MEDIUM y su ticket en la MISMA transacción, más el
   * aviso de asignación al responsable (link idempotente tickets/<id>): si el aviso falla, no
   * queda actividad sin ticket ni ticket sin actividad. Como empieza PENDING, no puede cerrar la
   * mitigación, así que aquí no corre notifyMitigationPlanCompleted.
   */
  app.post('/api/processes/:processId/risks/:riskId/plan-activities', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = mitigationActivityCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid mitigation activity data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const risk = await db.risk.findUnique({ where: { id: String(request.params.riskId) }, select: { id: true, processId: true, code: true, name: true, ...riskStageSelect } })
    if (!risk || risk.processId !== process.id) {
      response.status(404).json({ error: 'Risk not found' })
      return
    }
    // Gate de etapas: mientras el riesgo no esté aceptado no se agregan actividades de su plan
    // (alta que además crea un ActionPlan cuando todavía no existe ninguno).
    const stageLock = riskStageLockError(risk)
    if (stageLock) {
      response.status(409).json({ error: stageLock })
      return
    }
    const responsible = await resolveUserInCompany(parsed.data.responsibleId, process.companyId, 'responsible')
    if (!responsible.ok) {
      response.status(responsible.status).json({ error: responsible.error })
      return
    }
    const existingPlan = await db.actionPlan.findFirst({ where: { riskId: risk.id }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    let actionPlanId: string
    if (existingPlan) {
      actionPlanId = existingPlan.id
    } else {
      const diagnostic = await db.qualityDiagnostic.findFirst({
        where: { companyId: process.companyId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      if (!diagnostic) {
        response.status(400).json({ error: 'No diagnostic available for this company' })
        return
      }
      const reference = risk.code ?? risk.name
      const plan = await db.actionPlan.create({
        data: {
          diagnosticId: diagnostic.id,
          riskId: risk.id,
          title: `Plan de mitigación ${reference}`,
          description: `Actividades de mitigación del riesgo ${reference}.`,
          status: 'ACTIVE',
          createdById: request.user!.id,
        },
        select: { id: true },
      })
      actionPlanId = plan.id
    }
    const { item } = await db.$transaction(async (tx) => {
      const created = await tx.actionItem.create({
        data: {
          actionPlanId,
          title: parsed.data.title,
          description: parsed.data.description ?? parsed.data.title,
          priority: Priority.MEDIUM,
          status: ActionItemStatus.PENDING,
          responsibleId: responsible.userId,
          dueDate: parsed.data.dueDate,
        },
        include: mitigationActivityInclude,
      })
      const ticket = await tx.ticket.create({
        data: ticketDataFromActionItem({
          title: created.title,
          description: created.description,
          status: created.status,
          priority: created.priority,
          responsibleId: created.responsibleId,
          dueDate: created.dueDate,
          actionItemId: created.id,
          createdById: request.user!.id,
        }),
        include: ticketInclude,
      })
      // Aviso de asignación: la actividad nace con responsable, así que ese responsable se entera
      // aquí mismo (mismo link idempotente tickets/<id> que el resto del sistema).
      await notifyTicketAssigned(tx, ticket, ticket.assignedToId, request.user!.id)
      // Relectura tras crear el ticket: la actividad recién escrita se leyó antes de que el
      // ticket existiera, y la respuesta debe mostrarlo ya asociado.
      const refreshed = await tx.actionItem.findUnique({ where: { id: created.id }, include: mitigationActivityInclude })
      return { item: refreshed ?? created }
    })
    response.status(201).json({ activity: mitigationActivityView(item) })
  }))

  app.get('/api/processes/:processId/kpis', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = kpiQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid KPI filters', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const where: Prisma.KpiWhereInput = {
      processId: process.id,
      ...(parsed.data.search ? {
        OR: [
          { name: { contains: parsed.data.search, mode: 'insensitive' } },
          { description: { contains: parsed.data.search, mode: 'insensitive' } },
        ],
      } : {}),
    }
    const kpis = await db.kpi.findMany({ where, include: kpiInclude, orderBy: { name: 'asc' } })
    response.json({ kpis: kpis.map(kpiView) })
  }))

  app.post('/api/processes/:processId/kpis', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = kpiCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid KPI data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const reportResponsible = await resolveResponsible(parsed.data.reportResponsibleId, process.companyId)
    if (!reportResponsible.ok) {
      response.status(reportResponsible.status).json({ error: reportResponsible.error })
      return
    }
    const monitorResponsible = await resolveResponsible(parsed.data.monitorResponsibleId, process.companyId)
    if (!monitorResponsible.ok) {
      response.status(monitorResponsible.status).json({ error: monitorResponsible.error })
      return
    }
    const kpi = await db.kpi.create({
      data: {
        processId: process.id,
        name: parsed.data.name,
        description: parsed.data.description,
        frequency: parsed.data.frequency,
        target: parsed.data.target,
        formula: parsed.data.formula,
        dataSource: parsed.data.dataSource,
        unit: parsed.data.unit,
        reportResponsibleId: reportResponsible.responsibleId,
        monitorResponsibleId: monitorResponsible.responsibleId,
        greenThreshold: parsed.data.greenThreshold ?? null,
        yellowThreshold: parsed.data.yellowThreshold ?? null,
        redThreshold: parsed.data.redThreshold ?? null,
      },
      include: kpiInclude,
    })
    response.status(201).json({ kpi: kpiView(kpi) })
  }))

  app.patch('/api/processes/:processId/kpis/:kpiId', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = kpiUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid KPI data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const existing = await db.kpi.findUnique({ where: { id: String(request.params.kpiId) }, include: kpiInclude })
    if (!existing || existing.processId !== process.id) {
      response.status(404).json({ error: 'KPI not found' })
      return
    }
    if (parsed.data.reportResponsibleId !== undefined) {
      const responsible = await resolveResponsible(parsed.data.reportResponsibleId, process.companyId)
      if (!responsible.ok) {
        response.status(responsible.status).json({ error: responsible.error })
        return
      }
    }
    if (parsed.data.monitorResponsibleId !== undefined) {
      const responsible = await resolveResponsible(parsed.data.monitorResponsibleId, process.companyId)
      if (!responsible.ok) {
        response.status(responsible.status).json({ error: responsible.error })
        return
      }
    }
    const data: Prisma.KpiUncheckedUpdateInput = {}
    if (parsed.data.name !== undefined) data.name = parsed.data.name
    if (parsed.data.description !== undefined) data.description = parsed.data.description
    if (parsed.data.frequency !== undefined) data.frequency = parsed.data.frequency
    if (parsed.data.target !== undefined) data.target = parsed.data.target
    if (parsed.data.formula !== undefined) data.formula = parsed.data.formula
    if (parsed.data.dataSource !== undefined) data.dataSource = parsed.data.dataSource
    if (parsed.data.unit !== undefined) data.unit = parsed.data.unit
    if (parsed.data.reportResponsibleId !== undefined) data.reportResponsibleId = parsed.data.reportResponsibleId
    if (parsed.data.monitorResponsibleId !== undefined) data.monitorResponsibleId = parsed.data.monitorResponsibleId
    if (parsed.data.greenThreshold !== undefined) data.greenThreshold = parsed.data.greenThreshold
    if (parsed.data.yellowThreshold !== undefined) data.yellowThreshold = parsed.data.yellowThreshold
    if (parsed.data.redThreshold !== undefined) data.redThreshold = parsed.data.redThreshold
    const kpi = await db.kpi.update({ where: { id: existing.id }, data, include: kpiInclude })
    response.json({ kpi: kpiView(kpi) })
  }))

  app.delete('/api/processes/:processId/kpis/:kpiId', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const existing = await db.kpi.findUnique({ where: { id: String(request.params.kpiId) }, include: kpiInclude })
    if (!existing || existing.processId !== process.id) {
      response.status(404).json({ error: 'KPI not found' })
      return
    }
    await db.kpi.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  app.get('/api/processes/:processId/procedures', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = procedureQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid procedure filters', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const where: Prisma.ProcedureWhereInput = {
      processId: process.id,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.search ? {
        OR: [
          { code: { contains: parsed.data.search, mode: 'insensitive' } },
          { name: { contains: parsed.data.search, mode: 'insensitive' } },
        ],
      } : {}),
    }
    const procedures = await db.procedure.findMany({ where, include: procedureInclude, orderBy: [{ code: 'asc' }, { name: 'asc' }] })
    response.json({ procedures: procedures.map(procedureView) })
  }))

  app.post('/api/processes/:processId/procedures', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = procedureCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid procedure data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const responsible = await resolveResponsible(parsed.data.responsibleId, process.companyId)
    if (!responsible.ok) {
      response.status(responsible.status).json({ error: responsible.error })
      return
    }
    // El código identifica el documento dentro de la empresa, y solo dentro de ella; el índice
    // único por proceso queda como red de seguridad interna.
    const duplicateCode = await db.procedure.findFirst({
      where: { code: parsed.data.code, process: { companyId: process.companyId } },
      select: { id: true },
    })
    if (duplicateCode) {
      response.status(409).json({ error: 'A procedure with this code already exists in your company' })
      return
    }
    const actor = request.user ? { id: request.user.id, name: request.user.name, email: request.user.email } : null
    const procedure = await db.$transaction(async (tx) => {
      const created = await tx.procedure.create({
        data: {
          processId: process.id,
          code: parsed.data.code,
          name: parsed.data.name,
          objective: parsed.data.objective,
          scope: parsed.data.scope,
          description: parsed.data.description ?? null,
          responsibleId: responsible.responsibleId,
        },
        include: procedureInclude,
      })
      await procedureHistoryWrite(tx, { procedure: created, action: 'CREATED', actor, snapshot: procedureSnapshot(created) })
      return created
    })
    response.status(201).json({ procedure: procedureView(procedure) })
  }))

  app.patch('/api/processes/:processId/procedures/:procedureId', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = procedureUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid procedure data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const existing = await db.procedure.findUnique({ where: { id: String(request.params.procedureId) }, include: procedureInclude })
    if (!existing || existing.processId !== process.id) {
      response.status(404).json({ error: 'Procedure not found' })
      return
    }
    // Solo el borrador es editable: en revisión el contenido está congelado y lo aprobado jamás se
    // sobrescribe (para cambiarlo hay que abrir una nueva revisión desde el endpoint de estado).
    if (existing.status !== ProcedureStatus.DRAFT) {
      response.status(409).json({ error: 'Only a draft procedure can be edited' })
      return
    }
    if (parsed.data.code !== undefined && parsed.data.code !== existing.code) {
      const duplicateCode = await db.procedure.findFirst({
        where: { code: parsed.data.code, process: { companyId: process.companyId }, NOT: { id: existing.id } },
        select: { id: true },
      })
      if (duplicateCode) {
        response.status(409).json({ error: 'A procedure with this code already exists in your company' })
        return
      }
    }
    const data: Prisma.ProcedureUncheckedUpdateInput = {}
    if (parsed.data.code !== undefined) data.code = parsed.data.code
    if (parsed.data.name !== undefined) data.name = parsed.data.name
    if (parsed.data.objective !== undefined) data.objective = parsed.data.objective
    if (parsed.data.scope !== undefined) data.scope = parsed.data.scope
    if (parsed.data.description !== undefined) data.description = parsed.data.description
    if (parsed.data.responsibleId !== undefined) {
      const resolved = await resolveResponsible(parsed.data.responsibleId, process.companyId)
      if (!resolved.ok) {
        response.status(resolved.status).json({ error: resolved.error })
        return
      }
      data.responsibleId = resolved.responsibleId
    }
    const changes = updatedProcedureChanges(existing, data)
    // Sin cambios reales no se escribe historial (mismo criterio que updateProcessWithVersion).
    if (changes.length === 0) {
      response.json({ procedure: procedureView(existing) })
      return
    }
    const actor = request.user ? { id: request.user.id, name: request.user.name, email: request.user.email } : null
    const procedure = await db.$transaction(async (tx) => {
      const updated = await tx.procedure.update({ where: { id: existing.id }, data, include: procedureInclude })
      await procedureHistoryWrite(tx, { procedure: updated, action: 'UPDATED', actor, changes, snapshot: procedureSnapshot(updated) })
      return updated
    })
    response.json({ procedure: procedureView(procedure) })
  }))

  app.post('/api/processes/:processId/procedures/:procedureId/status', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = procedureStatusChangeSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid status change', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const existing = await db.procedure.findUnique({ where: { id: String(request.params.procedureId) }, include: procedureInclude })
    if (!existing || existing.processId !== process.id) {
      response.status(404).json({ error: 'Procedure not found' })
      return
    }
    if (!canTransitionProcedure(existing.status, parsed.data.status)) {
      response.status(409).json({ error: 'Invalid procedure status transition' })
      return
    }
    // La versión del documento avanza solo al aprobar: cada aprobación es una revisión nueva
    // (1.0 -> 2.0 con el mismo helper de versionado de los procesos).
    const version = parsed.data.status === ProcedureStatus.APPROVED ? nextProcessVersion(existing.version) : existing.version
    const changes: ProcessChangeItem[] = [
      { field: 'status', label: 'Estado', previousValue: existing.status, newValue: parsed.data.status },
      ...(parsed.data.comment ? [{ field: 'comment', label: 'Comentario', previousValue: null, newValue: parsed.data.comment }] : []),
    ]
    const actor = request.user ? { id: request.user.id, name: request.user.name, email: request.user.email } : null
    const procedure = await db.$transaction(async (tx) => {
      const updated = await tx.procedure.update({
        where: { id: existing.id },
        data: { status: parsed.data.status, version },
        include: procedureInclude,
      })
      await procedureHistoryWrite(tx, { procedure: updated, action: 'STATUS_CHANGED', actor, changes, snapshot: procedureSnapshot(updated) })
      return updated
    })
    response.json({ procedure: procedureView(procedure) })
  }))

  app.get('/api/processes/:processId/procedures/:procedureId/history', authMiddleware, asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, procedureId: idReference }).safeParse({
      processId: String(request.params.processId),
      procedureId: String(request.params.procedureId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid procedure id' })
      return
    }
    const parsedQuery = procedureHistoryQuerySchema.safeParse(request.query)
    if (!parsedQuery.success) {
      response.status(400).json({ error: 'Invalid history query' })
      return
    }
    const process = await findAccessibleProcess(request, parsedIds.data.processId)
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const procedure = await db.procedure.findUnique({ where: { id: parsedIds.data.procedureId }, select: { id: true, processId: true } })
    if (!procedure || procedure.processId !== process.id) {
      response.status(404).json({ error: 'Procedure not found' })
      return
    }
    const { page, pageSize, action } = parsedQuery.data
    const where = { procedureId: procedure.id, ...(action ? { action } : {}) }
    const [total, versions] = await Promise.all([
      db.procedureVersion.count({ where }),
      db.procedureVersion.findMany({
        where,
        include: procedureVersionInclude,
        orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    response.json({ versions: versions.map(procedureVersionView), total, page, pageSize })
  }))

  app.delete('/api/processes/:processId/procedures/:procedureId', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const existing = await db.procedure.findUnique({ where: { id: String(request.params.procedureId) }, include: procedureInclude })
    if (!existing || existing.processId !== process.id) {
      response.status(404).json({ error: 'Procedure not found' })
      return
    }
    // Lo aprobado no se borra jamás: si el procedimiento llegó a aprobarse, su baja es el estado
    // OBSOLETE; el borrado queda para documentos que nunca se aprobaron.
    const approvedVersion = await db.procedureVersion.findFirst({
      where: { procedureId: existing.id, status: ProcedureStatus.APPROVED },
      select: { id: true },
    })
    if (approvedVersion) {
      response.status(409).json({ error: 'The procedure has approved versions; mark it obsolete instead' })
      return
    }
    // Sin versiones aprobadas se retira el borrador completo: sus filas de historial acompañan en la
    // misma transacción porque la clave foránea es Restrict.
    await db.$transaction(async (tx) => {
      await tx.procedureVersion.deleteMany({ where: { procedureId: existing.id } })
      await tx.procedure.delete({ where: { id: existing.id } })
    })
    response.status(204).send()
  }))

  // ---- Rutas del módulo Auditorías de calidad ----
  // Contrato de acceso idéntico al de procedimientos: el proceso debe ser visible para la sesión
  // (404 si no lo es, sin filtrar existencia de recursos ajenos) y toda escritura exige
  // userWriteGuard (SUPERUSER o COMPANY_ADMIN). CLOSED y CANCELLED son terminales y bloquean
  // todas las escrituras sobre la auditoría, sus hallazgos y sus evidencias. El bloqueo se
  // re-valida dentro de la transacción con SELECT ... FOR UPDATE para cerrar la ventana de
  // concurrentes entre el cierre y una escritura en vuelo.

  const findAccessibleAudit = async (request: Request, processId: string, auditId: string) => {
    const process = await findAccessibleProcess(request, processId)
    if (!process) return null
    const audit = await db.audit.findUnique({ where: { id: auditId }, include: auditInclude })
    return audit && audit.processId === process.id ? audit : null
  }

  const auditActorOf = (request: Request): RiskAuditActor | null =>
    request.user ? { id: request.user.id, name: request.user.name, email: request.user.email } : null

  /**
   * Bloquea la fila de la auditoría y relee su estado dentro de la transacción. Devuelve null si
   * la auditoría ya no existe o está en estado terminal (cerrada o cancelada), de modo que una
   * escritura concurrente que arrive después del cierre recibe 409 en lugar de colar cambios.
   */
  const lockAuditForWrite = async (tx: Prisma.TransactionClient, auditId: string): Promise<AuditWithInclude | null> => {
    if (typeof tx.$queryRaw === 'function') {
      await tx.$queryRaw`SELECT "id" FROM "Audit" WHERE "id" = ${auditId} FOR UPDATE`
    }
    const audit = await tx.audit.findUnique({ where: { id: auditId }, include: auditInclude })
    if (!audit || isTerminalAuditStatus(audit.status)) return null
    return audit
  }

  /**
   * Resuelve una auditoría por su id comprobando que su proceso sea visible para la sesión. Es la
   * puerta de entrada de las rutas top-level (/api/audits/...): el proceso se deriva de la propia
   * auditoría, de modo que el cliente no necesita conocerlo para leer ni para escribir.
   */
  const findCompanyAudit = async (request: Request, auditId: string) => {
    const parsed = idReference.safeParse(auditId)
    if (!parsed.success) return null
    const audit = await db.audit.findUnique({ where: { id: parsed.data }, include: auditInclude })
    if (!audit) return null
    const process = await findAccessibleProcess(request, audit.processId)
    return process && audit.processId === process.id ? audit : null
  }

  /**
   * Delega una ruta anidada (/api/processes/:processId/audits/...) desde su variante top-level
   * (/api/audits/...): resuelve la auditoría, comprueba el acceso y rellena req.params.processId
   * para que el handler existente ejecute exactamente la misma lógica y validaciones.
   */
  const withAuditProcessParam = (handler: RequestHandler): RequestHandler => async (request, response, next) => {
    const audit = await findCompanyAudit(request, String(request.params.auditId))
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    request.params.processId = audit.processId
    return handler(request, response, next)
  }

  /** Ítems obligatorios que siguen sin evaluación: bloquean el cierre de la auditoría. */
  const pendingRequiredItems = (client: Prisma.TransactionClient | PrismaClient, auditId: string) =>
    client.auditChecklistItem.count({
      where: { required: true, result: 'PENDING', checklist: { auditId } },
    })

  /**
   * Acciones correctivas obligatorias sin estado final. Mientras existan, el hallazgo no puede
   * resolverse: la verificación siempre se apoya en acciones terminadas (COMPLETED o CANCELLED),
   * nunca en un cierre automático.
   */
  const pendingRequiredActions = (client: Prisma.TransactionClient | PrismaClient, findingId: string) =>
    client.auditCorrectiveAction.count({
      where: { findingId, required: true, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    })

  /**
   * Valida los procesos y procedimientos que se quieren vincular a una auditoría: todos deben
   * pertenecer a la empresa del proceso principal (sin referencias cruzadas entre empresas). El
   * proceso principal se deduplica y no se guarda como vínculo (siempre aparece en la vista).
   */
  const validateAuditRelations = async (companyId: string, processId: string, data: { processIds?: string[]; procedureIds?: string[] }) => {
    const processIds = [...new Set(data.processIds ?? [])].filter((id) => id !== processId)
    const procedureIds = [...new Set(data.procedureIds ?? [])]
    if (processIds.length > 0) {
      const count = await db.process.count({ where: { id: { in: processIds }, companyId } })
      if (count !== processIds.length) return { ok: false as const, status: 404, error: 'One or more related processes were not found in this company' }
    }
    if (procedureIds.length > 0) {
      const procedures = await db.procedure.findMany({
        where: { id: { in: procedureIds } },
        select: { id: true, process: { select: { companyId: true } } },
      })
      if (procedures.length !== procedureIds.length || procedures.some((procedure) => procedure.process.companyId !== companyId)) {
        return { ok: false as const, status: 404, error: 'One or more related procedures were not found in this company' }
      }
    }
    return { ok: true as const, processIds, procedureIds }
  }

  /** Sustituye el conjunto de vínculos sin duplicados y sin reescribir los que ya están iguales. */
  const syncAuditRelations = async (tx: Prisma.TransactionClient, auditId: string, processIds: string[], procedureIds: string[]) => {
    const [existingProcesses, existingProcedures] = await Promise.all([
      tx.auditProcess.findMany({ where: { auditId }, select: { processId: true } }),
      tx.auditProcedure.findMany({ where: { auditId }, select: { procedureId: true } }),
    ])
    const currentProcessIds = existingProcesses.map((row) => row.processId)
    const currentProcedureIds = existingProcedures.map((row) => row.procedureId)
    const removeProcessIds = currentProcessIds.filter((id) => !processIds.includes(id))
    const addProcessIds = processIds.filter((id) => !currentProcessIds.includes(id))
    const removeProcedureIds = currentProcedureIds.filter((id) => !procedureIds.includes(id))
    const addProcedureIds = procedureIds.filter((id) => !currentProcedureIds.includes(id))
    if (removeProcessIds.length > 0) await tx.auditProcess.deleteMany({ where: { auditId, processId: { in: removeProcessIds } } })
    if (removeProcedureIds.length > 0) await tx.auditProcedure.deleteMany({ where: { auditId, procedureId: { in: removeProcedureIds } } })
    if (addProcessIds.length > 0) {
      await tx.auditProcess.createMany({ data: addProcessIds.map((processId) => ({ auditId, processId })), skipDuplicates: true })
    }
    if (addProcedureIds.length > 0) {
      await tx.auditProcedure.createMany({ data: addProcedureIds.map((procedureId) => ({ auditId, procedureId })), skipDuplicates: true })
    }
    return { changed: addProcessIds.length + removeProcessIds.length + addProcedureIds.length + removeProcedureIds.length > 0, addedProcessIds: addProcessIds, removedProcessIds: removeProcessIds, addedProcedureIds: addProcedureIds, removedProcedureIds: removeProcedureIds } as const
  }

  /**
   * Resuelve los vínculos opcionales de un hallazgo (ítem de checklist, proceso y procedimiento)
   * contra la auditoría y su empresa. Un id que no pertenezca responde 404 sin filtrar existencia.
   */
  const resolveFindingLinks = async (audit: { id: string; processId: string; process: { companyId: string } }, data: { itemId?: string | null; processId?: string | null; procedureId?: string | null }) => {
    let itemId: string | null = null
    let itemDescription: string | null = null
    let processId: string | null = null
    let processName: string | null = null
    let procedureId: string | null = null
    let procedureName: string | null = null
    if (data.itemId !== undefined) {
      if (data.itemId) {
        const item = await db.auditChecklistItem.findFirst({
          where: { id: data.itemId, checklist: { auditId: audit.id } },
          select: { id: true, description: true },
        })
        if (!item) return { ok: false as const, status: 404 as const, error: 'Checklist item not found' }
        itemId = item.id
        itemDescription = item.description
      }
    }
    if (data.processId !== undefined) {
      if (data.processId) {
        // El proceso del hallazgo debe ser el principal o uno de los relacionados con la auditoría.
        const related = await db.auditProcess.findFirst({ where: { auditId: audit.id, processId: data.processId }, select: { processId: true } })
        if (data.processId !== audit.processId && !related) {
          return { ok: false as const, status: 404 as const, error: 'Process not found for this audit' }
        }
        const process = await db.process.findFirst({ where: { id: data.processId, companyId: audit.process.companyId }, select: { id: true, name: true } })
        if (!process) return { ok: false as const, status: 404 as const, error: 'Process not found for this audit' }
        processId = process.id
        processName = process.name
      }
    }
    if (data.procedureId !== undefined) {
      if (data.procedureId) {
        const procedure = await db.procedure.findFirst({
          where: { id: data.procedureId, process: { companyId: audit.process.companyId } },
          select: { id: true, name: true },
        })
        if (!procedure) return { ok: false as const, status: 404 as const, error: 'Procedure not found in this company' }
        procedureId = procedure.id
        procedureName = procedure.name
      }
    }
    return { ok: true as const, itemId, itemDescription, processId, processName, procedureId, procedureName }
  }

  app.get('/api/processes/:processId/audits', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = auditQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit filters', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const where: Prisma.AuditWhereInput = {
      processId: process.id,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.search ? {
        OR: [
          { code: { contains: parsed.data.search, mode: 'insensitive' } },
          { title: { contains: parsed.data.search, mode: 'insensitive' } },
        ],
      } : {}),
    }
    const audits = await db.audit.findMany({ where, include: auditInclude, orderBy: [{ code: 'asc' }, { createdAt: 'desc' }] })
    response.json({ audits: audits.map(auditView) })
  }))

  const createAuditHandler = asyncHandler(async (request, response) => {
    const parsed = auditCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, String(request.params.processId))
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const leadAuditor = await resolveUserInCompany(parsed.data.leadAuditorId, process.companyId, 'lead auditor')
    if (!leadAuditor.ok) {
      response.status(leadAuditor.status).json({ error: leadAuditor.error })
      return
    }
    const responsible = await resolveUserInCompany(parsed.data.responsibleId, process.companyId, 'audit responsible')
    if (!responsible.ok) {
      response.status(responsible.status).json({ error: responsible.error })
      return
    }
    const relations = await validateAuditRelations(process.companyId, process.id, parsed.data)
    if (!relations.ok) {
      response.status(relations.status).json({ error: relations.error })
      return
    }
    const actor = auditActorOf(request)
    const audit = await createAuditWithCode(db, actor!, process.id, process.companyId, {
      title: parsed.data.title,
      auditType: parsed.data.auditType,
      scope: parsed.data.scope,
      objectives: parsed.data.objectives || null,
      criteria: parsed.data.criteria,
      plannedDate: parsed.data.plannedDate || null,
      leadAuditorId: leadAuditor.userId,
      responsibleId: responsible.userId,
    }, { processIds: relations.processIds, procedureIds: relations.procedureIds })
    response.status(201).json({ audit: auditView(audit) })
  })
  app.post('/api/processes/:processId/audits', authMiddleware, userWriteGuard, createAuditHandler)

  // Variante top-level del alta: el proceso principal viaja en el cuerpo (processId) y se traduce
  // al parámetro de ruta para reutilizar el mismo handler y las mismas validaciones.
  app.post('/api/audits', authMiddleware, userWriteGuard, asyncHandler(async (request, response, next) => {
    const parsedProcess = idReference.safeParse((request.body as { processId?: unknown } | undefined)?.processId)
    if (!parsedProcess.success) {
      response.status(400).json({ error: 'A valid processId is required' })
      return
    }
    request.params.processId = parsedProcess.data
    return createAuditHandler(request, response, next)
  }))

  app.get('/api/processes/:processId/audits/:auditId', authMiddleware, asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid audit id' })
      return
    }
    const audit = await findAccessibleAudit(request, parsedIds.data.processId, parsedIds.data.auditId)
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    response.json({ audit: auditView(audit) })
  }))

  const updateAuditHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid audit id' })
      return
    }
    const parsed = auditUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, parsedIds.data.processId)
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const existing = await db.audit.findUnique({ where: { id: parsedIds.data.auditId }, include: auditInclude })
    if (!existing || existing.processId !== process.id) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    // Cerrada o cancelada, la auditoría queda congelada: para cambiar algo hay que trabajar sobre
    // una auditoría viva; el estado terminal no se reabre desde esta ruta.
    if (isTerminalAuditStatus(existing.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    const data: Prisma.AuditUncheckedUpdateInput = {}
    const people: { leadAuditor?: string | null; responsible?: string | null } = {}
    if (parsed.data.title !== undefined) data.title = parsed.data.title
    if (parsed.data.auditType !== undefined) data.auditType = parsed.data.auditType
    if (parsed.data.scope !== undefined) data.scope = parsed.data.scope
    if (parsed.data.objectives !== undefined) data.objectives = parsed.data.objectives || null
    if (parsed.data.criteria !== undefined) data.criteria = parsed.data.criteria
    if (parsed.data.plannedDate !== undefined) data.plannedDate = parsed.data.plannedDate || null
    if (parsed.data.leadAuditorId !== undefined) {
      const leadAuditor = await resolveUserInCompany(parsed.data.leadAuditorId, process.companyId, 'lead auditor')
      if (!leadAuditor.ok) {
        response.status(leadAuditor.status).json({ error: leadAuditor.error })
        return
      }
      data.leadAuditorId = leadAuditor.userId
      people.leadAuditor = leadAuditor.userId
        ? await db.user.findUnique({ where: { id: leadAuditor.userId }, select: { name: true } }).then((user) => user?.name ?? null)
        : null
    }
    if (parsed.data.responsibleId !== undefined) {
      const responsible = await resolveUserInCompany(parsed.data.responsibleId, process.companyId, 'audit responsible')
      if (!responsible.ok) {
        response.status(responsible.status).json({ error: responsible.error })
        return
      }
      data.responsibleId = responsible.userId
      people.responsible = responsible.userId
        ? await db.user.findUnique({ where: { id: responsible.userId }, select: { name: true } }).then((user) => user?.name ?? null)
        : null
    }
    const changes = updatedAuditChanges(existing, data, people)
    // Sin cambios reales no se escribe historial (mismo criterio que el resto de módulos).
    if (changes.length === 0) {
      response.json({ audit: auditView(existing) })
      return
    }
    const actor = auditActorOf(request)
    const audit = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, existing.id)
      if (!locked) return null
      const updated = await tx.audit.update({ where: { id: existing.id }, data, include: auditInclude })
      await auditEventWrite(tx, {
        auditId: updated.id,
        eventType: 'AUDIT_UPDATED',
        summary: 'Auditoría actualizada',
        actor,
        changes,
      })
      return updated
    })
    if (!audit) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.json({ audit: auditView(audit) })
  })
  app.patch('/api/processes/:processId/audits/:auditId', authMiddleware, userWriteGuard, updateAuditHandler)
  app.patch('/api/audits/:auditId', authMiddleware, userWriteGuard, withAuditProcessParam(updateAuditHandler))

  const changeAuditStatusHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid audit id' })
      return
    }
    const parsed = auditStatusChangeSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid status change', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, parsedIds.data.processId)
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const existing = await db.audit.findUnique({ where: { id: parsedIds.data.auditId }, include: auditInclude })
    if (!existing || existing.processId !== process.id) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    if (!canTransitionAudit(existing.status, parsed.data.status)) {
      response.status(409).json({ error: 'Invalid audit status transition' })
      return
    }
    // Cerrarse exige resumen: es el acta de cierre de la auditoría.
    if (parsed.data.status === AuditStatus.CLOSED && (!parsed.data.summary || parsed.data.summary.trim().length < 3)) {
      response.status(400).json({ error: 'Closing an audit requires a summary with at least 3 characters' })
      return
    }
    const data: Prisma.AuditUncheckedUpdateInput = { status: parsed.data.status }
    if (parsed.data.status === AuditStatus.IN_PROGRESS && !existing.startDate) data.startDate = new Date()
    if (parsed.data.status === AuditStatus.CLOSED || parsed.data.status === AuditStatus.CANCELLED) data.endDate = new Date()
    if (parsed.data.status === AuditStatus.CLOSED) data.summary = parsed.data.summary!.trim()
    const changes: RiskAuditChange[] = [
      { field: 'status', label: 'Estado', previousValue: existing.status, newValue: parsed.data.status },
      ...(parsed.data.summary && parsed.data.status === AuditStatus.CLOSED
        ? [{ field: 'summary', label: 'Resumen de cierre', previousValue: auditValue(existing.summary), newValue: auditValue(parsed.data.summary.trim()) }]
        : []),
    ]
    const actor = auditActorOf(request)
    const result = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, existing.id)
      if (!locked) return null
      // Gate de listas de verificación: cerrar exige que ningún ítem obligatorio siga en PENDING.
      // El recuento ocurre DESPUÉS de bloquear la fila de la auditoría, y toda escritura de ítems
      // también pasa por ese bloqueo, así que no se cuela una creación concurrente.
      if (parsed.data.status === AuditStatus.CLOSED) {
        const pending = await pendingRequiredItems(tx, existing.id)
        if (pending > 0) return { blocked: 'CHECKLIST_PENDING' as const, pending }
      }
      const updated = await tx.audit.update({ where: { id: existing.id }, data, include: auditInclude })
      await auditEventWrite(tx, {
        auditId: updated.id,
        eventType: 'STATUS_CHANGED',
        summary: `Auditoría ${auditStatusNames[parsed.data.status]}`,
        actor,
        changes,
        metadata: { previousStatus: existing.status, newStatus: parsed.data.status },
      })
      return { audit: updated }
    })
    if (!result) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    if ('blocked' in result) {
      response.status(409).json({
        error: `The audit cannot be closed while ${result.pending} required checklist item(s) are still pending`,
        reason: result.blocked,
      })
      return
    }
    response.json({ audit: auditView(result.audit) })
  })
  app.post('/api/processes/:processId/audits/:auditId/status', authMiddleware, userWriteGuard, changeAuditStatusHandler)
  app.post('/api/audits/:auditId/status', authMiddleware, userWriteGuard, withAuditProcessParam(changeAuditStatusHandler))

  const getAuditHistoryHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid audit id' })
      return
    }
    const parsedQuery = auditHistoryQuerySchema.safeParse(request.query)
    if (!parsedQuery.success) {
      response.status(400).json({ error: 'Invalid history query' })
      return
    }
    const audit = await findAccessibleAudit(request, parsedIds.data.processId, parsedIds.data.auditId)
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const { page, pageSize, eventType, from, to } = parsedQuery.data
    const where = {
      auditId: audit.id,
      ...(eventType ? { eventType } : {}),
      ...((from || to) ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    }
    const [total, events] = await Promise.all([
      db.auditEvent.count({ where }),
      db.auditEvent.findMany({
        where,
        include: auditEventInclude,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    response.json({ events: events.map(auditEventView), total, page, pageSize })
  })
  app.get('/api/processes/:processId/audits/:auditId/history', authMiddleware, getAuditHistoryHandler)
  app.get('/api/audits/:auditId/history', authMiddleware, withAuditProcessParam(getAuditHistoryHandler))

  const deleteAuditHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid audit id' })
      return
    }
    const process = await findAccessibleProcess(request, parsedIds.data.processId)
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const existing = await db.audit.findUnique({ where: { id: parsedIds.data.auditId }, select: { id: true, processId: true, code: true } })
    if (!existing || existing.processId !== process.id) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    // Una auditoría con hallazgos no se borra: su baja es CANCELLED, que conserva la evidencia
    // del seguimiento. El borrado queda para auditorías que nunca registraron hallazgos.
    const finding = await db.auditFinding.findFirst({ where: { auditId: existing.id }, select: { id: true } })
    if (finding) {
      response.status(409).json({ error: 'The audit has findings; cancel it instead' })
      return
    }
    // Sin hallazgos se retira la auditoría completa: evidencias (enlace y archivos), checklists,
    // vínculos e historial acompañan en la misma transacción (las claves foráneas son Restrict
    // sobre Audit y CASCADE no basta si el cliente de prueba no replica el motor). Los nombres en
    // disco se leen antes para limpiar los PDF después de confirmar la baja en base de datos.
    const storedNames = (await db.auditEvidenceFile.findMany({ where: { auditId: existing.id }, select: { storedName: true } })).map((file) => file.storedName)
    await db.$transaction(async (tx) => {
      await tx.auditEvidenceFile.deleteMany({ where: { auditId: existing.id } })
      await tx.auditEvidence.deleteMany({ where: { auditId: existing.id } })
      await tx.auditEvent.deleteMany({ where: { auditId: existing.id } })
      await tx.audit.delete({ where: { id: existing.id } })
    })
    if (storedNames.length > 0) {
      const { failed } = await removeEvidenceFiles(storedNames)
      if (failed.length > 0) {
        console.error('[evidence] no se pudieron borrar archivos tras eliminar la auditoría', { auditId: existing.id, failed })
      }
    }
    response.status(204).send()
  })
  app.delete('/api/processes/:processId/audits/:auditId', authMiddleware, userWriteGuard, deleteAuditHandler)
  app.delete('/api/audits/:auditId', authMiddleware, userWriteGuard, withAuditProcessParam(deleteAuditHandler))

  const listAuditFindingsHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid audit id' })
      return
    }
    const audit = await findAccessibleAudit(request, parsedIds.data.processId, parsedIds.data.auditId)
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const findings = await db.auditFinding.findMany({
      where: { auditId: audit.id },
      include: auditFindingInclude,
      orderBy: [{ createdAt: 'asc' }],
    })
    response.json({ findings: findings.map(auditFindingView) })
  })
  app.get('/api/processes/:processId/audits/:auditId/findings', authMiddleware, listAuditFindingsHandler)
  app.get('/api/audits/:auditId/findings', authMiddleware, withAuditProcessParam(listAuditFindingsHandler))

  const createAuditFindingHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid audit id' })
      return
    }
    const parsed = auditFindingCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid finding data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, parsedIds.data.processId)
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const existing = await db.audit.findUnique({ where: { id: parsedIds.data.auditId }, include: auditInclude })
    if (!existing || existing.processId !== process.id) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    if (isTerminalAuditStatus(existing.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    const responsible = await resolveUserInCompany(parsed.data.responsibleId, process.companyId, 'finding responsible')
    if (!responsible.ok) {
      response.status(responsible.status).json({ error: responsible.error })
      return
    }
    const links = await resolveFindingLinks(existing, parsed.data)
    if (!links.ok) {
      response.status(links.status).json({ error: links.error })
      return
    }
    const actor = auditActorOf(request)
    const finding = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, existing.id)
      if (!locked) return null
      const created = await tx.auditFinding.create({
        data: {
          auditId: existing.id,
          title: parsed.data.title,
          description: parsed.data.description,
          type: parsed.data.type,
          severity: parsed.data.severity,
          dueDate: parsed.data.dueDate || null,
          responsibleId: responsible.userId,
          itemId: links.itemId,
          processId: links.processId,
          procedureId: links.procedureId,
        },
        include: auditFindingInclude,
      })
      await auditEventWrite(tx, {
        auditId: existing.id,
        eventType: 'FINDING_CREATED',
        summary: `Hallazgo «${created.title}» creado`,
        actor,
        changes: findingAuditChanges(null, {
          title: created.title,
          description: created.description,
          type: created.type,
          severity: created.severity,
          dueDate: created.dueDate,
          responsibleName: created.responsible?.name ?? null,
          itemId: created.itemId,
          processId: created.processId,
          procedureId: created.procedureId,
        }),
        metadata: {
          findingId: created.id,
          ...(links.itemId ? { itemId: links.itemId } : {}),
          ...(links.processId ? { linkedProcessId: links.processId } : {}),
          ...(links.procedureId ? { linkedProcedureId: links.procedureId } : {}),
        },
      })
      return created
    })
    if (!finding) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.status(201).json({ finding: auditFindingView(finding) })
  })
  app.post('/api/processes/:processId/audits/:auditId/findings', authMiddleware, userWriteGuard, createAuditFindingHandler)
  app.post('/api/audits/:auditId/findings', authMiddleware, userWriteGuard, withAuditProcessParam(createAuditFindingHandler))

  const updateAuditFindingHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference, findingId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
      findingId: String(request.params.findingId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid finding id' })
      return
    }
    const parsed = auditFindingUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid finding data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, parsedIds.data.processId)
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const audit = await db.audit.findUnique({ where: { id: parsedIds.data.auditId }, select: { id: true, processId: true, status: true } })
    if (!audit || audit.processId !== process.id) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const existing = await db.auditFinding.findUnique({ where: { id: parsedIds.data.findingId }, include: auditFindingInclude })
    if (!existing || existing.auditId !== audit.id) {
      response.status(404).json({ error: 'Finding not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    // Un hallazgo verificado queda congelado: la verificación es el veredicto final del seguimiento.
    if (existing.status === AuditFindingStatus.VERIFIED) {
      response.status(409).json({ error: 'A verified finding cannot be edited' })
      return
    }
    const data: Prisma.AuditFindingUncheckedUpdateInput = {}
    if (parsed.data.title !== undefined) data.title = parsed.data.title
    if (parsed.data.description !== undefined) data.description = parsed.data.description
    if (parsed.data.type !== undefined) data.type = parsed.data.type
    if (parsed.data.severity !== undefined) data.severity = parsed.data.severity
    if (parsed.data.dueDate !== undefined) data.dueDate = parsed.data.dueDate || null
    if (parsed.data.efficacyVerification !== undefined) data.efficacyVerification = parsed.data.efficacyVerification || null
    if (parsed.data.responsibleId !== undefined) {
      const responsible = await resolveUserInCompany(parsed.data.responsibleId, process.companyId, 'finding responsible')
      if (!responsible.ok) {
        response.status(responsible.status).json({ error: responsible.error })
        return
      }
      data.responsibleId = responsible.userId
    }
    const links = await resolveFindingLinks({ id: audit.id, processId: audit.processId, process: { companyId: process.companyId } }, parsed.data)
    if (!links.ok) {
      response.status(links.status).json({ error: links.error })
      return
    }
    if (parsed.data.itemId !== undefined) {
      data.itemId = links.itemId
    }
    if (parsed.data.processId !== undefined) {
      data.processId = links.processId
    }
    if (parsed.data.procedureId !== undefined) {
      data.procedureId = links.procedureId
    }
    const nextResponsibleName = data.responsibleId !== undefined
      ? (data.responsibleId
          ? await db.user.findUnique({ where: { id: String(data.responsibleId) }, select: { name: true } }).then((user) => user?.name ?? null)
          : null)
      : undefined
    const changes = findingAuditChanges({
      title: existing.title,
      description: existing.description,
      type: existing.type,
      severity: existing.severity,
      dueDate: existing.dueDate,
      responsibleName: existing.responsible?.name ?? null,
      itemId: existing.itemId,
      itemDescription: existing.item?.description ?? null,
      processId: existing.processId,
      processName: existing.process?.name ?? null,
      procedureId: existing.procedureId,
      procedureName: existing.procedure?.name ?? null,
      efficacyVerification: existing.efficacyVerification,
    }, {
      ...(data.title !== undefined ? { title: String(data.title) } : {}),
      ...(data.description !== undefined ? { description: String(data.description) } : {}),
      ...(data.type !== undefined ? { type: String(data.type) } : {}),
      ...(data.severity !== undefined ? { severity: String(data.severity) } : {}),
      ...(data.dueDate !== undefined ? { dueDate: (data.dueDate as Date | null) ?? null } : {}),
      ...(nextResponsibleName !== undefined ? { responsibleName: nextResponsibleName } : {}),
      ...(data.itemId !== undefined ? { itemId: data.itemId as string | null } : {}),
      ...(data.processId !== undefined ? { processId: data.processId as string | null } : {}),
      ...(data.procedureId !== undefined ? { procedureId: data.procedureId as string | null } : {}),
      ...(data.efficacyVerification !== undefined ? { efficacyVerification: data.efficacyVerification as string | null } : {}),
    })
    if (changes.length === 0) {
      response.json({ finding: auditFindingView(existing) })
      return
    }
    const actor = auditActorOf(request)
    const finding = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return null
      const updated = await tx.auditFinding.update({ where: { id: existing.id }, data, include: auditFindingInclude })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'FINDING_UPDATED',
        summary: `Hallazgo «${updated.title}» actualizado`,
        actor,
        changes,
        metadata: { findingId: updated.id },
      })
      return updated
    })
    if (!finding) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.json({ finding: auditFindingView(finding) })
  })
  app.patch('/api/processes/:processId/audits/:auditId/findings/:findingId', authMiddleware, userWriteGuard, updateAuditFindingHandler)
  app.patch('/api/audits/:auditId/findings/:findingId', authMiddleware, userWriteGuard, withAuditProcessParam(updateAuditFindingHandler))

  const changeAuditFindingStatusHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference, findingId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
      findingId: String(request.params.findingId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid finding id' })
      return
    }
    const parsed = auditFindingStatusChangeSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid status change', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, parsedIds.data.processId)
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const audit = await db.audit.findUnique({ where: { id: parsedIds.data.auditId }, select: { id: true, processId: true, status: true } })
    if (!audit || audit.processId !== process.id) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const existing = await db.auditFinding.findUnique({ where: { id: parsedIds.data.findingId }, include: auditFindingInclude })
    if (!existing || existing.auditId !== audit.id) {
      response.status(404).json({ error: 'Finding not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    if (!canTransitionAuditFinding(existing.status, parsed.data.status)) {
      response.status(409).json({ error: 'Invalid finding status transition' })
      return
    }
    // RESOLVED exige resolución (también validada en Zod); VERIFIED registra actor y fecha del
    // verificador, que salen de la sesión y nunca del cuerpo. Para las No conformidades, además,
    // exige la verificación de eficacia ya registrada en el hallazgo (se guarda con PATCH).
    if (parsed.data.status === AuditFindingStatus.RESOLVED && (!parsed.data.resolution || parsed.data.resolution.trim().length < 3)) {
      response.status(400).json({ error: 'Resolving a finding requires a resolution with at least 3 characters' })
      return
    }
    if (parsed.data.status === AuditFindingStatus.VERIFIED && !existing.resolution) {
      response.status(400).json({ error: 'A finding must be resolved before it can be verified' })
      return
    }
    if (parsed.data.status === AuditFindingStatus.VERIFIED && existing.type === 'NONCONFORMITY' && (!existing.efficacyVerification || existing.efficacyVerification.trim().length < 3)) {
      response.status(400).json({ error: 'A nonconformity requires an efficacy verification of at least 3 characters before it can be verified' })
      return
    }
    const data: Prisma.AuditFindingUncheckedUpdateInput = { status: parsed.data.status }
    const changes: RiskAuditChange[] = [
      { field: 'status', label: 'Estado del hallazgo', previousValue: existing.status, newValue: parsed.data.status },
    ]
    if (parsed.data.status === AuditFindingStatus.RESOLVED) {
      data.resolution = parsed.data.resolution!.trim()
      changes.push({ field: 'resolution', label: 'Resolución', previousValue: auditValue(existing.resolution), newValue: auditValue(data.resolution) })
    }
    if (parsed.data.status === AuditFindingStatus.VERIFIED) {
      data.verifiedById = request.user?.id ?? null
      data.verifiedAt = new Date()
      changes.push({ field: 'verifiedAt', label: 'Verificado', previousValue: null, newValue: auditValue(data.verifiedAt) })
    }
    const actor = auditActorOf(request)
    const result = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return null
      // Gate de acciones correctivas: ninguna obligatoria sin estado final impide resolver el
      // hallazgo. El recuento ocurre con la fila de la auditoría bloqueada, de modo que no se
      // cuela una creación concurrente de acciones mientras se resuelve.
      if (parsed.data.status === AuditFindingStatus.RESOLVED) {
        const pending = await pendingRequiredActions(tx, existing.id)
        if (pending > 0) return { blocked: 'ACTIONS_PENDING' as const, pending }
      }
      const updated = await tx.auditFinding.update({ where: { id: existing.id }, data, include: auditFindingInclude })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'FINDING_STATUS_CHANGED',
        summary: `Hallazgo «${updated.title}» ${auditFindingStatusNames[parsed.data.status].toLowerCase()}`,
        actor,
        changes,
        metadata: { findingId: updated.id, previousStatus: existing.status, newStatus: parsed.data.status },
      })
      return { finding: updated }
    })
    if (!result) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    if ('blocked' in result) {
      response.status(409).json({
        error: `The finding cannot be resolved while ${result.pending} required corrective action(s) are still open`,
        reason: result.blocked,
      })
      return
    }
    response.json({ finding: auditFindingView(result.finding) })
  })
  app.post('/api/processes/:processId/audits/:auditId/findings/:findingId/status', authMiddleware, userWriteGuard, changeAuditFindingStatusHandler)
  app.post('/api/audits/:auditId/findings/:findingId/status', authMiddleware, userWriteGuard, withAuditProcessParam(changeAuditFindingStatusHandler))

  const deleteAuditFindingHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference, findingId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
      findingId: String(request.params.findingId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid finding id' })
      return
    }
    const process = await findAccessibleProcess(request, parsedIds.data.processId)
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const audit = await db.audit.findUnique({ where: { id: parsedIds.data.auditId }, select: { id: true, processId: true, status: true } })
    if (!audit || audit.processId !== process.id) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const existing = await db.auditFinding.findUnique({ where: { id: parsedIds.data.findingId }, select: { id: true, title: true, auditId: true } })
    if (!existing || existing.auditId !== audit.id) {
      response.status(404).json({ error: 'Finding not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    // Un hallazgo verificado no se borra: la verificación es el veredicto final del seguimiento.
    const verified = await db.auditFinding.findUnique({ where: { id: existing.id }, select: { status: true } })
    if (verified?.status === AuditFindingStatus.VERIFIED) {
      response.status(409).json({ error: 'A verified finding cannot be deleted' })
      return
    }
    // Un hallazgo con acciones correctivas tampoco se borra: la trazabilidad del seguimiento
    // (acciones y su progreso) sobrevive al hallazgo, que además es Restrict en el esquema.
    const action = await db.auditCorrectiveAction.findFirst({ where: { findingId: existing.id }, select: { id: true } })
    if (action) {
      response.status(409).json({ error: 'The finding has corrective actions; resolve or cancel it instead' })
      return
    }
    const actor = auditActorOf(request)
    const deleted = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return false
      // Las evidencias ancladas al hallazgo sobreviven con findingId en null (SET NULL en el
      // esquema): la evidencia documental no se pierde al retirar el hallazgo.
      await tx.auditEvidence.updateMany({ where: { findingId: existing.id }, data: { findingId: null } })
      await tx.auditEvidenceFile.updateMany({ where: { findingId: existing.id }, data: { findingId: null } })
      await tx.auditFinding.delete({ where: { id: existing.id } })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'FINDING_DELETED',
        summary: `Hallazgo «${existing.title}» eliminado`,
        actor,
        metadata: { findingId: existing.id },
      })
      return true
    })
    if (!deleted) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.status(204).send()
  })
  app.delete('/api/processes/:processId/audits/:auditId/findings/:findingId', authMiddleware, userWriteGuard, deleteAuditFindingHandler)
  app.delete('/api/audits/:auditId/findings/:findingId', authMiddleware, userWriteGuard, withAuditProcessParam(deleteAuditFindingHandler))

  const listAuditEvidencesHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid audit id' })
      return
    }
    const audit = await findAccessibleAudit(request, parsedIds.data.processId, parsedIds.data.auditId)
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const evidences = await db.auditEvidence.findMany({
      where: { auditId: audit.id },
      orderBy: [{ createdAt: 'asc' }],
    })
    response.json({ evidences: evidences.map(auditEvidenceView) })
  })
  app.get('/api/processes/:processId/audits/:auditId/evidences', authMiddleware, listAuditEvidencesHandler)
  app.get('/api/audits/:auditId/evidences', authMiddleware, withAuditProcessParam(listAuditEvidencesHandler))

  const createAuditEvidenceHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid audit id' })
      return
    }
    const parsed = auditEvidenceCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid evidence data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, parsedIds.data.processId)
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const existing = await db.audit.findUnique({ where: { id: parsedIds.data.auditId }, select: { id: true, processId: true, status: true } })
    if (!existing || existing.processId !== process.id) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    if (isTerminalAuditStatus(existing.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    // El hallazgo de destino, si viene, debe pertenecer exactamente a esta auditoría: no se
    // admiten referencias cruzadas entre empresas o auditorías (404 sin filtrar existencia).
    if (parsed.data.findingId) {
      const finding = await db.auditFinding.findFirst({
        where: { id: parsed.data.findingId, auditId: existing.id },
        select: { id: true },
      })
      if (!finding) {
        response.status(404).json({ error: 'Finding not found' })
        return
      }
    }
    const actor = auditActorOf(request)
    const evidence = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, existing.id)
      if (!locked) return null
      const created = await tx.auditEvidence.create({
        data: {
          auditId: existing.id,
          findingId: parsed.data.findingId || null,
          name: parsed.data.name,
          description: parsed.data.description,
          url: parsed.data.url,
        },
      })
      await auditEventWrite(tx, {
        auditId: existing.id,
        eventType: 'EVIDENCE_CREATED',
        summary: `Evidencia «${created.name}» registrada`,
        actor,
        changes: auditEvidenceAuditChanges(null, created),
        metadata: { evidenceId: created.id, ...(created.findingId ? { findingId: created.findingId } : {}) },
      })
      return created
    })
    if (!evidence) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.status(201).json({ evidence: auditEvidenceView(evidence) })
  })
  app.post('/api/processes/:processId/audits/:auditId/evidences', authMiddleware, userWriteGuard, createAuditEvidenceHandler)
  app.post('/api/audits/:auditId/evidences', authMiddleware, userWriteGuard, withAuditProcessParam(createAuditEvidenceHandler))

  const updateAuditEvidenceHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference, evidenceId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
      evidenceId: String(request.params.evidenceId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid evidence id' })
      return
    }
    const parsed = auditEvidenceUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid evidence data', details: parsed.error.issues })
      return
    }
    const process = await findAccessibleProcess(request, parsedIds.data.processId)
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const audit = await db.audit.findUnique({ where: { id: parsedIds.data.auditId }, select: { id: true, processId: true, status: true } })
    if (!audit || audit.processId !== process.id) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const existing = await db.auditEvidence.findUnique({ where: { id: parsedIds.data.evidenceId } })
    if (!existing || existing.auditId !== audit.id) {
      response.status(404).json({ error: 'Evidence not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    const data: Prisma.AuditEvidenceUncheckedUpdateInput = {}
    if (parsed.data.name !== undefined) data.name = parsed.data.name
    if (parsed.data.description !== undefined) data.description = parsed.data.description
    if (parsed.data.url !== undefined) data.url = parsed.data.url
    if (parsed.data.findingId !== undefined) {
      if (parsed.data.findingId) {
        const finding = await db.auditFinding.findFirst({
          where: { id: parsed.data.findingId, auditId: audit.id },
          select: { id: true },
        })
        if (!finding) {
          response.status(404).json({ error: 'Finding not found' })
          return
        }
        data.findingId = parsed.data.findingId
      } else {
        data.findingId = null
      }
    }
    const changes = auditEvidenceAuditChanges(existing, {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.url !== undefined ? { url: parsed.data.url } : {}),
    })
    if (changes.length === 0) {
      response.json({ evidence: auditEvidenceView(existing) })
      return
    }
    const actor = auditActorOf(request)
    const evidence = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return null
      const updated = await tx.auditEvidence.update({ where: { id: existing.id }, data })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'EVIDENCE_UPDATED',
        summary: `Evidencia «${updated.name}» actualizada`,
        actor,
        changes,
        metadata: { evidenceId: updated.id, ...(updated.findingId ? { findingId: updated.findingId } : {}) },
      })
      return updated
    })
    if (!evidence) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.json({ evidence: auditEvidenceView(evidence) })
  })
  app.patch('/api/processes/:processId/audits/:auditId/evidences/:evidenceId', authMiddleware, userWriteGuard, updateAuditEvidenceHandler)
  app.patch('/api/audits/:auditId/evidences/:evidenceId', authMiddleware, userWriteGuard, withAuditProcessParam(updateAuditEvidenceHandler))

  const deleteAuditEvidenceHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference, evidenceId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
      evidenceId: String(request.params.evidenceId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid evidence id' })
      return
    }
    const process = await findAccessibleProcess(request, parsedIds.data.processId)
    if (!process) {
      response.status(404).json({ error: 'Process not found' })
      return
    }
    const audit = await db.audit.findUnique({ where: { id: parsedIds.data.auditId }, select: { id: true, processId: true, status: true } })
    if (!audit || audit.processId !== process.id) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const existing = await db.auditEvidence.findUnique({ where: { id: parsedIds.data.evidenceId } })
    if (!existing || existing.auditId !== audit.id) {
      response.status(404).json({ error: 'Evidence not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    const actor = auditActorOf(request)
    const deleted = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return false
      await tx.auditEvidence.delete({ where: { id: existing.id } })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'EVIDENCE_DELETED',
        summary: `Evidencia «${existing.name}» eliminada`,
        actor,
        changes: auditEvidenceAuditChanges(existing, {}),
        metadata: { evidenceId: existing.id, ...(existing.findingId ? { findingId: existing.findingId } : {}) },
      })
      return true
    })
    if (!deleted) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.status(204).send()
  })
  app.delete('/api/processes/:processId/audits/:auditId/evidences/:evidenceId', authMiddleware, userWriteGuard, deleteAuditEvidenceHandler)
  app.delete('/api/audits/:auditId/evidences/:evidenceId', authMiddleware, userWriteGuard, withAuditProcessParam(deleteAuditEvidenceHandler))

  // ---- Aseguramiento de Calidad: rutas top-level ----
  // Listado transversal de auditorías de la empresa con indicadores server-side (hallazgos,
  // acciones y checklist) para el panel de Calidad. El scope de empresa es el mismo que en el
  // resto de rutas top-level: scopeForCompany para usuarios de empresa, sin filtro para SUPERUSER.
  app.get('/api/audits', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = auditQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid audit filters', details: parsed.error.issues })
      return
    }
    const { status, search, processId } = parsed.data
    const where: Prisma.AuditWhereInput = {
      process: {
        company: scopeForCompany(request),
        ...(processId ? { id: processId } : {}),
      },
      ...(status ? { status } : {}),
      ...(search ? {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    }
    const audits = await db.audit.findMany({
      where,
      include: {
        ...auditInclude,
        checklists: { include: checklistInclude },
        findings: {
          include: { actions: { select: { status: true, required: true } } },
        },
      },
      orderBy: [{ code: 'asc' }, { createdAt: 'desc' }],
    })
    response.json({
      audits: audits.map((audit) => {
        const allItems = audit.checklists.flatMap((checklist) => checklist.items)
        const requiredPending = allItems.filter((item) => item.required && item.result === 'PENDING').length
        const openFindings = audit.findings.filter((finding) => finding.status !== 'VERIFIED').length
        const openActions = audit.findings.flatMap((finding) => finding.actions).filter((action) => action.required && !['COMPLETED', 'CANCELLED'].includes(action.status)).length
        return {
          ...auditView(audit as unknown as AuditWithInclude),
          indicators: {
            findings: audit.findings.length,
            openFindings,
            checklistTotal: allItems.length,
            checklistRequiredPending: requiredPending,
            openRequiredActions: openActions,
          },
        }
      }),
    })
  }))

  // Detalle completo de una auditoría (checklists, hallazgos con acciones, evidencias en disco y
  // relaciones) para la vista de seguimiento sin ir y volver a la lista.
  app.get('/api/audits/:auditId', authMiddleware, asyncHandler(async (request, response) => {
    const audit = await findCompanyAudit(request, String(request.params.auditId))
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const full = await db.audit.findUnique({ where: { id: audit.id }, include: auditDetailInclude })
    if (!full) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    response.json({ audit: auditDetailView(full) })
  }))

  // Sustituye el conjunto de procesos y procedimientos relacionados con la auditoría. El proceso
  // principal no se toca (sigue siendo el ancla del código y del tenant); los demás se validan
  // contra la empresa y se registran en el historial.
  app.put('/api/audits/:auditId/relations', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = auditRelationsUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid relations data', details: parsed.error.issues })
      return
    }
    const audit = await findCompanyAudit(request, String(request.params.auditId))
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    const companyId = audit.process.companyId
    const relations = await validateAuditRelations(companyId, audit.processId, parsed.data)
    if (!relations.ok) {
      response.status(relations.status).json({ error: relations.error })
      return
    }
    const actor = auditActorOf(request)
    const result = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return null
      const sync = await syncAuditRelations(tx, audit.id, relations.processIds, relations.procedureIds)
      if (sync.changed) {
        await auditEventWrite(tx, {
          auditId: audit.id,
          eventType: 'AUDIT_RELATIONS_UPDATED',
          summary: 'Relaciones de procesos y procedimientos actualizadas',
          actor,
          metadata: {
            addedProcessIds: sync.addedProcessIds,
            removedProcessIds: sync.removedProcessIds,
            addedProcedureIds: sync.addedProcedureIds,
            removedProcedureIds: sync.removedProcedureIds,
          },
        })
      }
      const full = await tx.audit.findUnique({ where: { id: audit.id }, include: auditRelationsInclude })
      return full
    })
    if (!result) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.json({ relations: auditRelationsView(result as unknown as AuditWithRelations) })
  }))

  // ---- Listas de verificación ----
  const listAuditChecklistsHandler = asyncHandler(async (request, response) => {
    const audit = await findAccessibleAudit(request, String(request.params.processId), String(request.params.auditId))
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const checklists = await db.auditChecklist.findMany({
      where: { auditId: audit.id },
      include: checklistInclude,
      orderBy: [{ createdAt: 'asc' }],
    })
    response.json({
      checklists: checklists.map((checklist) => ({
        ...checklistView(checklist),
        progress: checklistProgress(checklist),
      })),
    })
  })
  app.get('/api/audits/:auditId/checklists', authMiddleware, withAuditProcessParam(listAuditChecklistsHandler))
  app.get('/api/processes/:processId/audits/:auditId/checklists', authMiddleware, listAuditChecklistsHandler)

  const createAuditChecklistHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid audit id' })
      return
    }
    const parsed = auditChecklistCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid checklist data', details: parsed.error.issues })
      return
    }
    const audit = await findAccessibleAudit(request, parsedIds.data.processId, parsedIds.data.auditId)
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    const actor = auditActorOf(request)
    const checklist = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return null
      const created = await tx.auditChecklist.create({
        data: { auditId: audit.id, name: parsed.data.name },
        include: checklistInclude,
      })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'CHECKLIST_CREATED',
        summary: `Lista de verificación «${created.name}» creada`,
        actor,
        changes: [{ field: 'name', label: 'Nombre', previousValue: null, newValue: created.name }],
        metadata: { checklistId: created.id },
      })
      return created
    })
    if (!checklist) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.status(201).json({ checklist: { ...checklistView(checklist), progress: checklistProgress(checklist) } })
  })
  app.post('/api/audits/:auditId/checklists', authMiddleware, userWriteGuard, withAuditProcessParam(createAuditChecklistHandler))
  app.post('/api/processes/:processId/audits/:auditId/checklists', authMiddleware, userWriteGuard, createAuditChecklistHandler)

  const updateAuditChecklistHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference, checklistId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
      checklistId: String(request.params.checklistId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid checklist id' })
      return
    }
    const parsed = auditChecklistUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid checklist data', details: parsed.error.issues })
      return
    }
    const audit = await findAccessibleAudit(request, parsedIds.data.processId, parsedIds.data.auditId)
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const existing = await db.auditChecklist.findFirst({
      where: { id: parsedIds.data.checklistId, auditId: audit.id },
      include: checklistInclude,
    })
    if (!existing) {
      response.status(404).json({ error: 'Checklist not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    const changes: RiskAuditChange[] = []
    const data: Prisma.AuditChecklistUncheckedUpdateInput = {}
    if (parsed.data.name !== undefined && parsed.data.name !== existing.name) {
      data.name = parsed.data.name
      changes.push({ field: 'name', label: 'Nombre', previousValue: existing.name, newValue: parsed.data.name })
    }
    if (changes.length === 0) {
      response.json({ checklist: { ...checklistView(existing), progress: checklistProgress(existing) } })
      return
    }
    const actor = auditActorOf(request)
    const checklist = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return null
      const updated = await tx.auditChecklist.update({ where: { id: existing.id }, data, include: checklistInclude })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'CHECKLIST_UPDATED',
        summary: `Lista de verificación «${updated.name}» actualizada`,
        actor,
        changes,
        metadata: { checklistId: updated.id },
      })
      return updated
    })
    if (!checklist) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.json({ checklist: { ...checklistView(checklist), progress: checklistProgress(checklist) } })
  })
  app.patch('/api/audits/:auditId/checklists/:checklistId', authMiddleware, userWriteGuard, withAuditProcessParam(updateAuditChecklistHandler))
  app.patch('/api/processes/:processId/audits/:auditId/checklists/:checklistId', authMiddleware, userWriteGuard, updateAuditChecklistHandler)

  const deleteAuditChecklistHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference, checklistId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
      checklistId: String(request.params.checklistId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid checklist id' })
      return
    }
    const audit = await findAccessibleAudit(request, parsedIds.data.processId, parsedIds.data.auditId)
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const existing = await db.auditChecklist.findFirst({
      where: { id: parsedIds.data.checklistId, auditId: audit.id },
      select: { id: true, name: true },
    })
    if (!existing) {
      response.status(404).json({ error: 'Checklist not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    const actor = auditActorOf(request)
    const deleted = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return false
      await tx.auditChecklist.delete({ where: { id: existing.id } })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'CHECKLIST_DELETED',
        summary: `Lista de verificación «${existing.name}» eliminada`,
        actor,
        changes: [{ field: 'name', label: 'Nombre', previousValue: existing.name, newValue: null }],
        metadata: { checklistId: existing.id },
      })
      return true
    })
    if (!deleted) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.status(204).send()
  })
  app.delete('/api/audits/:auditId/checklists/:checklistId', authMiddleware, userWriteGuard, withAuditProcessParam(deleteAuditChecklistHandler))
  app.delete('/api/processes/:processId/audits/:auditId/checklists/:checklistId', authMiddleware, userWriteGuard, deleteAuditChecklistHandler)

  const createAuditChecklistItemHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference, checklistId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
      checklistId: String(request.params.checklistId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid checklist id' })
      return
    }
    const parsed = auditChecklistItemCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid checklist item data', details: parsed.error.issues })
      return
    }
    const audit = await findAccessibleAudit(request, parsedIds.data.processId, parsedIds.data.auditId)
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const checklist = await db.auditChecklist.findFirst({
      where: { id: parsedIds.data.checklistId, auditId: audit.id },
      select: { id: true, name: true },
    })
    if (!checklist) {
      response.status(404).json({ error: 'Checklist not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    // Sin posición explícita el ítem va al final: evita huecos y reordenes accidentales.
    const position = parsed.data.position ?? await db.auditChecklistItem.count({ where: { checklistId: checklist.id } })
    const actor = auditActorOf(request)
    const item = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return null
      const created = await tx.auditChecklistItem.create({
        data: {
          checklistId: checklist.id,
          description: parsed.data.description,
          criteria: parsed.data.criteria,
          required: parsed.data.required ?? true,
          position,
        },
      })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'CHECKLIST_ITEM_CREATED',
        summary: `Ítem «${created.description.slice(0, 80)}» añadido a la lista`,
        actor,
        changes: [
          { field: 'description', label: 'Descripción', previousValue: null, newValue: created.description },
          { field: 'required', label: 'Obligatorio', previousValue: null, newValue: String(created.required) },
        ],
        metadata: { checklistId: checklist.id, itemId: created.id },
      })
      return created
    })
    if (!item) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.status(201).json({ item: checklistItemView(item) })
  })
  app.post('/api/audits/:auditId/checklists/:checklistId/items', authMiddleware, userWriteGuard, withAuditProcessParam(createAuditChecklistItemHandler))
  app.post('/api/processes/:processId/audits/:auditId/checklists/:checklistId/items', authMiddleware, userWriteGuard, createAuditChecklistItemHandler)

  const updateAuditChecklistItemHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference, checklistId: idReference, itemId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
      checklistId: String(request.params.checklistId),
      itemId: String(request.params.itemId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid checklist item id' })
      return
    }
    const parsed = auditChecklistItemUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid checklist item data', details: parsed.error.issues })
      return
    }
    const audit = await findAccessibleAudit(request, parsedIds.data.processId, parsedIds.data.auditId)
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const existing = await db.auditChecklistItem.findFirst({
      where: { id: parsedIds.data.itemId, checklistId: parsedIds.data.checklistId, checklist: { auditId: audit.id } },
    })
    if (!existing) {
      response.status(404).json({ error: 'Checklist item not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    const data: Prisma.AuditChecklistItemUncheckedUpdateInput = {}
    const changes: RiskAuditChange[] = []
    if (parsed.data.description !== undefined && parsed.data.description !== existing.description) {
      data.description = parsed.data.description
      changes.push({ field: 'description', label: 'Descripción', previousValue: existing.description, newValue: parsed.data.description })
    }
    if (parsed.data.criteria !== undefined && parsed.data.criteria !== existing.criteria) {
      data.criteria = parsed.data.criteria
      changes.push({ field: 'criteria', label: 'Criterio', previousValue: existing.criteria, newValue: parsed.data.criteria })
    }
    if (parsed.data.result !== undefined && parsed.data.result !== existing.result) {
      data.result = parsed.data.result
      changes.push({ field: 'result', label: 'Resultado', previousValue: existing.result, newValue: parsed.data.result })
    }
    if (parsed.data.observations !== undefined && parsed.data.observations !== existing.observations) {
      data.observations = parsed.data.observations || null
      changes.push({ field: 'observations', label: 'Observaciones', previousValue: existing.observations, newValue: data.observations as string | null })
    }
    if (parsed.data.required !== undefined && parsed.data.required !== existing.required) {
      data.required = parsed.data.required
      changes.push({ field: 'required', label: 'Obligatorio', previousValue: String(existing.required), newValue: String(parsed.data.required) })
    }
    if (parsed.data.position !== undefined && parsed.data.position !== existing.position) {
      data.position = parsed.data.position
      changes.push({ field: 'position', label: 'Posición', previousValue: String(existing.position), newValue: String(parsed.data.position) })
    }
    if (changes.length === 0) {
      response.json({ item: checklistItemView(existing) })
      return
    }
    const actor = auditActorOf(request)
    const item = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return null
      const updated = await tx.auditChecklistItem.update({ where: { id: existing.id }, data })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'CHECKLIST_ITEM_UPDATED',
        summary: `Ítem «${updated.description.slice(0, 80)}» actualizado`,
        actor,
        changes,
        metadata: { checklistId: existing.checklistId, itemId: updated.id },
      })
      return updated
    })
    if (!item) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.json({ item: checklistItemView(item) })
  })
  app.patch('/api/audits/:auditId/checklists/:checklistId/items/:itemId', authMiddleware, userWriteGuard, withAuditProcessParam(updateAuditChecklistItemHandler))
  app.patch('/api/processes/:processId/audits/:auditId/checklists/:checklistId/items/:itemId', authMiddleware, userWriteGuard, updateAuditChecklistItemHandler)

  const deleteAuditChecklistItemHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference, checklistId: idReference, itemId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
      checklistId: String(request.params.checklistId),
      itemId: String(request.params.itemId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid checklist item id' })
      return
    }
    const audit = await findAccessibleAudit(request, parsedIds.data.processId, parsedIds.data.auditId)
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const existing = await db.auditChecklistItem.findFirst({
      where: { id: parsedIds.data.itemId, checklistId: parsedIds.data.checklistId, checklist: { auditId: audit.id } },
      select: { id: true, description: true, checklistId: true },
    })
    if (!existing) {
      response.status(404).json({ error: 'Checklist item not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    const actor = auditActorOf(request)
    const deleted = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return false
      // Los hallazgos anclados al ítem sobreviven con itemId en null (SET NULL); los archivos de
      // evidencia del ítem también se desanclan para no perder el PDF.
      await tx.auditFinding.updateMany({ where: { itemId: existing.id }, data: { itemId: null } })
      await tx.auditEvidenceFile.updateMany({ where: { itemId: existing.id }, data: { itemId: null } })
      await tx.auditChecklistItem.delete({ where: { id: existing.id } })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'CHECKLIST_ITEM_DELETED',
        summary: `Ítem «${existing.description.slice(0, 80)}» eliminado`,
        actor,
        changes: [{ field: 'description', label: 'Descripción', previousValue: existing.description, newValue: null }],
        metadata: { checklistId: existing.checklistId, itemId: existing.id },
      })
      return true
    })
    if (!deleted) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.status(204).send()
  })
  app.delete('/api/audits/:auditId/checklists/:checklistId/items/:itemId', authMiddleware, userWriteGuard, withAuditProcessParam(deleteAuditChecklistItemHandler))
  app.delete('/api/processes/:processId/audits/:auditId/checklists/:checklistId/items/:itemId', authMiddleware, userWriteGuard, deleteAuditChecklistItemHandler)

  // ---- Evidencias en PDF (archivos privados) ----
  // Mismo contrato que la evidencia de tickets: multipart, solo PDF, validación de firma antes de
  // tocar disco, descarga autenticada y nombre en disco nunca expuesto al cliente.
  const resolveAuditEvidenceAnchor = async (audit: { id: string }, data: { findingId?: string | null; actionId?: string | null; itemId?: string | null }) => {
    const anchors = { findingId: null as string | null, actionId: null as string | null, itemId: null as string | null }
    const provided = [data.findingId, data.actionId, data.itemId].filter(Boolean)
    if (provided.length > 1) {
      return { ok: false as const, status: 400 as const, error: 'A file can be attached to at most one of finding, action or checklist item' }
    }
    if (data.findingId) {
      const finding = await db.auditFinding.findFirst({ where: { id: data.findingId, auditId: audit.id }, select: { id: true } })
      if (!finding) return { ok: false as const, status: 404 as const, error: 'Finding not found' }
      anchors.findingId = finding.id
    }
    if (data.actionId) {
      const action = await db.auditCorrectiveAction.findFirst({
        where: { id: data.actionId, finding: { auditId: audit.id } },
        select: { id: true },
      })
      if (!action) return { ok: false as const, status: 404 as const, error: 'Corrective action not found' }
      anchors.actionId = action.id
    }
    if (data.itemId) {
      const item = await db.auditChecklistItem.findFirst({
        where: { id: data.itemId, checklist: { auditId: audit.id } },
        select: { id: true },
      })
      if (!item) return { ok: false as const, status: 404 as const, error: 'Checklist item not found' }
      anchors.itemId = item.id
    }
    return { ok: true as const, ...anchors }
  }

  app.post('/api/audits/:auditId/evidence-files', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const audit = await findCompanyAudit(request, String(request.params.auditId))
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    const contentTypeHeader = String(request.headers['content-type'] ?? '')
    if (!/^multipart\/form-data\b/i.test(contentTypeHeader.trim())) {
      throw new MultipartError(415, 'La evidencia debe subirse como multipart/form-data con el campo "file"')
    }
    const raw = await readRequestBuffer(request, MAX_UPLOAD_REQUEST_BYTES)
    const parts = parseMultipartFormData(raw, contentTypeHeader)
    const file = findMultipartFile(parts, 'file')
    if (!file) {
      throw new MultipartError(400, 'Falta el archivo PDF en el campo "file"')
    }
    const anchorPayload: { findingId?: string | null; actionId?: string | null; itemId?: string | null } = {}
    // El campo de anclaje viaja como campo de texto del multipart (misma part que file).
    for (const part of parts) {
      if (part.filename) continue
      if (part.fieldName === 'findingId' || part.fieldName === 'actionId' || part.fieldName === 'itemId') {
        const value = part.data.toString('utf8').trim()
        if (value) anchorPayload[part.fieldName] = value
      }
    }
    const anchors = await resolveAuditEvidenceAnchor(audit, anchorPayload)
    if (!anchors.ok) {
      response.status(anchors.status).json({ error: anchors.error })
      return
    }
    const upload = validateEvidenceUpload({ filename: sanitizeUploadFilename(file.filename ?? ''), contentType: file.contentType, data: file.data })
    const storedName = nextStoredName()
    try {
      await writeEvidenceFile(storedName, file.data)
      const actor = auditActorOf(request)
      const created = await db.$transaction(async (tx) => {
        const locked = await lockAuditForWrite(tx, audit.id)
        if (!locked) return null
        const saved = await tx.auditEvidenceFile.create({
          data: {
            auditId: audit.id,
            findingId: anchors.findingId,
            actionId: anchors.actionId,
            itemId: anchors.itemId,
            filename: upload.filename,
            storedName,
            mimeType: upload.mimeType,
            size: upload.size,
            uploadedById: request.user!.id,
          },
          include: auditEvidenceFileInclude,
        })
        await auditEventWrite(tx, {
          auditId: audit.id,
          eventType: 'EVIDENCE_FILE_CREATED',
          summary: `Evidencia «${saved.filename}» adjuntada`,
          actor,
          metadata: {
            evidenceFileId: saved.id,
            ...(saved.findingId ? { findingId: saved.findingId } : {}),
            ...(saved.actionId ? { actionId: saved.actionId } : {}),
            ...(saved.itemId ? { itemId: saved.itemId } : {}),
          },
        })
        return saved
      })
      if (!created) {
        const { failed } = await removeEvidenceFiles([storedName])
        if (failed.length > 0) {
          console.error('[evidence] no se pudo retirar el archivo tras rechazar la subida por estado', { auditId: audit.id, storedName, failed })
        }
        response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
        return
      }
      response.status(201).json({ file: auditEvidenceFileView(created) })
    } catch (error) {
      const { failed } = await removeEvidenceFiles([storedName])
      if (failed.length > 0) {
        console.error('[evidence] no se pudo retirar el archivo tras fallar la subida', { auditId: audit.id, storedName, failed })
      }
      throw error
    }
  }))

  app.get('/api/audits/:auditId/evidence-files', authMiddleware, asyncHandler(async (request, response) => {
    const audit = await findCompanyAudit(request, String(request.params.auditId))
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const files = await db.auditEvidenceFile.findMany({
      where: { auditId: audit.id },
      include: auditEvidenceFileInclude,
      orderBy: [{ createdAt: 'desc' }],
    })
    response.json({ files: files.map(auditEvidenceFileView) })
  }))

  app.get('/api/audits/:auditId/evidence-files/:fileId', authMiddleware, asyncHandler(async (request, response) => {
    const audit = await findCompanyAudit(request, String(request.params.auditId))
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const record = await db.auditEvidenceFile.findFirst({ where: { id: String(request.params.fileId), auditId: audit.id } })
    if (!record) {
      response.status(404).json({ error: 'Evidence not found' })
      return
    }
    let data: Buffer
    try {
      data = await readEvidenceFile(record.storedName)
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        response.status(404).json({ error: 'El archivo de evidencia ya no está disponible' })
        return
      }
      throw error
    }
    response.setHeader('Content-Type', record.mimeType)
    response.setHeader('Content-Length', String(data.length))
    response.setHeader('Content-Disposition', `attachment; filename="${sanitizeUploadFilename(record.filename)}"`)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'private, no-store')
    response.send(data)
  }))

  app.delete('/api/audits/:auditId/evidence-files/:fileId', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const audit = await findCompanyAudit(request, String(request.params.auditId))
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const existing = await db.auditEvidenceFile.findFirst({ where: { id: String(request.params.fileId), auditId: audit.id } })
    if (!existing) {
      response.status(404).json({ error: 'Evidence not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    const actor = auditActorOf(request)
    const deleted = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return false
      await tx.auditEvidenceFile.delete({ where: { id: existing.id } })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'EVIDENCE_FILE_DELETED',
        summary: `Evidencia «${existing.filename}» eliminada`,
        actor,
        metadata: {
          evidenceFileId: existing.id,
          ...(existing.findingId ? { findingId: existing.findingId } : {}),
          ...(existing.actionId ? { actionId: existing.actionId } : {}),
          ...(existing.itemId ? { itemId: existing.itemId } : {}),
        },
      })
      return true
    })
    if (!deleted) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    const { failed } = await removeEvidenceFiles([existing.storedName])
    if (failed.length > 0) {
      console.error('[evidence] archivo no borrado tras eliminar la evidencia de auditoría', { auditId: audit.id, storedName: existing.storedName, failed })
    }
    response.status(204).send()
  }))

  // ---- Acciones correctivas ----
  const findAccessibleAction = async (auditId: string, actionId: string) => {
    const parsed = idReference.safeParse(actionId)
    if (!parsed.success) return null
    return db.auditCorrectiveAction.findFirst({
      where: { id: parsed.data, finding: { auditId } },
      include: auditActionInclude,
    })
  }

  const listAuditActionsHandler = asyncHandler(async (request, response) => {
    const audit = await findAccessibleAudit(request, String(request.params.processId), String(request.params.auditId))
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const actions = await db.auditCorrectiveAction.findMany({
      where: { finding: { auditId: audit.id } },
      include: auditActionInclude,
      orderBy: [{ createdAt: 'asc' }],
    })
    response.json({ actions: actions.map(auditActionView) })
  })
  app.get('/api/audits/:auditId/actions', authMiddleware, withAuditProcessParam(listAuditActionsHandler))
  app.get('/api/processes/:processId/audits/:auditId/actions', authMiddleware, listAuditActionsHandler)

  const createAuditActionHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference, findingId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
      findingId: String(request.params.findingId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid finding id' })
      return
    }
    const parsed = auditCorrectiveActionCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid corrective action data', details: parsed.error.issues })
      return
    }
    const audit = await findAccessibleAudit(request, parsedIds.data.processId, parsedIds.data.auditId)
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const finding = await db.auditFinding.findFirst({
      where: { id: parsedIds.data.findingId, auditId: audit.id },
      select: { id: true, title: true, status: true },
    })
    if (!finding) {
      response.status(404).json({ error: 'Finding not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status) || finding.status === AuditFindingStatus.VERIFIED) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    const responsible = await resolveUserInCompany(parsed.data.responsibleId, audit.process.companyId, 'action responsible')
    if (!responsible.ok) {
      response.status(responsible.status).json({ error: responsible.error })
      return
    }
    const actor = auditActorOf(request)
    const action = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return null
      const created = await tx.auditCorrectiveAction.create({
        data: {
          findingId: finding.id,
          title: parsed.data.title,
          description: parsed.data.description,
          responsibleId: responsible.userId,
          priority: parsed.data.priority ?? 'MEDIUM',
          required: parsed.data.required ?? true,
          dueDate: parsed.data.dueDate || null,
        },
        include: auditActionInclude,
      })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'ACTION_CREATED',
        summary: `Acción correctiva «${created.title}» creada`,
        actor,
        changes: [
          { field: 'title', label: 'Título', previousValue: null, newValue: created.title },
          { field: 'required', label: 'Obligatoria', previousValue: null, newValue: String(created.required) },
        ],
        metadata: { findingId: finding.id, actionId: created.id },
      })
      return created
    })
    if (!action) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.status(201).json({ action: auditActionView(action) })
  })
  app.post('/api/audits/:auditId/findings/:findingId/actions', authMiddleware, userWriteGuard, withAuditProcessParam(createAuditActionHandler))
  app.post('/api/processes/:processId/audits/:auditId/findings/:findingId/actions', authMiddleware, userWriteGuard, createAuditActionHandler)

  const updateAuditActionHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference, actionId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
      actionId: String(request.params.actionId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid action id' })
      return
    }
    const parsed = auditCorrectiveActionUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid corrective action data', details: parsed.error.issues })
      return
    }
    const audit = await findAccessibleAudit(request, parsedIds.data.processId, parsedIds.data.auditId)
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const existing = await findAccessibleAction(audit.id, parsedIds.data.actionId)
    if (!existing) {
      response.status(404).json({ error: 'Corrective action not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    // Un estado final no se edita: el cambio de estado es la vía única de cerrar o cancelar.
    if (existing.status === AuditCorrectiveActionStatus.COMPLETED || existing.status === AuditCorrectiveActionStatus.CANCELLED) {
      response.status(409).json({ error: 'A completed or cancelled corrective action cannot be edited' })
      return
    }
    const data: Prisma.AuditCorrectiveActionUncheckedUpdateInput = {}
    const changes: RiskAuditChange[] = []
    if (parsed.data.title !== undefined && parsed.data.title !== existing.title) {
      data.title = parsed.data.title
      changes.push({ field: 'title', label: 'Título', previousValue: existing.title, newValue: parsed.data.title })
    }
    if (parsed.data.description !== undefined && parsed.data.description !== existing.description) {
      data.description = parsed.data.description
      changes.push({ field: 'description', label: 'Descripción', previousValue: existing.description, newValue: parsed.data.description })
    }
    if (parsed.data.priority !== undefined && parsed.data.priority !== existing.priority) {
      data.priority = parsed.data.priority
      changes.push({ field: 'priority', label: 'Prioridad', previousValue: existing.priority, newValue: parsed.data.priority })
    }
    if (parsed.data.required !== undefined && parsed.data.required !== existing.required) {
      data.required = parsed.data.required
      changes.push({ field: 'required', label: 'Obligatoria', previousValue: String(existing.required), newValue: String(parsed.data.required) })
    }
    if (parsed.data.dueDate !== undefined) {
      const nextDate = parsed.data.dueDate || null
      if (nextDate?.getTime() !== existing.dueDate?.getTime()) {
        data.dueDate = nextDate
        changes.push({ field: 'dueDate', label: 'Fecha límite', previousValue: auditValue(existing.dueDate), newValue: auditValue(nextDate) })
      }
    }
    if (parsed.data.responsibleId !== undefined) {
      const responsible = await resolveUserInCompany(parsed.data.responsibleId, audit.process.companyId, 'action responsible')
      if (!responsible.ok) {
        response.status(responsible.status).json({ error: responsible.error })
        return
      }
      if (responsible.userId !== existing.responsibleId) {
        data.responsibleId = responsible.userId
        const nextName = responsible.userId
          ? await db.user.findUnique({ where: { id: responsible.userId }, select: { name: true } }).then((user) => user?.name ?? null)
          : null
        changes.push({ field: 'responsibleId', label: 'Responsable', previousValue: existing.responsible?.name ?? null, newValue: nextName })
      }
    }
    if (changes.length === 0) {
      response.json({ action: auditActionView(existing) })
      return
    }
    const actor = auditActorOf(request)
    const action = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return null
      const updated = await tx.auditCorrectiveAction.update({ where: { id: existing.id }, data, include: auditActionInclude })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'ACTION_UPDATED',
        summary: `Acción correctiva «${updated.title}» actualizada`,
        actor,
        changes,
        metadata: { findingId: existing.findingId, actionId: updated.id },
      })
      return updated
    })
    if (!action) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.json({ action: auditActionView(action) })
  })
  app.patch('/api/audits/:auditId/actions/:actionId', authMiddleware, userWriteGuard, withAuditProcessParam(updateAuditActionHandler))
  app.patch('/api/processes/:processId/audits/:auditId/actions/:actionId', authMiddleware, userWriteGuard, updateAuditActionHandler)

  const changeAuditActionStatusHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference, actionId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
      actionId: String(request.params.actionId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid action id' })
      return
    }
    const parsed = auditCorrectiveActionStatusChangeSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid status change', details: parsed.error.issues })
      return
    }
    const audit = await findAccessibleAudit(request, parsedIds.data.processId, parsedIds.data.auditId)
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const existing = await findAccessibleAction(audit.id, parsedIds.data.actionId)
    if (!existing) {
      response.status(404).json({ error: 'Corrective action not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    if (!canTransitionAuditAction(existing.status, parsed.data.status)) {
      response.status(409).json({ error: 'Invalid corrective action status transition' })
      return
    }
    const data: Prisma.AuditCorrectiveActionUncheckedUpdateInput = { status: parsed.data.status }
    if (parsed.data.status === AuditCorrectiveActionStatus.COMPLETED) data.completedAt = new Date()
    if (parsed.data.status === AuditCorrectiveActionStatus.CANCELLED || parsed.data.status === AuditCorrectiveActionStatus.OPEN) data.completedAt = null
    const changes: RiskAuditChange[] = [
      { field: 'status', label: 'Estado de la acción', previousValue: existing.status, newValue: parsed.data.status },
    ]
    const actor = auditActorOf(request)
    const action = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return null
      const updated = await tx.auditCorrectiveAction.update({ where: { id: existing.id }, data, include: auditActionInclude })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'ACTION_STATUS_CHANGED',
        summary: `Acción correctiva «${updated.title}» ${auditActionStatusNames[parsed.data.status].toLowerCase()}`,
        actor,
        changes,
        metadata: { findingId: existing.findingId, actionId: updated.id, previousStatus: existing.status, newStatus: parsed.data.status },
      })
      return updated
    })
    if (!action) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.json({ action: auditActionView(action) })
  })
  app.post('/api/audits/:auditId/actions/:actionId/status', authMiddleware, userWriteGuard, withAuditProcessParam(changeAuditActionStatusHandler))
  app.post('/api/processes/:processId/audits/:auditId/actions/:actionId/status', authMiddleware, userWriteGuard, changeAuditActionStatusHandler)

  const addAuditActionProgressHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference, actionId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
      actionId: String(request.params.actionId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid action id' })
      return
    }
    const parsed = auditActionProgressCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid progress data', details: parsed.error.issues })
      return
    }
    const audit = await findAccessibleAudit(request, parsedIds.data.processId, parsedIds.data.auditId)
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const existing = await findAccessibleAction(audit.id, parsedIds.data.actionId)
    if (!existing) {
      response.status(404).json({ error: 'Corrective action not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    if (existing.status === AuditCorrectiveActionStatus.COMPLETED || existing.status === AuditCorrectiveActionStatus.CANCELLED) {
      response.status(409).json({ error: 'A completed or cancelled corrective action cannot receive progress' })
      return
    }
    const actor = auditActorOf(request)
    const entry = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return null
      const created = await tx.auditActionProgress.create({
        data: {
          actionId: existing.id,
          note: parsed.data.note,
          percent: parsed.data.percent ?? null,
          createdById: request.user?.id ?? null,
        },
        include: { createdBy: { select: { id: true, name: true } } },
      })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'ACTION_PROGRESS_ADDED',
        summary: `Avance registrado en «${existing.title}»`,
        actor,
        changes: [{ field: 'note', label: 'Avance', previousValue: null, newValue: created.note }],
        metadata: { findingId: existing.findingId, actionId: existing.id, progressId: created.id },
      })
      return created
    })
    if (!entry) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.status(201).json({ progress: auditActionProgressView(entry as never) })
  })
  app.post('/api/audits/:auditId/actions/:actionId/progress', authMiddleware, userWriteGuard, withAuditProcessParam(addAuditActionProgressHandler))
  app.post('/api/processes/:processId/audits/:auditId/actions/:actionId/progress', authMiddleware, userWriteGuard, addAuditActionProgressHandler)

  const deleteAuditActionHandler = asyncHandler(async (request, response) => {
    const parsedIds = z.object({ processId: idReference, auditId: idReference, actionId: idReference }).safeParse({
      processId: String(request.params.processId),
      auditId: String(request.params.auditId),
      actionId: String(request.params.actionId),
    })
    if (!parsedIds.success) {
      response.status(400).json({ error: 'Invalid action id' })
      return
    }
    const audit = await findAccessibleAudit(request, parsedIds.data.processId, parsedIds.data.auditId)
    if (!audit) {
      response.status(404).json({ error: 'Audit not found' })
      return
    }
    const existing = await findAccessibleAction(audit.id, parsedIds.data.actionId)
    if (!existing) {
      response.status(404).json({ error: 'Corrective action not found' })
      return
    }
    if (isTerminalAuditStatus(audit.status)) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    // Una acción con progreso no se borra: el historial de avances es la prueba del seguimiento.
    if (existing.progress.length > 0) {
      response.status(409).json({ error: 'The corrective action has progress entries; cancel it instead' })
      return
    }
    const actor = auditActorOf(request)
    const deleted = await db.$transaction(async (tx) => {
      const locked = await lockAuditForWrite(tx, audit.id)
      if (!locked) return false
      await tx.auditEvidenceFile.updateMany({ where: { actionId: existing.id }, data: { actionId: null } })
      await tx.auditCorrectiveAction.delete({ where: { id: existing.id } })
      await auditEventWrite(tx, {
        auditId: audit.id,
        eventType: 'ACTION_UPDATED',
        summary: `Acción correctiva «${existing.title}» eliminada`,
        actor,
        changes: [{ field: 'title', label: 'Título', previousValue: existing.title, newValue: null }],
        metadata: { findingId: existing.findingId, actionId: existing.id },
      })
      return true
    })
    if (!deleted) {
      response.status(409).json({ error: 'This audit is closed; no further changes are allowed' })
      return
    }
    response.status(204).send()
  })
  app.delete('/api/audits/:auditId/actions/:actionId', authMiddleware, userWriteGuard, withAuditProcessParam(deleteAuditActionHandler))
  app.delete('/api/processes/:processId/audits/:auditId/actions/:actionId', authMiddleware, userWriteGuard, deleteAuditActionHandler)

  app.post('/api/diagnostics/:id/swot/items', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = swotItemCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid SWOT item data', details: parsed.error.issues })
      return
    }
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } }, swotAnalysis: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    if (!diagnostic.swotAnalysis) {
      response.status(409).json({ error: 'Diagnostic SWOT analysis is unavailable' })
      return
    }
    const item = await db.sWOTItem.create({ data: { type: parsed.data.type, description: parsed.data.description, swotId: diagnostic.swotAnalysis.id }, include: swotItemAccessInclude })
    response.status(201).json({ item: swotItemView(item) })
  }))

  app.patch('/api/swot/items/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = swotItemUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid SWOT item data', details: parsed.error.issues })
      return
    }
    const existing = await db.sWOTItem.findUnique({ where: { id: String(request.params.id) }, include: swotItemAccessInclude })
    if (!existing || !canAccessCompany(request, existing.swot.diagnostic.company)) {
      response.status(404).json({ error: 'SWOT item not found' })
      return
    }
    const item = await db.sWOTItem.update({ where: { id: existing.id }, data: parsed.data, include: swotItemAccessInclude })
    response.json({ item: swotItemView(item) })
  }))

  app.delete('/api/swot/items/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const existing = await db.sWOTItem.findUnique({ where: { id: String(request.params.id) }, include: swotItemAccessInclude })
    if (!existing || !canAccessCompany(request, existing.swot.diagnostic.company)) {
      response.status(404).json({ error: 'SWOT item not found' })
      return
    }
    await db.sWOTItem.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  app.get('/api/diagnostics/:id/crosses', authMiddleware, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const crosses = await db.strategicCross.findMany({ where: { diagnosticId: diagnostic.id }, include: crossInclude, orderBy: { updatedAt: 'desc' } })
    response.json({ crosses: crosses.map(crossView) })
  }))

  app.post('/api/diagnostics/:id/crosses', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = crossCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid cross data', details: parsed.error.issues })
      return
    }
    const diagnostic = await db.qualityDiagnostic.findUnique({
      where: { id: String(request.params.id) },
      include: { company: { select: { id: true } }, swotAnalysis: { include: { items: { select: { id: true, type: true, description: true } } } } },
    })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    if (!diagnostic.swotAnalysis) {
      response.status(409).json({ error: 'Diagnostic SWOT analysis is unavailable' })
      return
    }
    const items = diagnostic.swotAnalysis.items
    const factor1 = items.find((item) => item.id === parsed.data.factor1Id)
    const factor2 = items.find((item) => item.id === parsed.data.factor2Id)
    if (!factor1 || !factor2) {
      response.status(400).json({ error: 'Both factors must belong to this diagnostic' })
      return
    }
    if (factor1.id === factor2.id) {
      response.status(400).json({ error: 'Factors must be different' })
      return
    }
    const crossType = crossTypeFor(factor1.type, factor2.type)
    if (!crossType) {
      response.status(400).json({ error: 'These factors do not form a valid strategic cross (FO, DO, FA or DA)' })
      return
    }
    const internal = factor1.type === 'STRENGTH' || factor1.type === 'WEAKNESS' ? factor1 : factor2
    const external = internal.id === factor1.id ? factor2 : factor1
    const existing = await db.strategicCross.findUnique({ where: { factor1Id_factor2Id: { factor1Id: internal.id, factor2Id: external.id } } })
    if (existing) {
      response.status(409).json({ error: 'A strategic cross between these factors already exists' })
      return
    }
    const cross = await db.strategicCross.create({
      data: { diagnosticId: diagnostic.id, crossType: crossType as CrossType, origin: 'USER', factor1Id: internal.id, factor2Id: external.id, strategy: parsed.data.strategy ? sanitizeTextWithSwotItems(parsed.data.strategy, items) : null, createdById: request.user!.id },
      include: crossInclude,
    })
    response.status(201).json({ cross: crossView(cross) })
  }))

  // Acceso a un cruce por id con el mismo aislamiento multiempresa del resto de la API: si el cruce
  // no existe o pertenece a otra empresa la respuesta es 404 y no revela nada más.
  const crossForRequest = async (request: Request, crossId: string) => {
    const cross = await db.strategicCross.findUnique({ where: { id: crossId }, include: { diagnostic: { include: { company: { select: { id: true } } } } } })
    if (!cross || !canAccessCompany(request, cross.diagnostic.company)) return null
    return cross
  }

  app.patch('/api/crosses/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = crossUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid cross data', details: parsed.error.issues })
      return
    }
    const existing = await crossForRequest(request, String(request.params.id))
    if (!existing) {
      response.status(404).json({ error: 'Cross not found' })
      return
    }
    const factors = await db.sWOTItem.findMany({ where: { id: { in: [existing.factor1Id, existing.factor2Id] }, swot: { diagnosticId: existing.diagnosticId } }, select: { id: true, description: true } })
    // Decidir la estrategia de un cruce que no tiene ninguna no tiene lectura: no hay texto que
    // aceptar ni que Ponderación pueda recoger después.
    if (parsed.data.strategyStatus !== undefined && !(parsed.data.strategy ?? existing.strategy)?.trim()) {
      response.status(400).json({ error: 'This strategic cross has no strategy to decide on' })
      return
    }
    const data = parsed.data.strategy === undefined
      ? parsed.data
      : { ...parsed.data, strategy: sanitizeTextWithSwotItems(parsed.data.strategy, factors) }
    const cross = await db.strategicCross.update({ where: { id: existing.id }, data, include: crossInclude })
    response.json({ cross: crossView(cross) })
  }))

  app.delete('/api/crosses/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const existing = await crossForRequest(request, String(request.params.id))
    if (!existing) {
      response.status(404).json({ error: 'Cross not found' })
      return
    }
    await db.strategicCross.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  app.put('/api/crosses/:id/weighting', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = crossWeightingSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid weighting data', details: parsed.error.issues })
      return
    }
    const cross = await crossForRequest(request, String(request.params.id))
    if (!cross) {
      response.status(404).json({ error: 'Cross not found' })
      return
    }
    if (!cross.strategy) {
      response.status(400).json({ error: 'This strategic cross has no strategy to evaluate' })
      return
    }
    // El ponderado se calcula aquí y no se lee del cuerpo: el cliente solo elige niveles.
    const weightedScore = calculateWeightedScore(parsed.data)
    const weighting = await db.strategicCrossWeighting.upsert({
      where: { crossId: cross.id },
      create: { crossId: cross.id, ...parsed.data, weightedScore, createdById: request.user!.id },
      update: { ...parsed.data, weightedScore },
    })
    response.json({ weighting: weightingView(weighting) })
  }))

  app.get('/api/crosses/:id/weighting', authMiddleware, asyncHandler(async (request, response) => {
    const cross = await crossForRequest(request, String(request.params.id))
    if (!cross) {
      response.status(404).json({ error: 'Cross not found' })
      return
    }
    const weighting = await db.strategicCrossWeighting.findUnique({ where: { crossId: cross.id } })
    if (!weighting) {
      response.status(404).json({ error: 'This strategic cross has no weighting yet' })
      return
    }
    response.json({ weighting: weightingView(weighting) })
  }))

  app.get('/api/diagnostics/:id/weightings', authMiddleware, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const weightings = await db.strategicCrossWeighting.findMany({
      where: { cross: { diagnosticId: diagnostic.id } },
      orderBy: [{ weightedScore: 'desc' }, { createdAt: 'asc' }],
    })
    response.json({ weightings: weightings.map(weightingView) })
  }))

  /**
   * Estrategias consolidadas para la priorización. Ponderación envía acceptedOnly=true para recibir
   * únicamente las estrategias aceptadas en Checky; la lectura por defecto conserva las tres fuentes.
   */
  app.get('/api/diagnostics/:id/strategies', authMiddleware, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const strategies = await loadDiagnosticStrategies(db, diagnostic.id, request.query.acceptedOnly === 'true')
    const items = await db.sWOTItem.findMany({ where: { swot: { diagnosticId: diagnostic.id } }, select: { id: true, description: true } })
    response.json({
      strategies: strategies.map((strategy) => sanitizedStrategyView(strategy, items)),
      weightingLevels: WEIGHTING_LEVEL_SCORE,
    })
  }))

  /**
   * Pondera una estrategia consolidada que no es un cruce, sin convertirla en uno. Los cruces
   * siguen pesándose en PUT /api/crosses/:id/weighting contra StrategicCrossWeighting; esta ruta solo
   * cubre AI_ANALYSIS y CHECKY, y no toca ninguna de las dos tablas existentes.
   *
   * El ancla no se confía: se revalida aquí contra la consolidación real de este diagnóstico. El
   * sourceRef que llega es el hash del texto, y el servidor vuelve a consolidar para comprobar que ese
   * texto existe y que su fuente es la que el cliente dice. Un sourceRef inventado, o de otro
   * diagnóstico o de otra empresa, no encuentra estrategia y se responde 404 en vez de guardarse.
   * El ponderado se calcula en el servidor: el cuerpo solo trae los cinco niveles.
   */
  app.put('/api/diagnostics/:id/strategies/weighting', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const parsed = strategyWeightingSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid weighting data', details: parsed.error.issues })
      return
    }
    const { source, sourceRef, ...criteria } = parsed.data

    // Una estrategia CHECKY aceptada puede compartir texto con un cruce DOFA creado desde
    // MISSING_CROSSES. Para validar el origen que el cliente pondera hay que usar la proyección de
    // aceptaciones Checky; las estrategias IA y los cruces conservan la consolidación normal.
    const strategies = await loadDiagnosticStrategies(db, diagnostic.id, source === 'CHECKY')
    const matches = strategies.filter((strategy) => strategySourceRef(strategy.description) === sourceRef)
    if (matches.length === 0) {
      response.status(404).json({ error: 'Strategy not found' })
      return
    }
    // El mismo texto puede haber llegado desde más de una fuente, pero en la lista consolidada solo
    // gana una: la que la deduplicación dejó. Pesar con otra fuente significaría atribuir a una
    // estrategia un valor que el usuario no vio en su fuente.
    const strategy = matches.find((candidate) => candidate.source === source)
    if (!strategy) {
      response.status(400).json({ error: `This strategy belongs to ${matches[0].source}, not to ${source}` })
      return
    }

    // La estrategia de un cruce se valora en su propia tabla, la misma que usa la Matriz DOFA:
    // StrategicCrossWeighting es la única ponderación que tiene el cruce, así que esta pantalla y la
    // matriz leen y escriben el mismo valor sin duplicar filas ni estados.
    if (source === 'STRATEGIC_CROSS') {
      if (!strategy.crossId) {
        response.status(404).json({ error: 'Strategy not found' })
        return
      }
      const weightedScore = calculateWeightedScore(criteria)
      const weighting = await db.strategicCrossWeighting.upsert({
        where: { crossId: strategy.crossId },
        create: { crossId: strategy.crossId, ...criteria, weightedScore, createdById: request.user!.id },
        update: { ...criteria, weightedScore },
      })
      response.json({ weighting: { source, sourceRef, ...strategyWeightingView(weighting) } })
      return
    }

    const weighting = await db.strategyWeighting.upsert({
      where: { diagnosticId_source_sourceRef: { diagnosticId: diagnostic.id, source, sourceRef } },
      create: { diagnosticId: diagnostic.id, source, sourceRef, ...strategyWeightingUpsertData(criteria, request.user!.id) },
      update: strategyWeightingUpsertData(criteria, request.user!.id),
    })
    response.json({ weighting: { source: weighting.source, sourceRef: weighting.sourceRef, ...strategyWeightingView(weighting) } })
  }))

  app.post('/api/diagnostics/:id/crosses/generate', authMiddleware, userWriteGuard, aiAnalysisLimiter, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: diagnosticInclude })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const items = diagnostic.swotAnalysis?.items ?? []
    if (items.length === 0) {
      response.status(400).json({ error: 'Add at least one SWOT factor before generating crosses' })
      return
    }
    let generated: GeneratedCrossForAI[]
    try {
      generated = await aiService.generateCrosses(items.map((item) => ({ id: item.id, type: item.type, description: item.description })))
    } catch (error) {
      if (error instanceof AIServiceError) {
        response.status(error.code === 'NOT_CONFIGURED' ? 503 : 502).json({ error: error.code === 'NOT_CONFIGURED' ? 'AI analysis is not configured' : 'AI returned an invalid analysis' })
        return
      }
      throw error
    }
    const existingCrosses = await db.strategicCross.findMany({ where: { diagnosticId: diagnostic.id }, select: { id: true, factor1Id: true, factor2Id: true, origin: true, strategy: true } })
    const existingByPair = new Map(existingCrosses.map((existing) => [`${existing.factor1Id}:${existing.factor2Id}`, existing]))
    const typeById = new Map(items.map((item) => [item.id, item.type]))
    const seenPairs = new Set<string>()
    for (const cross of generated) {
      const type1 = typeById.get(cross.factor1Id)
      const ordered = type1 === 'STRENGTH' || type1 === 'WEAKNESS' ? { factor1Id: cross.factor1Id, factor2Id: cross.factor2Id } : { factor1Id: cross.factor2Id, factor2Id: cross.factor1Id }
      const pairKey = `${ordered.factor1Id}:${ordered.factor2Id}`
      if (seenPairs.has(pairKey)) continue
      seenPairs.add(pairKey)
      const existing = existingByPair.get(pairKey)
      if (existing) {
        if (existing.origin !== 'BOTH' || !existing.strategy) {
          await db.strategicCross.update({ where: { id: existing.id }, data: { origin: 'BOTH', strategy: existing.strategy ?? sanitizeTextWithSwotItems(cross.strategy, items) } })
        }
        continue
      }
      await db.strategicCross.create({ data: { diagnosticId: diagnostic.id, crossType: cross.type, origin: 'AI', factor1Id: ordered.factor1Id, factor2Id: ordered.factor2Id, strategy: sanitizeTextWithSwotItems(cross.strategy, items), createdById: request.user!.id } })
    }
    const crosses = await db.strategicCross.findMany({ where: { diagnosticId: diagnostic.id }, include: crossInclude, orderBy: { updatedAt: 'desc' } })
    response.json({ crosses: crosses.map(crossView) })
  }))

  app.post('/api/diagnostics/:id/crosses/analyze', authMiddleware, userWriteGuard, aiAnalysisLimiter, asyncHandler(async (request, response) => {
    const parsed = crossAnalyzeSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid cross analysis request', details: parsed.error.issues })
      return
    }
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const where: Prisma.StrategicCrossWhereInput = { diagnosticId: diagnostic.id }
    if (parsed.data?.crosses) where.id = { in: parsed.data.crosses }
    if (parsed.data?.origin) where.origin = parsed.data.origin as CrossOrigin
    const crosses = await db.strategicCross.findMany({ where, include: crossInclude, orderBy: { updatedAt: 'desc' } })
    if (crosses.length === 0) {
      response.status(400).json({ error: 'There are no crosses to analyze yet' })
      return
    }
    let analyses: Array<{ crossId: string; analysis: CrossAnalysisResult }>
    try {
      analyses = await aiService.analyzeCrosses(crosses.map((cross) => ({ id: cross.id, type: cross.crossType, origin: cross.origin, strategy: cross.strategy, factor1: { type: cross.factor1.type, description: cross.factor1.description }, factor2: { type: cross.factor2.type, description: cross.factor2.description } })))
    } catch (error) {
      if (error instanceof AIServiceError) {
        response.status(error.code === 'NOT_CONFIGURED' ? 503 : 502).json({ error: error.code === 'NOT_CONFIGURED' ? 'AI analysis is not configured' : 'AI returned an invalid analysis' })
        return
      }
      throw error
    }
    await Promise.all(analyses.map(async (entry) => {
      const cross = crosses.find((item) => item.id === entry.crossId)
      if (!cross) return
      const analysis = sanitizeCrossAnalysis(entry.analysis, [cross.factor1, cross.factor2])
      await db.strategicCross.update({ where: { id: cross.id }, data: { aiAnalysis: analysis, priority: analysis.priority } })
    }))
    const updated = await db.strategicCross.findMany({ where: { diagnosticId: diagnostic.id }, include: crossInclude, orderBy: { updatedAt: 'desc' } })
    response.json({ crosses: updated.map(crossView) })
  }))

  /**
   * Lectura estratégica de un diagnóstico, generada y guardada en AIAnalysis.
   *
   * No es un servicio nuevo: es la misma operación que expone POST /diagnostics/:id/ai-analysis,
   * movida aquí para que la consulta de Checky pueda reutilizarla al orquestar su propio análisis en
   * lugar de dejarle al usuario un segundo paso que ejecutar. Recibe el diagnóstico ya cargado y ya
   * autorizado por la ruta que la llama, así que no repite ni la consulta ni la comprobación de
   * empresa: cada ruta sigue decidiendo qué diagnóstico puede tocar.
   *
   * El error del proveedor sube tal cual: cada ruta lo traduce a su propio mensaje, porque "el
   * análisis no está configurado" y "Checky no está configurado" son el mismo fallo visto desde dos
   * pantallas.
   */
  const generateDiagnosticAnalysis = async (diagnostic: { id: string; title: string; description: string; status: string; swotAnalysis?: { items: Array<{ id: string; type: string; description: string }> } | null }) => {
    const items = diagnostic.swotAnalysis?.items ?? []
    // Al modelo solo va lo que le sirve para analizar: el id, para poder citarlo, el tipo y la
    // descripción. Las columnas de la fila (`swotId`, `createdAt`) no se cuelan en el prompt.
    const swotItems = items.map((item) => ({ id: item.id, type: item.type, description: item.description }))
    const result = sanitizeAIAnalysisResult(await aiService.analyze({
      title: diagnostic.title,
      description: diagnostic.description,
      status: diagnostic.status,
      swotItems,
    }), swotItems)
    // La huella se guarda junto a la lectura, no se deduce de fechas: es lo que permite que la
    // próxima consulta a Checky sepa si lo que ya está guardado describe la matriz de hoy o una
    // anterior. Sin ella, editar un factor dejaría en pantalla una lectura vieja como si fuera actual.
    return db.aIAnalysis.upsert({
      where: { diagnosticId: diagnostic.id },
      create: { diagnosticId: diagnostic.id, ...result, swotFingerprint: swotFingerprint(items) },
      update: { ...result, swotFingerprint: swotFingerprint(items) },
    })
  }

  app.post('/api/diagnostics/:id/ai-analysis', authMiddleware, userWriteGuard, aiAnalysisLimiter, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: diagnosticInclude })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    let analysis
    try {
      analysis = await generateDiagnosticAnalysis(diagnostic)
    } catch (error) {
      if (error instanceof AIServiceError) {
        if (error.code === 'NOT_CONFIGURED') {
          response.status(503).json({ error: 'AI analysis is not configured' })
          return
        }
        if (error.code === 'INVALID_RESPONSE') {
          response.status(502).json({ error: 'AI returned an invalid analysis' })
          return
        }
        response.status(502).json({ error: 'AI analysis is temporarily unavailable' })
        return
      }
      throw error
    }
    const items = diagnostic.swotAnalysis?.items ?? []
    response.json({ analysis: aiAnalysisView(analysis, items, swotFingerprint(items)) })
  }))

  app.get('/api/diagnostics/:id/ai-analysis', authMiddleware, asyncHandler(async (request, response) => {
    // Los factores entran en la consulta porque la vista tiene que resolver la evidencia de cada
    // inferencia contra la matriz actual y, con ella, decir si la lectura guardada quedó atrás. Sin
    // ellos solo se podría devolver el análisis tal cual, y no se podría saber si sigue vigente.
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } }, swotAnalysis: { include: { items: { orderBy: { createdAt: 'asc' } } } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const analysis = await db.aIAnalysis.findUnique({ where: { diagnosticId: diagnostic.id } })
    const items = diagnostic.swotAnalysis?.items ?? []
    // Un diagnóstico al que el usuario acaba de llenar la matriz todavía no tiene lectura estratégica,
    // y eso no es un error: es el estado normal en el que Checky espera a que le pulsen "Analizar con
    // Checky". Por eso la respuesta es 200 con `analysis` en null en vez de un 404.
    //
    // La diferencia importa porque antes las dos cosas devolvían el mismo 404 y el cliente no tenía
    // forma de saber cuál había recibido: para no ensuciar la pantalla con un error en el caso
    // normal tenía que tragarse también el 404 de verdad, que es el de un diagnóstico inexistente o
    // de otra empresa. Ahora el 404 queda para lo que sí es un problema, y la ausencia de análisis se
    // dice con lo que es: un null.
    response.json({ analysis: analysis ? aiAnalysisView(analysis, items, swotFingerprint(items)) : null })
  }))

  app.get('/api/diagnostics/:id/recommendations', authMiddleware, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const recommendations = await db.recommendation.findMany({ where: { diagnosticId: diagnostic.id }, orderBy: { createdAt: 'desc' } })
    const items = await db.sWOTItem.findMany({ where: { swot: { diagnosticId: diagnostic.id } }, select: { id: true, description: true } })
    response.json({ recommendations: recommendations.map((recommendation) => sanitizedRecommendationView(recommendation, items)) })
  }))

  app.post('/api/diagnostics/:id/recommendations/import', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const analysis = await db.aIAnalysis.findUnique({ where: { diagnosticId: diagnostic.id } })
    if (!analysis) {
      response.status(404).json({ error: 'AI analysis not found' })
      return
    }
    const items = await db.sWOTItem.findMany({ where: { swot: { diagnosticId: diagnostic.id } }, select: { id: true, description: true } })
    const parsedAnalysis = aiAnalysisSchema.parse({ executiveSummary: analysis.executiveSummary, diagnosis: analysis.diagnosis, keyFindings: analysis.keyFindings, foStrategies: analysis.foStrategies, doStrategies: analysis.doStrategies, faStrategies: analysis.faStrategies, daStrategies: analysis.daStrategies, priorityRisks: analysis.priorityRisks, priorityOpportunities: analysis.priorityOpportunities, recommendations: analysis.recommendations })
    const aiRecommendations = sanitizeAIAnalysisResult(parsedAnalysis, items).recommendations
    const existing = await db.recommendation.findMany({ where: { diagnosticId: diagnostic.id }, select: { title: true } })
    const existingTitles = new Set(existing.map((item) => item.title))
    const toImport = aiRecommendations.filter((recommendation) => !existingTitles.has(recommendation.title))
    const imported = await Promise.all(toImport.map((recommendation) => db.recommendation.create({ data: { diagnosticId: diagnostic.id, ...recommendation } })))
    response.json({ imported: imported.map(recommendationView), skipped: aiRecommendations.length - imported.length })
  }))

  app.patch('/api/recommendations/:id', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = recommendationUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid recommendation data', details: parsed.error.issues })
      return
    }
    const existing = await db.recommendation.findUnique({ where: { id: String(request.params.id) }, include: { diagnostic: { include: { company: { select: { id: true } } } } } })
    if (!existing || !canAccessCompany(request, existing.diagnostic.company)) {
      response.status(404).json({ error: 'Recommendation not found' })
      return
    }
    const recommendation = await db.recommendation.update({ where: { id: existing.id }, data: parsed.data })
    response.json({ recommendation: recommendationView(recommendation) })
  }))

  class CheckyCrossConflictError extends Error {}

const checkySessionForRequest = async (request: Request, sessionId: string) => {
    const session = await db.checkySession.findUnique({ where: { id: sessionId }, include: { diagnostic: { include: { company: { select: { id: true } } } } } })
    if (!session || !canAccessCompany(request, session.diagnostic.company)) return null
    return session
  }

  app.post('/api/diagnostics/:id/checky/sessions', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = checkySessionCreateSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid Checky session data', details: parsed.error.issues })
      return
    }
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const session = await db.checkySession.create({ data: { diagnosticId: diagnostic.id, title: parsed.data.title ?? null, createdById: request.user!.id } })
    response.status(201).json({ session: checkySessionView(session) })
  }))

  app.get('/api/diagnostics/:id/checky/sessions', authMiddleware, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const sessions = await db.checkySession.findMany({ where: { diagnosticId: diagnostic.id }, orderBy: { createdAt: 'desc' } })
    response.json({ sessions: sessions.map(checkySessionView) })
  }))

  app.get('/api/checky/sessions/:sessionId', authMiddleware, asyncHandler(async (request, response) => {
    const session = await checkySessionForRequest(request, String(request.params.sessionId))
    if (!session) {
      response.status(404).json({ error: 'Checky session not found' })
      return
    }
    const messages = await db.checkyMessage.findMany({ where: { sessionId: session.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
    const items = await db.sWOTItem.findMany({ where: { swot: { diagnosticId: session.diagnosticId } }, select: { id: true, type: true, description: true } })
    const crosses = await db.strategicCross.findMany({ where: { diagnosticId: session.diagnosticId }, select: { id: true, factor1Id: true, factor2Id: true } })
    // La lectura vuelve a aplicar la regla: una sugerencia que pretende ser estrategia sin pareja
    // DOFA válida no se muestra, aunque exista en la tabla por un registro anterior o de otro flujo.
    const visibleMessages = visibleCheckyMessages(messages, items, crosses)
    response.json({ session: checkySessionView(session), messages: visibleMessages.map((message) => checkyMessageView(message, items)) })
  }))

  app.post('/api/checky/sessions/:sessionId/messages', authMiddleware, userWriteGuard, checkyLimiter, asyncHandler(async (request, response) => {
    const parsed = checkyMessageCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid Checky message', details: parsed.error.issues })
      return
    }
    const session = await checkySessionForRequest(request, String(request.params.sessionId))
    if (!session) {
      response.status(404).json({ error: 'Checky session not found' })
      return
    }
    const userMessage = await db.checkyMessage.create({ data: { sessionId: session.id, role: 'USER', content: parsed.data.content, evidenceIds: [], missingInformation: [] } })
    // Checky orquesta su propio análisis: si el diagnóstico no tiene una lectura estratégica que
    // describa la matriz de hoy, la genera aquí antes de consultar, para que el usuario ejecute un
    // único análisis y no dos. Es la misma lectura que expone POST /diagnostics/:id/ai-analysis,
    // escrita en la misma tabla, así que la priorización y las recomendaciones siguen leyéndola desde
    // donde ya lo hacían.
    //
    // "Que describa la matriz de hoy" es la condición, no "que exista". Se compara la huella guardada
    // con la de los factores actuales: si el usuario editó, agregó o borró un factor después del
    // análisis, reutilizar el guardado sería mostrarle como vigente una lectura de otra versión de
    // su diagnóstico, y eso es justo lo que no debe pasar sin avisar. Cuando no hay huella
    // guardada —los análisis anteriores a esta columna— la comparación tampoco se puede hacer, así que
    // se regeneran: no se puede dar por bueno un análisis del que se desconoce la matriz que leyó.
    //
    // El diagnóstico se carga con la misma empresa que ya autorizó la sesión, de modo que el análisis
    // nunca puede generarse sobre un diagnóstico ajeno.
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: session.diagnosticId }, include: { ...diagnosticInclude, company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const items = diagnostic.swotAnalysis?.items ?? []
    const stored = await db.aIAnalysis.findUnique({ where: { diagnosticId: session.diagnosticId }, select: { swotFingerprint: true } })
    if (!stored || stored.swotFingerprint !== swotFingerprint(items)) {
      try {
        await generateDiagnosticAnalysis(diagnostic)
      } catch (error) {
        if (error instanceof AIServiceError) {
          response.status(error.code === 'NOT_CONFIGURED' ? 503 : 502).json({ error: error.code === 'NOT_CONFIGURED' ? 'Checky is not configured' : 'Checky returned an invalid analysis' })
          return
        }
        throw error
      }
    }
    const context = await buildCheckyContext(db, session.diagnostic, parsed.data.content)
    let result: CheckyConsultResult
    try {
      result = await aiService.consultChecky(context)
    } catch (error) {
      if (error instanceof AIServiceError) {
        response.status(error.code === 'NOT_CONFIGURED' ? 503 : 502).json({ error: error.code === 'NOT_CONFIGURED' ? 'Checky is not configured' : 'Checky returned an invalid analysis' })
        return
      }
      throw error
    }
    const safeResult = sanitizeCheckyResult(result, context)
    // Solo se persisten las sugerencias con una pareja DOFA válida: las demás no son estrategias
    // y no deben llegar ni a Checky ni a Ponderación.
    const usableFindings = await usableCheckyFindings(db, session.diagnosticId, safeResult.findings, context.crosses)
    const reply = await db.checkyMessage.create({ data: { sessionId: session.id, role: 'CHECKY', content: safeResult.reply, insufficientData: safeResult.insufficientData, missingInformation: safeResult.missingInformation, evidenceIds: [] } })
    const suggestions = []
    for (const finding of usableFindings) {
      suggestions.push(await db.checkyMessage.create({ data: { sessionId: session.id, role: 'CHECKY', content: `${finding.title}\n${finding.detail}`, category: finding.category as CheckyCategory, basis: finding.basis as CheckyFindingBasis, evidenceIds: finding.evidenceIds, suggestedStrategyTitle: finding.suggestedStrategy?.title ?? null, suggestedStrategyDescription: finding.suggestedStrategy?.description ?? null, status: 'PENDING' } }))
    }
    const messages = await db.checkyMessage.findMany({ where: { sessionId: session.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
    // El historial de la sesión se devuelve con la misma regla que el GET: lo que no tiene pareja
    // DOFA válida no vuelve a aparecer ni siquiera en la respuesta de esta consulta.
    const factors = await db.sWOTItem.findMany({ where: { swot: { diagnosticId: session.diagnosticId } }, select: { id: true, type: true, description: true } })
    const sessionCrosses = await db.strategicCross.findMany({ where: { diagnosticId: session.diagnosticId }, select: { id: true, factor1Id: true, factor2Id: true } })
    const visibleMessages = visibleCheckyMessages(messages, factors, sessionCrosses)
    response.status(201).json({ userMessage: checkyMessageView(userMessage), reply: checkyMessageView(reply, context.swotItems), suggestions: suggestions.map((message) => checkyMessageView(message, context.swotItems)), messages: visibleMessages.map((message) => checkyMessageView(message, context.swotItems)) })
  }))

  app.patch('/api/checky/sessions/:sessionId/messages/:messageId', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const parsed = checkySuggestionDecisionSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid Checky decision', details: parsed.error.issues })
      return
    }
    const session = await checkySessionForRequest(request, String(request.params.sessionId))
    if (!session) {
      response.status(404).json({ error: 'Checky session not found' })
      return
    }
    const existing = await db.checkyMessage.findUnique({ where: { id: String(request.params.messageId) } })
    if (!existing || existing.sessionId !== session.id) {
      response.status(404).json({ error: 'Checky message not found' })
      return
    }
    if (existing.role !== 'CHECKY' || !existing.category) {
      response.status(400).json({ error: 'Only Checky suggestions can be accepted or rejected' })
      return
    }
    if (existing.status && existing.status !== 'PENDING') {
      response.status(409).json({ error: 'This suggestion was already decided' })
      return
    }
    if (parsed.data.status === 'ACCEPTED' && existing.category === 'MISSING_CROSSES') {
      response.status(400).json({ error: 'Accept this missing cross through POST /api/checky/suggestions/:messageId/accept so the strategic cross is created' })
      return
    }
    // Aceptar es lo que habilita Ponderación, así que solo se acepta una sugerencia de estrategia
    // con una pareja DOFA válida detrás. Rechazar sigue estando permitido sin comprobar nada: no
    // crea estrategia. Los factores se leen acotados a este diagnóstico, igual que en la aceptación.
    if (parsed.data.status === 'ACCEPTED' && requiresCheckyCrossPair(existing)) {
      const crosses = await db.strategicCross.findMany({ where: { diagnosticId: session.diagnosticId }, select: { id: true, factor1Id: true, factor2Id: true } })
      const ids = [...new Set([...existing.evidenceIds, ...crosses.flatMap((cross) => [cross.factor1Id, cross.factor2Id])])]
      const factors = ids.length > 0
        ? await db.sWOTItem.findMany({ where: { id: { in: ids }, swot: { diagnosticId: session.diagnosticId } }, select: { id: true, type: true, description: true } })
        : []
      if (!resolveCheckyCrossPair(existing, factors, crosses)) {
        response.status(400).json({ error: 'This suggestion does not reference a valid DOFA cross (FO, FA, DO or DA)' })
        return
      }
    }
    const updated = await db.checkyMessage.update({ where: { id: existing.id }, data: { status: parsed.data.status, decisionNote: parsed.data.decisionNote ?? null } })
    const items = await db.sWOTItem.findMany({ where: { swot: { diagnosticId: session.diagnosticId } }, select: { id: true, description: true } })
    response.json({ message: checkyMessageView(updated, items) })
  }))

  app.post('/api/checky/suggestions/:messageId/accept', authMiddleware, userWriteGuard, asyncHandler(async (request, response) => {
    const message = await db.checkyMessage.findUnique({ where: { id: String(request.params.messageId) } })
    if (!message) {
      response.status(404).json({ error: 'Checky message not found' })
      return
    }
    const session = await checkySessionForRequest(request, message.sessionId)
    if (!session) {
      response.status(404).json({ error: 'Checky message not found' })
      return
    }
    if (message.role !== 'CHECKY' || !message.category) {
      response.status(400).json({ error: 'Only Checky suggestions can be accepted' })
      return
    }
    if (message.category !== 'MISSING_CROSSES') {
      response.status(400).json({ error: 'Only a missing cross suggestion can create a strategic cross' })
      return
    }
    if (message.status && message.status !== 'PENDING') {
      response.status(409).json({ error: 'This suggestion was already decided' })
      return
    }
    // The evidence ids come from the model, so they are only ever used to look up factors that
    // belong to this diagnostic. The diagnostic filter lives in the query, so an id from another
    // diagnostic or company is never loaded and can never reach the StrategicCross. If the evidence
    // cites a cross instead of its two factors, those factors are added to the lookup: the pair can
    // be written either way, and the resolution follows the same A → E order as write and read.
    const crossRows = await db.strategicCross.findMany({ where: { diagnosticId: session.diagnosticId }, include: crossInclude })
    const crossRefs: CheckyCrossRef[] = crossRows.map((cross) => ({ id: cross.id, factor1Id: cross.factor1Id, factor2Id: cross.factor2Id }))
    const lookupIds = [
      ...new Set([
        ...message.evidenceIds,
        ...crossRefs.filter((cross) => message.evidenceIds.includes(cross.id)).flatMap((cross) => [cross.factor1Id, cross.factor2Id]),
      ]),
    ]
    const factors = lookupIds.length > 0
      ? await db.sWOTItem.findMany({
          where: { id: { in: lookupIds }, swot: { diagnosticId: session.diagnosticId } },
          select: { id: true, type: true, description: true },
          orderBy: { createdAt: 'asc' },
        })
      : []
    const pair = resolveCheckyCrossPair(message, factors, crossRefs)
    if (!pair) {
      const citedFactors = new Set(message.evidenceIds.filter((id) => factors.some((factor) => factor.id === id)))
      response.status(400).json({
        error: citedFactors.size === 2
          ? 'These factors do not form a valid strategic cross (FO, DO, FA or DA)'
          : 'A missing cross suggestion must cite exactly two factors of this diagnostic',
      })
      return
    }
    // La Matriz DOFA es la fuente de verdad: si la pareja ya es un StrategicCross, aceptar se apoya
    // en ese cruce y no crea otro. La interpretación de Checky queda registrada en la propia
    // sugerencia, de modo que las dos conviven y ambas siguen llegando a Ponderación.
    const reusedCross = pair.crossId ? crossRows.find((cross) => cross.id === pair.crossId) : undefined
    if (reusedCross) {
      const suggestion = await db.checkyMessage.update({
        where: { id: message.id },
        data: { status: 'ACCEPTED', evidenceIds: checkyEvidenceWithPair(message.evidenceIds, pair) },
      })
      response.status(201).json({ suggestion: checkyMessageView(suggestion, factors), cross: crossView(reusedCross) })
      return
    }
    const internal = pair.factor1
    const external = pair.factor2
    const crossType = pair.crossType
    // La estrategia llega estructurada desde la consulta de Checky, nunca se extrae del texto.
    const strategy = message.suggestedStrategyDescription === null
      ? null
      : sanitizeTextWithSwotItems(message.suggestedStrategyDescription, factors)
    let created: { cross: Prisma.StrategicCrossGetPayload<{ include: typeof crossInclude }>; suggestion: ReturnType<typeof checkyMessageView> }
    try {
      created = await db.$transaction(async (tx) => {
        // Re-checked inside the transaction so a cross created concurrently cannot slip through.
        const duplicate = await tx.strategicCross.findUnique({ where: { factor1Id_factor2Id: { factor1Id: internal.id, factor2Id: external.id } } })
        if (duplicate) throw new CheckyCrossConflictError()
        const cross = await tx.strategicCross.create({
          data: { diagnosticId: session.diagnosticId, crossType: crossType as CrossType, origin: CrossOrigin.AI, factor1Id: internal.id, factor2Id: external.id, strategy, createdById: request.user!.id },
          include: crossInclude,
        })
        const suggestion = await tx.checkyMessage.update({ where: { id: message.id }, data: { status: 'ACCEPTED' } })
        return { cross, suggestion }
      })
    } catch (error) {
      if (error instanceof CheckyCrossConflictError) {
        response.status(409).json({ error: 'A strategic cross between these factors already exists' })
        return
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        response.status(409).json({ error: 'A strategic cross between these factors already exists' })
        return
      }
      response.status(500).json({ error: 'The strategic cross could not be created' })
      return
    }
    response.status(201).json({ suggestion: checkyMessageView(created.suggestion, factors), cross: crossView(created.cross) })
  }))

  app.get('/api/diagnostics/:id/action-plans', authMiddleware, asyncHandler(async (request, response) => {
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const actionPlans = await db.actionPlan.findMany({ where: { diagnosticId: diagnostic.id }, include: actionPlanInclude, orderBy: { updatedAt: 'desc' } })
    response.json({ actionPlans: actionPlans.map(actionPlanView) })
  }))

  /**
   * El vínculo plan↔riesgo se valida contra la base, nunca a ciegas: el cliente puede desvincular
   * con null, o escoger un riesgo que exista y que pertenezca a la misma empresa del diagnóstico
   * del plan. El riesgo de destino y los destinatarios del aviso quedan siempre en manos del
   * backend (el aviso se deriva del riesgo guardado, no de lo que pida quien completó la tarea).
   */
  const resolveMitigationPlanRisk = async (riskId: string | null, companyId: string): Promise<{ ok: true; riskId: string | null } | { ok: false; error: string }> => {
    if (riskId === null) return { ok: true, riskId: null }
    const risk = await db.risk.findUnique({ where: { id: riskId }, select: { id: true, process: { select: { companyId: true } } } })
    if (!risk || risk.process.companyId !== companyId) {
      return { ok: false, error: 'Risk not found' }
    }
    return { ok: true, riskId: risk.id }
  }

  app.post('/api/diagnostics/:id/action-plans', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = actionPlanCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid action plan data', details: parsed.error.issues })
      return
    }
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const planData: Prisma.ActionPlanUncheckedCreateInput = { diagnosticId: diagnostic.id, title: parsed.data.title, description: parsed.data.description, status: parsed.data.status, createdById: request.user!.id }
    if (parsed.data.riskId !== undefined) {
      const linked = await resolveMitigationPlanRisk(parsed.data.riskId, diagnostic.company.id)
      if (!linked.ok) {
        response.status(400).json({ error: linked.error })
        return
      }
      planData.riskId = linked.riskId
    }
    const actionPlan = await db.actionPlan.create({ data: planData, include: actionPlanInclude })
    response.status(201).json({ actionPlan: actionPlanView(actionPlan) })
  }))

  app.get('/api/action-plans/:id', authMiddleware, asyncHandler(async (request, response) => {
    const actionPlan = await db.actionPlan.findUnique({ where: { id: String(request.params.id) }, include: { ...actionPlanInclude, diagnostic: { include: { company: { select: { id: true } } } } } })
    if (!actionPlan || !canAccessCompany(request, actionPlan.diagnostic.company)) {
      response.status(404).json({ error: 'Action plan not found' })
      return
    }
    response.json({ actionPlan: actionPlanView(actionPlan) })
  }))

  app.patch('/api/action-plans/:id', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = actionPlanUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid action plan data', details: parsed.error.issues })
      return
    }
    const existing = await db.actionPlan.findUnique({ where: { id: String(request.params.id) }, include: { diagnostic: { include: { company: { select: { id: true } } } } } })
    if (!existing || !canAccessCompany(request, existing.diagnostic.company)) {
      response.status(404).json({ error: 'Action plan not found' })
      return
    }
    const data: Prisma.ActionPlanUncheckedUpdateInput = { ...parsed.data }
    if (parsed.data.riskId !== undefined) {
      const linked = await resolveMitigationPlanRisk(parsed.data.riskId, existing.diagnostic.company.id)
      if (!linked.ok) {
        response.status(400).json({ error: linked.error })
        return
      }
      data.riskId = linked.riskId
    }
    const actionPlan = await db.actionPlan.update({ where: { id: existing.id }, data, include: actionPlanInclude })
    response.json({ actionPlan: actionPlanView(actionPlan) })
  }))

  app.delete('/api/action-plans/:id', authMiddleware, asyncHandler(async (request, response) => {
    const existing = await db.actionPlan.findUnique({ where: { id: String(request.params.id) }, include: { diagnostic: { include: { company: { select: { id: true } } } } } })
    if (!existing || !canAccessCompany(request, existing.diagnostic.company)) {
      response.status(404).json({ error: 'Action plan not found' })
      return
    }
    await db.actionPlan.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  app.post('/api/diagnostics/:id/strategy-tasks', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = strategyTasksCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid strategy task data', details: parsed.error.issues })
      return
    }
    const diagnostic = await db.qualityDiagnostic.findUnique({ where: { id: String(request.params.id) }, include: { company: { select: { id: true } } } })
    if (!diagnostic || !canAccessCompany(request, diagnostic.company)) {
      response.status(404).json({ error: 'Diagnostic not found' })
      return
    }
    const strategies = await loadDiagnosticStrategies(db, diagnostic.id, true)
    const strategy = strategies.find((candidate) => candidate.id === parsed.data.strategyId)
    if (!strategy) {
      response.status(404).json({ error: 'Weighted strategy not found' })
      return
    }
    if (!strategy.weighting || !strategy.weightingBand) {
      response.status(400).json({ error: 'The strategy must be weighted and classified before creating tasks' })
      return
    }
    const strategyPriority = strategyBandToActionPriority[strategy.weightingBand]
    const responsibleIds = [...new Set(parsed.data.tasks.map((task) => task.responsibleId))]
    const responsibleUsers = await Promise.all(responsibleIds.map((id) => db.user.findUnique({ where: { id }, select: { id: true, companyId: true } })))
    for (const responsible of responsibleUsers) {
      if (!responsible) {
        response.status(400).json({ error: 'Responsible user not found' })
        return
      }
      if (request.user?.role !== Role.SUPERUSER && responsible.companyId !== request.user?.companyId) {
        response.status(403).json({ error: 'You can only assign responsibilities to users of your own company' })
        return
      }
    }

    const sourceRef = strategySourceRef(strategy.description)
    const planKey = { diagnosticId: diagnostic.id, strategySource: strategy.source, strategySourceRef: sourceRef }
    try {
      const result = await db.$transaction(async (tx) => {
        let plan = await tx.actionPlan.findUnique({ where: { diagnosticId_strategySource_strategySourceRef: planKey }, include: actionPlanInclude })
        let createdPlan = false
        if (!plan) {
          plan = await tx.actionPlan.create({
            data: {
              diagnosticId: diagnostic.id,
              title: `Tareas para ${strategy.title}`,
              description: strategy.description,
              status: 'ACTIVE',
              createdById: request.user!.id,
              strategySource: strategy.source,
              strategySourceRef: sourceRef,
              strategyTitle: strategy.title,
              strategyDescription: strategy.description,
            },
            include: actionPlanInclude,
          })
          createdPlan = true
        }
        const existingTaskTitles = new Set(plan.items.map((item) => item.title.trim().replace(/\s+/g, ' ').toLowerCase()))
        const skippedTasks: string[] = []
        for (const task of parsed.data.tasks) {
          const taskKey = task.title.trim().replace(/\s+/g, ' ').toLowerCase()
          if (existingTaskTitles.has(taskKey)) {
            skippedTasks.push(task.title)
            continue
          }
          const created = await tx.actionItem.create({
            data: {
              actionPlanId: plan.id,
              title: task.title,
              description: task.title,
              priority: strategyPriority,
              status: 'PENDING',
              responsibleId: task.responsibleId,
              dueDate: task.dueDate,
            },
            include: actionItemInclude,
          })
          await tx.ticket.create({
            data: ticketDataFromActionItem({
              title: created.title,
              description: created.description,
              status: created.status,
              priority: created.priority,
              responsibleId: created.responsibleId,
              dueDate: created.dueDate,
              actionItemId: created.id,
              createdById: request.user!.id,
            }),
            include: ticketInclude,
          })
          existingTaskTitles.add(taskKey)
        }
        const refreshedPlan = await tx.actionPlan.findUnique({ where: { id: plan.id }, include: actionPlanInclude })
        return { plan: refreshedPlan ?? plan, createdPlan, createdCount: parsed.data.tasks.length - skippedTasks.length, skippedTasks }
      })
      response.status(result.createdPlan ? 201 : 200).json({ actionPlan: actionPlanView(result.plan), createdCount: result.createdCount, skippedTasks: result.skippedTasks })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        response.status(409).json({ error: 'Tasks for this strategy are already being created' })
        return
      }
      throw error
    }
  }))

  app.post('/api/action-plans/:id/items', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = actionItemCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid action item data', details: parsed.error.issues })
      return
    }
    const actionPlan = await db.actionPlan.findUnique({ where: { id: String(request.params.id) }, select: { id: true, diagnosticId: true, riskId: true, diagnostic: { select: { company: { select: { id: true } } } } } })
    if (!actionPlan || !canAccessCompany(request, actionPlan.diagnostic.company)) {
      response.status(404).json({ error: 'Action plan not found' })
      return
    }
    // Gate de etapas: un plan de acción que ejecuta el plan de mitigación de un riesgo no admite
    // actividades nuevas mientras ese riesgo no esté aceptado. Los planes de diagnóstico (sin
    // riskId) siguen siendo libres, y la edición/baja de las actividades existentes pasa por la
    // ruta de action-items, que aplica el mismo gate solo al contenido.
    if (actionPlan.riskId) {
      const risk = await db.risk.findUnique({ where: { id: actionPlan.riskId }, select: riskStageSelect })
      if (!risk) {
        response.status(404).json({ error: 'Risk not found' })
        return
      }
      const stageLock = riskStageLockError(risk)
      if (stageLock) {
        response.status(409).json({ error: stageLock })
        return
      }
    }
    if (parsed.data.recommendationId) {
      const recommendation = await db.recommendation.findUnique({ where: { id: parsed.data.recommendationId }, select: { diagnosticId: true } })
      if (!recommendation || recommendation.diagnosticId !== actionPlan.diagnosticId) {
        response.status(400).json({ error: 'Recommendation not found for this diagnostic' })
        return
      }
    }
    if (parsed.data.responsibleId) {
      const responsible = await db.user.findUnique({ where: { id: parsed.data.responsibleId }, select: { id: true, companyId: true } })
      if (!responsible) {
        response.status(400).json({ error: 'Responsible user not found' })
        return
      }
      if (request.user?.role !== Role.SUPERUSER && responsible.companyId !== request.user?.companyId) {
        response.status(403).json({ error: 'You can only assign responsibilities to users of your own company' })
        return
      }
    }
    const { item, ticket } = await db.$transaction(async (tx) => {
      const created = await tx.actionItem.create({ data: { actionPlanId: actionPlan.id, ...parsed.data }, include: actionItemInclude })
      // Alta de una actividad ya completada: también puede cerrar la mitigación del riesgo, así
      // que se corre la misma comprobación (si el plan no estaba completo, no hace nada).
      if (created.status === ActionItemStatus.COMPLETED) {
        await notifyMitigationPlanCompleted(tx, created.actionPlanId)
      }
      const existingTicket = await tx.ticket.findUnique({ where: { actionItemId: created.id }, include: ticketInclude })
      const linkedTicket = existingTicket ?? await tx.ticket.create({ data: ticketDataFromActionItem({ title: created.title, description: created.description, status: created.status, priority: created.priority, responsibleId: created.responsibleId, dueDate: created.dueDate, actionItemId: created.id, createdById: request.user!.id }), include: ticketInclude })
      // Aviso de asignación: si la actividad nace con responsable, ese responsable se entera aquí
      // mismo (mismo link idempotente que el resto de reasignaciones: tickets/<id>).
      await notifyTicketAssigned(tx, linkedTicket, linkedTicket.assignedToId, request.user!.id)
      return { item: created, ticket: linkedTicket }
    })
    response.status(201).json({ item: actionItemView(item), ticket: ticketView(ticket) })
  }))

  app.patch('/api/action-items/:id', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = actionItemUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid action item data', details: parsed.error.issues })
      return
    }
    const existing = await db.actionItem.findUnique({ where: { id: String(request.params.id) }, include: { actionPlan: { include: { diagnostic: { include: { company: { select: { id: true } } } } } } } })
    if (!existing || !canAccessCompany(request, existing.actionPlan.diagnostic.company)) {
      response.status(404).json({ error: 'Action item not found' })
      return
    }
    if (parsed.data.recommendationId) {
      const recommendation = await db.recommendation.findUnique({ where: { id: parsed.data.recommendationId }, select: { diagnosticId: true } })
      if (!recommendation || recommendation.diagnosticId !== existing.actionPlan.diagnosticId) {
        response.status(400).json({ error: 'Recommendation not found for this diagnostic' })
        return
      }
    }
    if (parsed.data.responsibleId) {
      const responsible = await db.user.findUnique({ where: { id: parsed.data.responsibleId }, select: { id: true, companyId: true } })
      if (!responsible) {
        response.status(400).json({ error: 'Responsible user not found' })
        return
      }
      if (request.user?.role !== Role.SUPERUSER && responsible.companyId !== request.user?.companyId) {
        response.status(403).json({ error: 'You can only assign responsibilities to users of your own company' })
        return
      }
    }
    // Gate de etapas del riesgo: el CONTENIDO de una actividad del plan de mitigación (título,
    // descripción, prioridad, responsable, vencimiento o recomendación) solo se edita con el
    // riesgo aceptado, aunque la actividad ya exista. El cierre queda FUERA del gate: completar o
    // cancelar es la finalización de trabajo ya asignado, con la compuerta de evidencia PDF de
    // siempre (mismo criterio que la baja de controles), y un plan de diagnóstico (sin riskId) no
    // se ve afectado.
    const contentChanged = ['title', 'description', 'priority', 'recommendationId', 'responsibleId', 'dueDate'].some((field) => parsed.data[field as keyof typeof parsed.data] !== undefined)
    if (contentChanged && existing.actionPlan.riskId) {
      const risk = await db.risk.findUnique({ where: { id: existing.actionPlan.riskId }, select: riskStageSelect })
      const stageLock = risk ? riskStageLockError(risk) : riskStageMessages['acceptance-pending']
      if (stageLock) {
        response.status(409).json({ error: stageLock })
        return
      }
    }
    // Transición de estado que cierra la mitigación: solo cuando la actividad pasa a COMPLETED
    // desde otro estado se reevalúa el plan de mitigación del riesgo. Editar un ítem ya
    // completado sin tocar su estado, o marcarlo CANCELLED, no dispara el aviso.
    const justCompleted = parsed.data.status === ActionItemStatus.COMPLETED && existing.status !== ActionItemStatus.COMPLETED
    const item = await db.$transaction(async (tx) => {
      // Gate de evidencia: cerrar una actividad de un plan de mitigación de un riesgo exige tener
      // al menos un PDF en el ticket que la representa. Se comprueba ANTES de escribir y dentro de
      // la misma transacción (si falla, no cambia ni el estado ni el ticket). Solo corre sobre
      // transiciones nuevas a COMPLETED: CANCELLED no afirma que la mitigación se ejecutara, y una
      // actividad ya completada se puede reescribir sin volver a exigir evidencia.
      if (parsed.data.status !== undefined) {
        const gateTicket = await tx.ticket.findUnique({ where: { actionItemId: existing.id }, select: { id: true } })
        await assertMitigationEvidence(tx, {
          ticketId: gateTicket?.id ?? null,
          actionItemId: existing.id,
          willCompleteActivity: parsed.data.status === ActionItemStatus.COMPLETED,
          wasActivityCompleted: existing.status === ActionItemStatus.COMPLETED,
        })
      }
      const updated = await tx.actionItem.update({ where: { id: existing.id }, data: parsed.data, include: actionItemInclude })
      const linked = await tx.ticket.findUnique({ where: { actionItemId: updated.id }, select: { id: true } })
      const ticketData: Prisma.TicketUncheckedUpdateInput = {}
      if (parsed.data.title !== undefined) ticketData.title = parsed.data.title
      if (parsed.data.description !== undefined) ticketData.description = parsed.data.description
      if (parsed.data.priority !== undefined) ticketData.priority = actionItemToTicketPriority[parsed.data.priority]
      if (parsed.data.responsibleId !== undefined) ticketData.assignedToId = parsed.data.responsibleId
      if (parsed.data.dueDate !== undefined) ticketData.dueDate = parsed.data.dueDate
      if (parsed.data.status !== undefined) ticketData.status = actionItemToTicketStatus[parsed.data.status]
      let linkedTicketId: string
      if (linked) {
        linkedTicketId = linked.id
        if (Object.keys(ticketData).length > 0) {
          await tx.ticket.update({ where: { id: linked.id }, data: ticketData })
        }
      } else {
        const linkedTicket = await tx.ticket.create({ data: ticketDataFromActionItem({ title: updated.title, description: updated.description, status: updated.status, priority: updated.priority, responsibleId: updated.responsibleId, dueDate: updated.dueDate, actionItemId: updated.id, createdById: request.user!.id }) })
        linkedTicketId = linkedTicket.id
      }
      // Aviso de asignación: solo cuando el responsable cambia de verdad (y no a "sin responsable");
      // el link idempotente evita repetir el aviso si se reasigna a alguien ya avisado.
      if (parsed.data.responsibleId !== undefined && parsed.data.responsibleId !== existing.responsibleId && parsed.data.responsibleId) {
        await notifyTicketAssigned(tx, { id: linkedTicketId, title: updated.title }, parsed.data.responsibleId, request.user!.id)
      }
      if (justCompleted) {
        await notifyMitigationPlanCompleted(tx, updated.actionPlanId)
      }
      return updated
    })
    response.json({ item: actionItemView(item) })
  }))

  app.delete('/api/action-items/:id', authMiddleware, asyncHandler(async (request, response) => {
    const existing = await db.actionItem.findUnique({ where: { id: String(request.params.id) }, include: { actionPlan: { include: { diagnostic: { include: { company: { select: { id: true } } } } } } } })
    if (!existing || !canAccessCompany(request, existing.actionPlan.diagnostic.company)) {
      response.status(404).json({ error: 'Action item not found' })
      return
    }
    // Orden de limpieza: primero se confirma en base de datos (borrar el ticket borra en cascada
    // sus filas de evidencia) y solo después se toca el disco. Un archivo que no se pueda borrar
    // queda huérfano y se registra, nunca al revés: no se borra nada del disco sin haber borrado
    // la fila que lo referenciaba.
    const evidenceStoredNames = await db.$transaction(async (tx) => {
      const linked = await tx.ticket.findUnique({ where: { actionItemId: existing.id }, select: { id: true } })
      const evidenceFiles = linked ? await tx.ticketEvidenceFile.findMany({ where: { ticketId: linked.id }, select: { storedName: true } }) : []
      const storedNames = evidenceFiles.map((evidenceFile) => evidenceFile.storedName)
      if (linked) {
        await tx.ticket.delete({ where: { id: linked.id } })
      }
      await tx.actionItem.delete({ where: { id: existing.id } })
      return storedNames
    })
    if (evidenceStoredNames.length > 0) {
      const { failed } = await removeEvidenceFiles(evidenceStoredNames)
      if (failed.length > 0) {
        console.error('[evidence] no se pudieron borrar archivos tras eliminar la actividad', { actionItemId: existing.id, failed })
      }
    }
    response.status(204).send()
  }))

  app.get('/api/tickets', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = ticketQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid filters', details: parsed.error.issues })
      return
    }
    const { status, priority, search } = parsed.data
    const where: Prisma.TicketWhereInput = { ...scopeForUser(request), ...(status ? { status } : {}), ...(priority ? { priority } : {}) }
    if (search) where.AND = [{ OR: [{ title: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] }]
    const tickets = await db.ticket.findMany({ where, include: ticketInclude, orderBy: { updatedAt: 'desc' } })
    response.json({ tickets: tickets.map(ticketView) })
  }))

  const canAssignTickets = (request: Request) => request.user?.role === Role.SUPERUSER || request.user?.role === Role.COMPANY_ADMIN

  app.post('/api/tickets', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = ticketCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid ticket data', details: parsed.error.issues })
      return
    }
    if (parsed.data.assignedToId !== undefined && !canAssignTickets(request)) {
      response.status(403).json({ error: 'Only company admins and superusers can assign tickets' })
      return
    }
    if (parsed.data.assignedToId) {
      const assignee = await db.user.findUnique({ where: { id: parsed.data.assignedToId }, select: { id: true, companyId: true } })
      if (!assignee) {
        response.status(400).json({ error: 'Assigned user not found' })
        return
      }
      if (request.user?.role === Role.COMPANY_ADMIN && assignee.companyId !== request.user?.companyId) {
        response.status(403).json({ error: 'You can only assign tickets to users of your own company' })
        return
      }
    }
    const ticket = await db.$transaction(async (tx) => {
      const created = await tx.ticket.create({ data: { title: parsed.data.title, description: parsed.data.description, status: parsed.data.status, priority: parsed.data.priority, createdById: request.user!.id, assignedToId: parsed.data.assignedToId }, include: ticketInclude })
      // Aviso de asignación: un ticket manual con responsable avisa a ese responsable con el mismo
      // link idempotente (tickets/<id>) que usan las reasignaciones. El aviso vive en la misma
      // transacción que la creación, para que nunca quede un aviso de un ticket que no se creó.
      await notifyTicketAssigned(tx, created, created.assignedToId, request.user!.id)
      return created
    })
    response.status(201).json({ ticket: ticketView(ticket) })
  }))

  app.get('/api/tickets/:id', authMiddleware, asyncHandler(async (request, response) => {
    const ticket = await db.ticket.findUnique({ where: { id: String(request.params.id) }, include: ticketInclude })
    if (!ticket || !canAccessTicket(request, ticket)) {
      response.status(404).json({ error: 'Ticket not found' })
      return
    }
    response.json({ ticket: ticketView(ticket) })
  }))

  // ---- Evidencia PDF de los tickets ----
  // Los archivos viven en el directorio privado EVIDENCE_UPLOAD_DIR con nombre generado por el
  // servidor; aquí solo se guardan/sirven metadatos y referencias. Todas las operaciones pasan
  // antes por la misma comprobación de acceso al ticket (canAccessTicket), así un usuario que no
  // puede abrir el ticket tampoco ve, descarga ni borra su evidencia. La lista por plan respeta la
  // misma visibilidad, de modo que cada fila mostrada es una fila que efectivamente se puede abrir.
  const findAccessibleTicket = async (request: Request, ticketId: string) => {
    const ticket = await db.ticket.findUnique({ where: { id: ticketId }, include: ticketInclude })
    return ticket && canAccessTicket(request, ticket) ? ticket : null
  }

  app.post('/api/tickets/:id/evidence', authMiddleware, asyncHandler(async (request, response) => {
    const ticket = await findAccessibleTicket(request, String(request.params.id))
    if (!ticket) {
      response.status(404).json({ error: 'Ticket not found' })
      return
    }
    // El cuerpo se lee a mano: express.json solo procesa application/json y aquí llega binario.
    const contentTypeHeader = String(request.headers['content-type'] ?? '')
    if (!/^multipart\/form-data\b/i.test(contentTypeHeader.trim())) {
      throw new MultipartError(415, 'La evidencia debe subirse como multipart/form-data con el campo "file"')
    }
    const raw = await readRequestBuffer(request, MAX_UPLOAD_REQUEST_BYTES)
    const file = findMultipartFile(parseMultipartFormData(raw, contentTypeHeader), 'file')
    if (!file) {
      throw new MultipartError(400, 'Falta el archivo PDF en el campo "file"')
    }
    // Toda la validación (extensión, MIME declarado, firma %PDF y tamaño) ocurre ANTES de tocar
    // disco: si algo falla, no queda ni fila ni archivo.
    const upload = validateEvidenceUpload({ filename: sanitizeUploadFilename(file.filename ?? ''), contentType: file.contentType, data: file.data })
    const storedName = nextStoredName()
    await writeEvidenceFile(storedName, file.data)
    let created: Prisma.TicketEvidenceFileGetPayload<{ include: typeof evidenceInclude }>
    try {
      created = await db.ticketEvidenceFile.create({
        data: {
          ticketId: ticket.id,
          filename: upload.filename,
          storedName,
          mimeType: upload.mimeType,
          size: upload.size,
          uploadedById: request.user!.id,
        },
        include: evidenceInclude,
      })
    } catch (error) {
      // Se escribió el archivo y falló la fila: se retira el bytes para no dejar basura en disco.
      const { failed } = await removeEvidenceFiles([storedName])
      if (failed.length > 0) {
        console.error('[evidence] no se pudo retirar el archivo tras fallar la escritura de la fila', { ticketId: ticket.id, storedName, failed })
      }
      throw error
    }
    response.status(201).json({ evidence: evidenceView(created) })
  }))

  app.get('/api/tickets/:id/evidence', authMiddleware, asyncHandler(async (request, response) => {
    const ticket = await findAccessibleTicket(request, String(request.params.id))
    if (!ticket) {
      response.status(404).json({ error: 'Ticket not found' })
      return
    }
    const evidence = await db.ticketEvidenceFile.findMany({ where: { ticketId: ticket.id }, include: evidenceInclude, orderBy: { createdAt: 'desc' } })
    response.json({ evidence: evidence.map(evidenceView) })
  }))

  app.get('/api/tickets/:id/evidence/:evidenceId', authMiddleware, asyncHandler(async (request, response) => {
    const ticket = await findAccessibleTicket(request, String(request.params.id))
    if (!ticket) {
      response.status(404).json({ error: 'Ticket not found' })
      return
    }
    const record = await db.ticketEvidenceFile.findFirst({ where: { id: String(request.params.evidenceId), ticketId: ticket.id }, include: evidenceInclude })
    if (!record) {
      response.status(404).json({ error: 'Evidence not found' })
      return
    }
    let data: Buffer
    try {
      data = await readEvidenceFile(record.storedName)
    } catch (error) {
      // Fila sin archivo detrás (limpieza incompleta): se informa como no disponible, no como 500.
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        response.status(404).json({ error: 'El archivo de evidencia ya no está disponible' })
        return
      }
      throw error
    }
    response.setHeader('Content-Type', record.mimeType)
    response.setHeader('Content-Length', String(data.length))
    // El nombre ya vino saneado de la subida; se vuelve a sanear por si la fila viniera de otra
    // vía, para que no haya comillas ni saltos de línea en la cabecera.
    response.setHeader('Content-Disposition', `attachment; filename="${sanitizeUploadFilename(record.filename)}"`)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'private, no-store')
    response.send(data)
  }))

  app.delete('/api/tickets/:id/evidence/:evidenceId', authMiddleware, asyncHandler(async (request, response) => {
    const ticket = await findAccessibleTicket(request, String(request.params.id))
    if (!ticket) {
      response.status(404).json({ error: 'Ticket not found' })
      return
    }
    const record = await db.ticketEvidenceFile.findFirst({ where: { id: String(request.params.evidenceId), ticketId: ticket.id }, select: { id: true, storedName: true } })
    if (!record) {
      response.status(404).json({ error: 'Evidence not found' })
      return
    }
    // Base de datos primero y disco después: si el unlink falla queda un archivo huérfano (que se
    // registra), nunca una fila que promete un archivo ya borrado.
    await db.ticketEvidenceFile.delete({ where: { id: record.id } })
    const { failed } = await removeEvidenceFiles([record.storedName])
    if (failed.length > 0) {
      console.error('[evidence] archivo no borrado tras eliminar la evidencia', { ticketId: ticket.id, storedName: record.storedName, failed })
    }
    response.status(204).send()
  }))

  app.patch('/api/tickets/:id', authMiddleware, asyncHandler(async (request, response) => {
    const parsed = ticketUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid ticket data', details: parsed.error.issues })
      return
    }
    const existing = await db.ticket.findUnique({ where: { id: String(request.params.id) }, include: ticketInclude })
    if (!existing || !canAccessTicket(request, existing)) {
      response.status(404).json({ error: 'Ticket not found' })
      return
    }
    if (parsed.data.assignedToId !== undefined && !canAssignTickets(request)) {
      response.status(403).json({ error: 'Only company admins and superusers can assign tickets' })
      return
    }
    if (parsed.data.assignedToId) {
      const assignee = await db.user.findUnique({ where: { id: parsed.data.assignedToId }, select: { id: true, companyId: true } })
      if (!assignee) {
        response.status(400).json({ error: 'Assigned user not found' })
        return
      }
      if (request.user?.role === Role.COMPANY_ADMIN && assignee.companyId !== request.user?.companyId) {
        response.status(403).json({ error: 'You can only assign tickets to users of your own company' })
        return
      }
    }
    const newStatus = parsed.data.status
    const ticket = await db.$transaction(async (tx) => {
      // Gate de evidencia: cerrar (RESOLVED/CLOSED) la actividad de un plan de mitigación de un
      // riesgo exige al menos un PDF en el ticket. Los estados se traducen con el mismo mapa que
      // sincroniza la actividad: si la transición deja la actividad COMPLETED y no lo estaba, el
      // gate corre; un ticket ya cerrado que se reescribe no vuelve a exigir evidencia. Al lanzar
      // dentro de la transacción, el 409 invierte también cualquier escritura previa de aquí.
      if (newStatus !== undefined) {
        await assertMitigationEvidence(tx, {
          ticketId: existing.id,
          actionItemId: existing.actionItemId,
          willCompleteActivity: ticketStatusToActionItemStatus[newStatus] === ActionItemStatus.COMPLETED,
          wasActivityCompleted: ticketStatusToActionItemStatus[existing.status] === ActionItemStatus.COMPLETED,
        })
      }
      const updated = await tx.ticket.update({ where: { id: existing.id }, data: parsed.data, include: ticketInclude })
      if (newStatus !== undefined && newStatus !== existing.status && existing.actionItemId) {
        // La tarea es la fuente de verdad del progreso del plan; el estado antes de escribirlo
        // decide si esto cierra la mitigación (p. ej. ticket RESOLVED -> actividad COMPLETED).
        const itemBefore = await tx.actionItem.findUnique({ where: { id: existing.actionItemId }, select: { status: true, actionPlanId: true } })
        await tx.actionItem.update({ where: { id: existing.actionItemId }, data: { status: ticketStatusToActionItemStatus[newStatus] } })
        if (itemBefore && itemBefore.status !== ActionItemStatus.COMPLETED && ticketStatusToActionItemStatus[newStatus] === ActionItemStatus.COMPLETED) {
          await notifyMitigationPlanCompleted(tx, itemBefore.actionPlanId)
        }
      }
      // Trazabilidad en el historial del riesgo de origen: solo los tickets derivados de una
      // aprobación llevan riskApprovals (0 o 1), y solo los cambios de estado relevantes quedan
      // registrados. Se escribe en la MISMA transacción que la modificación del ticket, con el
      // actor de la sesión (quien hizo el cambio) y los estados antes/después en metadata.
      const originApproval = existing.riskApprovals?.[0]
      if (newStatus !== undefined && newStatus !== existing.status && originApproval?.riskId) {
        await riskAuditWrite(tx, {
          riskId: originApproval.riskId,
          eventType: 'TICKET_STATUS_CHANGED',
          summary: `Estado del ticket: ${ticketStatusNames[newStatus]}`,
          actor: request.user!,
          metadata: {
            ticketId: existing.id,
            approvalId: originApproval.id,
            previousStatus: existing.status,
            status: newStatus,
          },
        })
      }
      // Aviso de asignación: solo cuando el responsable cambia de verdad (asignar al que ya
      // estaba, o dejarlo sin responsable, no genera aviso).
      if (parsed.data.assignedToId !== undefined && parsed.data.assignedToId !== existing.assignedToId && parsed.data.assignedToId) {
        await notifyTicketAssigned(tx, updated, parsed.data.assignedToId, request.user!.id)
      }
      return updated
    })
    response.json({ ticket: ticketView(ticket) })
  }))

  app.delete('/api/tickets/:id', authMiddleware, asyncHandler(async (request, response) => {
    const existing = await db.ticket.findUnique({
      where: { id: String(request.params.id) },
      select: { id: true, createdById: true, assignedToId: true, createdBy: { select: { companyId: true } }, assignedTo: { select: { companyId: true } } },
    })
    if (!existing || !canAccessTicket(request, existing)) {
      response.status(404).json({ error: 'Ticket not found' })
      return
    }
    if (request.user?.role !== Role.SUPERUSER && existing.createdById !== request.user?.id) {
      response.status(403).json({ error: 'Only the creator or a superuser can delete a ticket' })
      return
    }
    // Orden de limpieza: se leen los nombres en disco, se borra la fila del ticket (y en cascada
    // sus evidencias) y SOLO entonces se borran los archivos. Un archivo que no salga se registra
    // como huérfano; nunca se borra primero el disco, porque si la escritura fallara quedarían filas
    // de evidencia apuntando a un archivo ya borrado.
    const evidenceFiles = await db.ticketEvidenceFile.findMany({ where: { ticketId: existing.id }, select: { storedName: true } })
    await db.ticket.delete({ where: { id: existing.id } })
    if (evidenceFiles.length > 0) {
      const { failed } = await removeEvidenceFiles(evidenceFiles.map((evidenceFile) => evidenceFile.storedName))
      if (failed.length > 0) {
        console.error('[evidence] no se pudieron borrar archivos tras eliminar el ticket', { ticketId: existing.id, failed })
      }
    }
    response.status(204).send()
  }))

  app.get('/api/dashboard', authMiddleware, asyncHandler(async (request, response) => {
    const dashboard = await getDashboardData(db, request)
    response.json(dashboard)
  }))

  app.use((_request, response) => response.status(404).json({ error: 'Not found' }))
  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    void next
    // Subida de evidencia: formato/tamaño/tipo del archivo, ya con su estado (400/413/415).
    if (error instanceof MultipartError || error instanceof EvidenceValidationError) {
      response.status(error.status).json({ error: error.message })
      return
    }
    // Gate de evidencia: la actividad de mitigación intenta cerrarse sin PDF adjunto.
    if (error instanceof MitigationEvidenceRequiredError) {
      response.status(409).json({ error: error.message, reason: error.reason })
      return
    }
    if (error instanceof SyntaxError) {
      response.status(400).json({ error: 'Invalid JSON body' })
      return
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      response.status(409).json({ error: 'A resource with that value already exists' })
      return
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      response.status(409).json({ error: 'The resource cannot be deleted because it is referenced by other records' })
      return
    }
    // Logging de diagnóstico: nombre, código de Prisma y stack. Sin cuerpos de petición, sin
    // tokens y sin claves. Un P2021 aquí significa que la base de datos está por detrás de las
    // migraciones del repositorio, que es la causa más habitual de un 500 en estas rutas.
    const detail = error instanceof Prisma.PrismaClientKnownRequestError
      ? { name: error.name, code: error.code, model: (error.meta as { modelName?: string } | undefined)?.modelName, message: error.message, stack: error.stack }
      : error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { value: String(error) }
    console.error('[api] unhandled error', detail)
    response.status(500).json({ error: 'Internal server error' })
  })
  return app
}
