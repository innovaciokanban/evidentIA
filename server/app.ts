import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import { createHash } from 'node:crypto'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { ActionItemStatus, Prisma, PrismaClient, Priority, CrossOrigin, CrossType, CheckyCategory, CheckyFindingBasis, Role, TicketPriority, TicketStatus } from '@prisma/client'
import { env } from './env.js'
import { prisma } from './prisma.js'
import { authenticate, clearSessionCookie, createSession, publicUser, requireRole } from './auth.js'
import { AIService, AIServiceError, resolveWeightingBand, sanitizeAIAnalysisResult, sanitizeCheckyResult, type CheckyConsultResult, type CheckyConsolidatedStrategy, type CheckyContext, type CheckyWeighting, type CrossAnalysisResult, type GeneratedCrossForAI } from './ai-service.js'
import { getDashboardData } from './dashboard-service.js'
import { calculateWeightedScore, WEIGHTING_LEVEL_SCORE } from './weighting-service.js'
import { AI_STRATEGY_QUADRANTS, collectStrategies, readAiStrategyTexts, type AiStrategySource, type CheckyStrategySource, type CrossStrategySource, type StrategyFactor, type StrategyForPrioritization } from './strategies-service.js'
import { indexStrategyWeightings, strategySourceRef, strategyWeightingUpsertData, strategyWeightingView } from './strategy-weighting-service.js'
import { checkyEvidenceWithPair, filterCheckySuggestions, requiresCheckyCrossPair, resolveCheckyCrossPair, type CheckyCrossPair, type CheckyCrossRef } from './checky-cross.js'
import { sanitizeTextWithSwotItems, type SwotTextItem } from './text-sanitization.js'
import { actionItemCreateSchema, actionItemUpdateSchema, actionPlanCreateSchema, actionPlanUpdateSchema, aiAnalysisSchema, checkyMessageCreateSchema, checkySessionCreateSchema, checkySuggestionDecisionSchema, companyCreateSchema, companyQuerySchema, companyUpdateSchema, crossAnalyzeSchema, crossAnalysisSchema, crossCreateSchema, crossTypeFor, crossUpdateSchema, crossWeightingSchema, diagnosticCreateSchema, diagnosticUpdateSchema, loginSchema, recommendationUpdateSchema, strategyTasksCreateSchema, strategyWeightingSchema, swotItemCreateSchema, swotItemUpdateSchema, ticketCreateSchema, ticketQuerySchema, ticketUpdateSchema, userCreateSchema, userUpdateSchema } from './validation.js'

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
} as const
const ticketView = (ticket: Prisma.TicketGetPayload<{ include: typeof ticketInclude }>) => ticket
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
        // Ponderación muestra la aceptación explícita de Checky, no el cruce DOFA que pudo crear
        // una sugerencia MISSING_CROSSES. La consolidación normal conserva el cruce por separado.
        return { crosses: [], aiStrategies: [], checkySuggestions, includeMissingCrossStrategies: true }
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
    const actionPlan = await db.actionPlan.create({ data: { diagnosticId: diagnostic.id, title: parsed.data.title, description: parsed.data.description, status: parsed.data.status, createdById: request.user!.id }, include: actionPlanInclude })
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
    const actionPlan = await db.actionPlan.update({ where: { id: existing.id }, data: parsed.data, include: actionPlanInclude })
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
    const actionPlan = await db.actionPlan.findUnique({ where: { id: String(request.params.id) }, select: { id: true, diagnosticId: true, diagnostic: { select: { company: { select: { id: true } } } } } })
    if (!actionPlan || !canAccessCompany(request, actionPlan.diagnostic.company)) {
      response.status(404).json({ error: 'Action plan not found' })
      return
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
      const existingTicket = await tx.ticket.findUnique({ where: { actionItemId: created.id }, include: ticketInclude })
      const linkedTicket = existingTicket ?? await tx.ticket.create({ data: ticketDataFromActionItem({ title: created.title, description: created.description, status: created.status, priority: created.priority, responsibleId: created.responsibleId, dueDate: created.dueDate, actionItemId: created.id, createdById: request.user!.id }), include: ticketInclude })
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
    const item = await db.$transaction(async (tx) => {
      const updated = await tx.actionItem.update({ where: { id: existing.id }, data: parsed.data, include: actionItemInclude })
      const linked = await tx.ticket.findUnique({ where: { actionItemId: updated.id }, select: { id: true } })
      const ticketData: Prisma.TicketUncheckedUpdateInput = {}
      if (parsed.data.title !== undefined) ticketData.title = parsed.data.title
      if (parsed.data.description !== undefined) ticketData.description = parsed.data.description
      if (parsed.data.priority !== undefined) ticketData.priority = actionItemToTicketPriority[parsed.data.priority]
      if (parsed.data.responsibleId !== undefined) ticketData.assignedToId = parsed.data.responsibleId
      if (parsed.data.dueDate !== undefined) ticketData.dueDate = parsed.data.dueDate
      if (parsed.data.status !== undefined) ticketData.status = actionItemToTicketStatus[parsed.data.status]
      if (linked) {
        if (Object.keys(ticketData).length > 0) {
          await tx.ticket.update({ where: { id: linked.id }, data: ticketData })
        }
      } else {
        await tx.ticket.create({ data: ticketDataFromActionItem({ title: updated.title, description: updated.description, status: updated.status, priority: updated.priority, responsibleId: updated.responsibleId, dueDate: updated.dueDate, actionItemId: updated.id, createdById: request.user!.id }) })
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
    await db.$transaction(async (tx) => {
      const linked = await tx.ticket.findUnique({ where: { actionItemId: existing.id }, select: { id: true } })
      if (linked) {
        await tx.ticket.delete({ where: { id: linked.id } })
      }
      await tx.actionItem.delete({ where: { id: existing.id } })
    })
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
    const ticket = await db.ticket.create({ data: { title: parsed.data.title, description: parsed.data.description, status: parsed.data.status, priority: parsed.data.priority, createdById: request.user!.id, assignedToId: parsed.data.assignedToId }, include: ticketInclude })
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
    const ticket = await db.ticket.update({ where: { id: existing.id }, data: parsed.data, include: ticketInclude })
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
    await db.ticket.delete({ where: { id: existing.id } })
    response.status(204).send()
  }))

  app.get('/api/dashboard', authMiddleware, asyncHandler(async (request, response) => {
    const dashboard = await getDashboardData(db, request)
    response.json(dashboard)
  }))

  app.use((_request, response) => response.status(404).json({ error: 'Not found' }))
  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    void next
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
