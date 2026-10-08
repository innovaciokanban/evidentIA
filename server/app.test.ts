import bcrypt from 'bcryptjs'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp, swotFingerprint } from './app.js'
import { envSchema } from './env.js'
import { AIService, AIServiceError, resolveWeightingBand, type CheckyContext } from './ai-service.js'
import { dashboardScopesFor } from './dashboard-service.js'
import { WEIGHTING_LEVEL_SCORE } from './weighting-service.js'
import { strategySourceRef } from './strategy-weighting-service.js'
import { aiAnalysisSchema, buildCheckyConsultSchema, companyCreateSchema, companyUpdateSchema, crossWeightingSchema, diagnosticCreateSchema, diagnosticUpdateSchema, loginSchema, processCreateSchema, processUpdateSchema, swotItemCreateSchema, swotItemUpdateSchema, ticketCreateSchema, ticketUpdateSchema, userCreateSchema } from './validation.js'

const companyId = 'cmcompany00000000000000001'
const otherCompanyId = 'cmcompany00000000000000002'
const admin = { id: 'cmadmin000000000000000001', email: 'admin@test.local', name: 'Admin Test', role: 'SUPERUSER' as Role, companyId: null }
const member = { id: 'cmmember00000000000000001', email: 'member@test.local', name: 'Member Test', role: 'COMPANY_ADMIN' as Role, companyId }
const companyUser = { id: 'cmcompanyuser0000000000001', email: 'company@test.local', name: 'Company User', role: 'COMPANY_USER' as Role, companyId }
const otherCompanyUser = { id: 'cmotheruser00000000000001', email: 'other@test.local', name: 'Other User', role: 'COMPANY_USER' as Role, companyId: otherCompanyId }
const ticket = {
  id: 'cmticket00000000000000001', title: 'Revisar propuesta', description: 'Validar la propuesta comercial', status: 'OPEN' as const, priority: 'HIGH' as const,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'), createdBy: member, assignedTo: null,
}
const company = {
  id: companyId, name: 'Acme Consultores', identification: '900123456-7', industry: 'Servicios', description: 'Empresa de consultoría estratégica',
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'), users: [member],
}
const processFixture = {
  id: 'cmprocess000000000000000001', companyId: companyId, name: 'Gestión Comercial', code: 'PROC-01', type: 'MISSIONAL' as const,
  version: null, frequency: null, organizationalArea: null, supervision: null, deliveryMethod: null, executionType: null,
  objective: 'Gestionar las oportunidades comerciales', description: 'Proceso existente', status: 'ACTIVE' as const,
  thirdPartyProvided: false, critical: false, cashMovement: false, contingencyPlan: false, taxOperations: false, affectsAccounting: false, personalData: false,
  responsibleId: member.id, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'),
}
const diagnostic = {
  id: 'cmdiagnostic000000000000001', companyId: company.id, title: 'Diagnóstico inicial', description: 'Revisión general de la operación', status: 'DRAFT' as const, createdById: member.id,
  createdAt: new Date('2026-01-03'), updatedAt: new Date('2026-01-03'), company: { id: company.id, name: company.name }, createdBy: member,
  swotAnalysis: { id: 'cmswot000000000000000001', diagnosticId: 'cmdiagnostic000000000000001', createdAt: new Date('2026-01-03'), updatedAt: new Date('2026-01-03'), items: [] },
}
const swotItem = { id: 'cmswotitem0000000000000001', swotId: diagnostic.swotAnalysis.id, type: 'STRENGTH' as const, description: 'Equipo comprometido', priority: 'HIGH' as const, impact: 'HIGH' as const, createdAt: new Date('2026-01-04') }
const aiResult = {
  executiveSummary: 'La empresa cuenta con capacidades internas sólidas y oportunidades de mejora.',
  diagnosis: 'La información indica una operación con fortalezas aprovechables.',
  // La inferencia cita el factor del que se apoya. El id es lo que se guarda; lo que se muestra es
  // "Fortaleza: Equipo comprometido", y eso lo arma la vista contra la matriz.
  keyFindings: [{ finding: 'Equipo comprometido', basis: 'FACT' as const, evidenceIds: [swotItem.id], interpretation: 'Esta capacidad interna puede sostener la ejecución de las prioridades.' }],
  foStrategies: ['Usar el compromiso del equipo para capturar oportunidades.'],
  doStrategies: ['Mejorar procesos para aprovechar oportunidades.'],
  faStrategies: ['Apoyarse en el equipo para mitigar amenazas.'],
  daStrategies: ['Reducir debilidades frente a amenazas identificadas.'],
  priorityRisks: ['Dependencia de procesos manuales.'],
  priorityOpportunities: ['Mejora de la operación.'],
  recommendations: [{ title: 'Priorizar procesos', description: 'Documentar el proceso principal.', priority: 'HIGH' as const, expectedImpact: 'Mayor consistencia operativa.', suggestedAction: 'Definir responsables y fechas.' }],
}
/** La lectura guardada dice qué matriz leyó. El diagnóstico por defecto no tiene factores, así que
 *  esta es la huella de una matriz vacía: mientras la matriz no cambie, lo guardado está vigente y
 *  Checky lo reutiliza. Los tests que siembran una matriz con factores guardan su propia huella. */
const persistedAIAnalysis = { id: 'cmaianalysis000000000000001', diagnosticId: diagnostic.id, ...aiResult, swotFingerprint: swotFingerprint([]), createdAt: new Date('2026-01-05'), updatedAt: new Date('2026-01-05') }
const recommendation = {
  id: 'cmrecommendation0000000001', diagnosticId: diagnostic.id, title: aiResult.recommendations[0].title, description: aiResult.recommendations[0].description, priority: aiResult.recommendations[0].priority, expectedImpact: aiResult.recommendations[0].expectedImpact, suggestedAction: aiResult.recommendations[0].suggestedAction, status: 'PENDING' as const,
  createdAt: new Date('2026-01-06'), updatedAt: new Date('2026-01-06'),
}
const actionPlan = {
  id: 'cmactionplan000000000001', diagnosticId: diagnostic.id, title: 'Plan de mejora 2026', description: 'Acciones para fortalecer la operación', status: 'ACTIVE' as const, createdById: member.id,
  createdAt: new Date('2026-01-07'), updatedAt: new Date('2026-01-07'),
}
const actionItem = {
  id: 'cmactionitem000000000001', actionPlanId: actionPlan.id, recommendationId: recommendation.id, title: 'Documentar proceso principal', description: 'Definir el flujo operativo', priority: 'HIGH' as const, status: 'PENDING' as const, responsibleId: member.id, dueDate: new Date('2026-03-01'),
  createdAt: new Date('2026-01-08'), updatedAt: new Date('2026-01-08'),
}
const strategicCrossFixture = {
  id: 'cmcross000000000000000001', diagnosticId: diagnostic.id, crossType: 'FO' as const, origin: 'USER' as const,
  factor1Id: 'cmfactor100000000000000001', factor2Id: 'cmfactor200000000000000001',
  strategy: 'Usar la fortaleza para capturar la oportunidad', aiAnalysis: null, priority: null, createdById: member.id,
  createdAt: new Date('2026-01-08'), updatedAt: new Date('2026-01-08'),
}
const crossWeightingFixture = {
  id: 'cmweighting0000000000000001', crossId: strategicCrossFixture.id,
  impactoEstrategico: 'ALTO' as const, viabilidad: 'MEDIO' as const, urgencia: 'MUY_ALTO' as const,
  sinergiaInterna: 'BAJO' as const, impactoReputacional: 'MEDIO' as const,
  weightedScore: 3.45, createdById: member.id, createdAt: new Date('2026-01-10'), updatedAt: new Date('2026-01-10'),
}

/** Ponderación consolidada de una estrategia que no es un cruce, con su ancla por hash del texto. */
const strategyWeightingFixture = {
  id: 'cmstrategyweighting0001', diagnosticId: diagnostic.id,
  source: 'AI_ANALYSIS' as const, sourceRef: 'origen',
  impactoEstrategico: 'ALTO' as const, viabilidad: 'MEDIO' as const, urgencia: 'MUY_ALTO' as const,
  sinergiaInterna: 'BAJO' as const, impactoReputacional: 'MEDIO' as const,
  weightedScore: 3.45, createdById: member.id, createdAt: new Date('2026-01-10'), updatedAt: new Date('2026-01-10'),
}
const checkySessionFixture = {
  id: 'cmcheckysession00000000001', diagnosticId: diagnostic.id, title: 'Revisión DOFA', createdById: member.id,
  createdAt: new Date('2026-01-09'), updatedAt: new Date('2026-01-09'),
}
const checkyMessageFixture = {
  id: 'cmcheckymessage0000000001', sessionId: checkySessionFixture.id, role: 'USER' as const, content: '¿Qué debo revisar?',
  category: null, basis: null, evidenceIds: [] as string[], insufficientData: false, missingInformation: [] as string[],
  status: null, decisionNote: null, createdAt: new Date('2026-01-09'),
}
  const checkyFactorIds = { strength: 'cmswotitem0000000000000001', opportunity: 'cmopportunity00000000001' }
  const checkySwotItemFixtures = {
    strength: { id: checkyFactorIds.strength, type: 'STRENGTH' as const, description: 'Equipo comprometido' },
    opportunity: { id: checkyFactorIds.opportunity, type: 'OPPORTUNITY' as const, description: 'Mercado en expansión' },
    sameQuadrant: { id: 'cmdebilidad000000000000000001', type: 'STRENGTH' as const, description: 'Procesos lentos' },
    foreign: { id: 'cmoportunidade00000000001', type: 'OPPORTUNITY' as const, description: 'Demanda de otra empresa' },
    // La pareja DOFA necesita los cuatro cuadrantes reales: debilidad y amenaza para poder armar
    // las estrategias DA y DO sin apoyarse en un factor que en realidad es una fortaleza.
    weakness: { id: 'cmdebilidaddo000000000000001', type: 'WEAKNESS' as const, description: 'Procesos manuales sin documentar' },
    threat: { id: 'cmamenazada00000000000000001', type: 'THREAT' as const, description: 'Normativa nueva del sector' },
  }
  type WeightingLevelSeed = 'MUY_BAJO' | 'BAJO' | 'MEDIO' | 'ALTO' | 'MUY_ALTO'
  /**
   * Cruce tal como lo devuelve Prisma cuando Checky pide factor1, factor2 y weighting. Los factores
   * se resuelven por id desde los fixtures, así que un id desconocido queda como UNKNOWN.
   */
  type SeededCross = {
    id: string
    crossType: 'FO' | 'DO' | 'FA' | 'DA'
    origin: 'USER' | 'AI'
    factor1Id: string
    factor2Id: string
    strategy: string | null
    /** Decisión tomada sobre la estrategia en Checky. Sin campo, el cruce sigue sin decidir. */
    strategyStatus?: 'PENDING' | 'ACCEPTED' | 'REJECTED' | null
    weighting?: {
      impactoEstrategico: WeightingLevelSeed
      viabilidad: WeightingLevelSeed
      urgencia: WeightingLevelSeed
      sinergiaInterna: WeightingLevelSeed
      impactoReputacional: WeightingLevelSeed
      weightedScore: number
    } | null
  }
  const seededFactor = (id: string) => {
    const match = Object.values(checkySwotItemFixtures).find((item) => item.id === id)
    return { id, type: match?.type ?? 'UNKNOWN', description: match?.description ?? '', createdAt: new Date('2026-01-04') }
  }
  const checkySuggestedStrategyFixture = {
  title: 'Llevar el equipo comprometido a la expansión del mercado',
  description: 'Asignar al equipo comprometido la apertura de cuentas en el mercado en expansión, empezando por los clientes que ya conocen su trabajo.',
}
const checkyConsultResult = {
  reply: 'El diagnóstico cubre fortalezas y oportunidades, pero aún no hay cruces que las conecten.',
  insufficientData: false,
  missingInformation: [],
  findings: [
    { category: 'MISSING_CROSSES' as const, title: 'Falta el cruce FO', detail: 'No existe ningún cruce entre la fortaleza registrada y la oportunidad detectada.', basis: 'FACT' as const, evidenceIds: [checkyFactorIds.strength, checkyFactorIds.opportunity], suggestedStrategy: checkySuggestedStrategyFixture },
    { category: 'STRATEGIC_RISKS' as const, title: 'Cobertura de amenazas', detail: 'No hay amenazas registradas que permita evaluar el riesgo.', basis: 'INFERENCE' as const, evidenceIds: [], suggestedStrategy: null },
  ],
}
const checkyInsufficientResult = {
  reply: 'No es posible concluir con la información disponible.',
  insufficientData: true,
  missingInformation: ['No hay amenazas registradas en la matriz DOFA.'],
  findings: [],
}

function makeDb(role: Role = 'SUPERUSER', ticketOwnerId = member.id, ticketAssigneeId: string | null = null, userCompanyId: string | null = company.id, existingRecommendations: typeof recommendation[] = [], seededCrosses: SeededCross[] = []) {
  const currentUser = role === 'SUPERUSER' ? admin : { ...member, role, companyId: userCompanyId }
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  const users = [admin, member, companyUser, otherCompanyUser]
  let sessionActive = false
  let storedRecommendations: typeof recommendation[] = existingRecommendations
  type StoredTicket = { id: string; title: string; description: string; status: string; priority: string; createdById: string; assignedToId: string | null; actionItemId: string | null; dueDate: Date | null }
  let storedTickets: StoredTicket[] = []
  let storedCheckyMessages: typeof checkyMessageFixture[] = []
  /** A qué diagnóstico pertenece cada sesión, que es el filtro que usa la priorización. */
  let storedCheckySessionOwners: Record<string, string> = { [checkySessionFixture.id]: diagnostic.id }
  let storedCrossWeightings: typeof crossWeightingFixture[] = []
  let storedStrategyWeightings: typeof strategyWeightingFixture[] = []
  let storedProcesses: typeof processFixture[] = [processFixture]
  const ownSwotItem = (item: { id: string; type: string; description: string }) => ({ ...item, swotId: diagnostic.swotAnalysis.id, createdAt: new Date('2026-01-04'), swot: { diagnosticId: diagnostic.id } })
  const storedSwotItems = [
    ownSwotItem(checkySwotItemFixtures.strength),
    ownSwotItem(checkySwotItemFixtures.opportunity),
    ownSwotItem(checkySwotItemFixtures.sameQuadrant),
    ownSwotItem(checkySwotItemFixtures.weakness),
    ownSwotItem(checkySwotItemFixtures.threat),
    { ...checkySwotItemFixtures.foreign, swotId: 'cmswototro0000000000000001', createdAt: new Date('2026-01-04'), swot: { diagnosticId: 'cmdiagnosticotro00000000001' } },
  ]
  const normalizeTicket = (stored: StoredTicket, ownerId: string, assigneeId: string | null) => {
    const owner = users.find((user) => user.id === ownerId) ?? member
    const assignee = assigneeId ? users.find((user) => user.id === assigneeId) ?? null : null
    return { ...stored, createdById: owner.id, assignedToId: assigneeId, createdBy: { id: owner.id, name: owner.name, email: owner.email, companyId: owner.companyId }, assignedTo: assignee ? { id: assignee.id, name: assignee.name, email: assignee.email, companyId: assignee.companyId } : null }
  }
  const db = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        if (where.email) return where.email === currentUser.email ? { ...currentUser, passwordHash } : null
        const match = users.find((user) => user.id === where.id)
        return match ? { ...match, passwordHash } : null
      }),
      findMany: vi.fn(async ({ select }: { select?: { id?: true; name?: true; email?: true; role?: true; companyId?: true } }) => users.map((user) => ({
        id: user.id,
        name: user.name,
        ...(select?.email ? { email: user.email } : {}),
        ...(select?.role ? { role: user.role } : {}),
        ...(select?.companyId ? { companyId: user.companyId } : {}),
      }))),
      create: vi.fn(async ({ data }: { data: { name: string; email: string; role: Role; companyId: string | null } }) => ({ id: 'cmnewuser0000000000000001', name: data.name, email: data.email, role: data.role, companyId: data.companyId })),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { name?: string; email?: string; role?: Role; companyId?: string | null } }) => {
        const base = users.find((user) => user.id === where.id) ?? member
        return { id: base.id, name: data.name ?? base.name, email: data.email ?? base.email, role: data.role ?? base.role, companyId: data.companyId !== undefined ? data.companyId : base.companyId }
      }),
      delete: vi.fn(),
    },
    session: {
      create: vi.fn(async () => { sessionActive = true; return { id: 'session-1', expiresAt: new Date(Date.now() + 86400000) } }),
      findUnique: vi.fn(async () => sessionActive ? ({ id: 'session-1', expiresAt: new Date(Date.now() + 86400000), user: currentUser }) : null),
      delete: vi.fn(),
      deleteMany: vi.fn(async () => { sessionActive = false; return { count: 1 } }),
    },
    ticket: {
      create: vi.fn(async ({ data }: { data: { title: string; description: string; status?: string; priority?: string; assignedToId?: string | null; createdById?: string; actionItemId?: string | null; dueDate?: Date | null } }) => {
        const owner = users.find((user) => user.id === (data.createdById ?? currentUser.id)) ?? member
        const createdTicket: StoredTicket = {
          ...ticket as unknown as StoredTicket,
          id: `cmticketauto${String(storedTickets.length + 1).padStart(10, '0')}`,
          title: data.title,
          description: data.description,
          status: data.status ?? 'OPEN',
          priority: data.priority ?? 'MEDIUM',
          createdById: owner.id,
          assignedToId: data.assignedToId ?? null,
          actionItemId: data.actionItemId ?? null,
          dueDate: data.dueDate ?? null,
        }
        storedTickets = [createdTicket, ...storedTickets]
        return normalizeTicket(createdTicket, owner.id, createdTicket.assignedToId)
      }),
      findUnique: vi.fn(async ({ where }: { where: { id?: string; actionItemId?: string } }) => {
        if (where.actionItemId) {
          const linked = storedTickets.find((stored) => stored.actionItemId === where.actionItemId)
          return linked ? normalizeTicket(linked, linked.createdById, linked.assignedToId) : null
        }
        const stored = storedTickets.find((stored) => stored.id === where.id)
        if (stored) return normalizeTicket(stored, stored.createdById, stored.assignedToId)
        const owner = users.find((user) => user.id === ticketOwnerId) ?? member
        const assignee = users.find((user) => user.id === ticketAssigneeId) ?? null
        const ownerView = { id: owner.id, name: owner.name, email: owner.email, companyId: owner.companyId }
        const assigneeView = assignee ? { id: assignee.id, name: assignee.name, email: assignee.email, companyId: assignee.companyId } : null
        return { ...ticket, createdById: ticketOwnerId, assignedToId: ticketAssigneeId, actionItemId: null, dueDate: null, createdBy: ownerView, assignedTo: assigneeView }
      }),
      findMany: vi.fn(async () => storedTickets.length > 0 ? storedTickets.map((stored) => normalizeTicket(stored, stored.createdById, stored.assignedToId)) : [ticket]),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const linked = storedTickets.find((stored) => stored.id === where.id)
        if (linked) {
          storedTickets = storedTickets.map((stored) => stored.id === where.id ? { ...stored, ...data } : stored)
        }
        return { ...(ticket), ...data, createdBy: member, assignedTo: null }
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        storedTickets = storedTickets.filter((stored) => stored.id !== where.id)
        return { id: where.id }
      }),
      count: vi.fn(async () => 1),
    },
    company: {
      create: vi.fn(async () => ({ ...company, users: company.users })),
      findUnique: vi.fn(async () => ({ ...company, users: company.users })),
      findMany: vi.fn(async () => [{ ...company, users: company.users }]),
      update: vi.fn(async () => ({ ...company, name: 'Acme Actualizada', users: company.users })),
      delete: vi.fn(),
      count: vi.fn(async () => 1),
    },
    process: {
      findMany: vi.fn(async ({ where }: { where?: { companyId?: string } } = {}) => storedProcesses.filter((item) => !where?.companyId || item.companyId === where.companyId).map((item) => ({ ...item, company: { id: item.companyId }, responsible: item.responsibleId === member.id ? { id: member.id, name: member.name } : null }))),
      findFirst: vi.fn(async ({ where }: { where: { companyId: string; name: string; NOT?: { id: string } } }) => storedProcesses.find((item) => item.companyId === where.companyId && item.name === where.name && item.id !== where.NOT?.id) ? { id: 'duplicate' } : null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const item = storedProcesses.find((process) => process.id === where.id)
        return item ? { ...item, company: { id: item.companyId }, responsible: item.responsibleId === member.id ? { id: member.id, name: member.name } : null } : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { ...processFixture, ...data, id: `cmprocesscreated${String(storedProcesses.length).padStart(10, '0')}`, createdAt: new Date('2026-02-01'), updatedAt: new Date('2026-02-01') } as typeof processFixture
        storedProcesses = [created, ...storedProcesses]
        return { ...created, company: { id: created.companyId }, responsible: created.responsibleId === member.id ? { id: member.id, name: member.name } : null }
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const current = storedProcesses.find((item) => item.id === where.id) ?? processFixture
        const updated = { ...current, ...data, updatedAt: new Date('2026-02-02') } as typeof processFixture
        storedProcesses = storedProcesses.map((item) => item.id === where.id ? updated : item)
        return { ...updated, company: { id: updated.companyId }, responsible: updated.responsibleId === member.id ? { id: member.id, name: member.name } : null }
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => { storedProcesses = storedProcesses.filter((item) => item.id !== where.id); return { id: where.id } }),
    },
    qualityDiagnostic: {
      create: vi.fn(async () => ({ ...diagnostic, company: { ...diagnostic.company }, swotAnalysis: { ...diagnostic.swotAnalysis, items: [] } })),
      findUnique: vi.fn(async () => ({ ...diagnostic, company: { ...diagnostic.company }, swotAnalysis: { ...diagnostic.swotAnalysis, items: [] } })),
      findMany: vi.fn(async () => [{ ...diagnostic, company: { ...diagnostic.company }, swotAnalysis: { ...diagnostic.swotAnalysis, items: [] } }]),
      update: vi.fn(async () => ({ ...diagnostic, title: 'Diagnóstico actualizado', company: { ...diagnostic.company }, swotAnalysis: { ...diagnostic.swotAnalysis, items: [] } })),
      delete: vi.fn(),
      count: vi.fn(async () => 2),
    },
    sWOTItem: {
      create: vi.fn(async ({ data }: { data: { type: string; description: string } }) => ({ ...swotItem, type: data.type as 'STRENGTH', description: data.description, swot: { diagnostic: { companyId: company.id, company: { id: company.id, name: company.name } } } })),
      findUnique: vi.fn(async () => ({ ...swotItem, swot: { diagnostic: { companyId: company.id, company: { id: company.id, name: company.name } } } })),
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] }; swot?: { diagnosticId: string } } }) => {
        const wanted = where.id?.in ?? []
        const diagnosticId = where.swot?.diagnosticId
        return storedSwotItems.filter((item) => (wanted.length === 0 || wanted.includes(item.id)) && (diagnosticId ? item.swot.diagnosticId === diagnosticId : true))
      }),
      update: vi.fn(async () => ({ ...swotItem, description: 'Factor actualizado', swot: { diagnostic: { companyId: company.id, company: { id: company.id, name: company.name } } } })),
      delete: vi.fn(),
    },
    aIAnalysis: {
      upsert: vi.fn(async () => persistedAIAnalysis),
      findUnique: vi.fn(async () => persistedAIAnalysis),
    },
    recommendation: {
      findMany: vi.fn(async () => storedRecommendations),
      findUnique: vi.fn(async () => ({ ...recommendation, diagnostic: { company: { id: company.id, name: company.name } } })),
      create: vi.fn(async ({ data }: { data: { title: string } }) => { const created = { ...recommendation, title: data.title }; storedRecommendations = [created, ...storedRecommendations]; return created }),
      update: vi.fn(async () => ({ ...recommendation, status: 'ACCEPTED', diagnostic: { company: { id: company.id, name: company.name } } })),
      count: vi.fn(async () => 1),
    },
    actionPlan: {
      findMany: vi.fn(async () => [{ ...actionPlan, createdBy: member, items: [] }]),
      findUnique: vi.fn(async () => ({ ...actionPlan, createdBy: member, items: [], diagnostic: { companyId: company.id, company: { id: company.id, name: company.name } } })),
      create: vi.fn(async () => ({ ...actionPlan, createdBy: member, items: [] })),
      update: vi.fn(async () => ({ ...actionPlan, status: 'COMPLETED', createdBy: member, items: [] })),
      delete: vi.fn(),
      count: vi.fn(async () => 1),
    },
    actionItem: {
      findMany: vi.fn(async () => [{ ...actionItem, actionPlan: { id: actionPlan.id, title: actionPlan.title, diagnostic: { id: diagnostic.id, title: diagnostic.title, company: { id: company.id, name: company.name } } }, responsible: member }]),
      findUnique: vi.fn(async () => ({ ...actionItem, actionPlan: { diagnosticId: actionPlan.id, diagnostic: { companyId: company.id, company: { id: company.id, name: company.name } } }, recommendation: { id: recommendation.id, title: recommendation.title, priority: recommendation.priority, status: recommendation.status }, responsible: member })),
      create: vi.fn(async () => ({ ...actionItem, recommendation: { id: recommendation.id, title: recommendation.title, priority: recommendation.priority, status: recommendation.status }, responsible: member })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...actionItem, ...data, recommendation: { id: recommendation.id, title: recommendation.title, priority: recommendation.priority, status: recommendation.status }, responsible: member })),
      delete: vi.fn(),
      count: vi.fn(async () => 1),
    },
    strategicCross: {
      findUnique: vi.fn(async () => null),
      // Por defecto sigue vacío, como antes; los tests de Checky siembran cruces con ponderación.
      findMany: vi.fn(async () => seededCrosses.map((cross) => ({
        ...strategicCrossFixture,
        ...cross,
        diagnosticId: diagnostic.id,
        aiAnalysis: null,
        priority: null,
        createdById: member.id,
        createdAt: new Date('2026-01-08'),
        updatedAt: new Date('2026-01-08'),
        factor1: seededFactor(cross.factor1Id),
        factor2: seededFactor(cross.factor2Id),
        // Lo que ya se ponderó (desde Ponderación o desde la matriz DOFA) gana sobre la siembra:
        // es la única fila de ponderación que tiene el cruce.
        weighting: storedCrossWeightings.find((weighting) => weighting.crossId === cross.id) ?? (cross.weighting ? { id: `cmweighting${cross.id}`, crossId: cross.id, ...cross.weighting, createdById: member.id, createdAt: new Date('2026-01-10'), updatedAt: new Date('2026-01-10') } : null),
      }))),
      create: vi.fn(async ({ data }: { data: { crossType: string; factor1Id: string; factor2Id: string; strategy: string | null } }) => ({
        ...strategicCrossFixture,
        crossType: data.crossType as 'FO',
        factor1Id: data.factor1Id,
        factor2Id: data.factor2Id,
        strategy: data.strategy,
        factor1: { id: data.factor1Id, swotId: diagnostic.swotAnalysis.id, type: 'STRENGTH' as const, description: 'Equipo comprometido', createdAt: new Date('2026-01-04') },
        factor2: { id: data.factor2Id, swotId: diagnostic.swotAnalysis.id, type: 'OPPORTUNITY' as const, description: 'Nuevo mercado', createdAt: new Date('2026-01-04') },
      })),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        ...strategicCrossFixture,
        ...data,
        id: where.id,
        factor1: { id: strategicCrossFixture.factor1Id, swotId: diagnostic.swotAnalysis.id, type: 'STRENGTH' as const, description: 'Equipo comprometido', createdAt: new Date('2026-01-04') },
        factor2: { id: strategicCrossFixture.factor2Id, swotId: diagnostic.swotAnalysis.id, type: 'OPPORTUNITY' as const, description: 'Nuevo mercado', createdAt: new Date('2026-01-04') },
      })),
      delete: vi.fn(),
      count: vi.fn(async () => 1),
    },
    strategicCrossWeighting: {
      upsert: vi.fn(async ({ where, create, update }: { where: { crossId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = storedCrossWeightings.find((weighting) => weighting.crossId === where.crossId)
        if (existing) {
          const merged = { ...existing, ...update, updatedAt: new Date('2026-02-01') } as typeof crossWeightingFixture
          storedCrossWeightings = storedCrossWeightings.map((weighting) => weighting.crossId === where.crossId ? merged : weighting)
          return merged
        }
        const created = { ...crossWeightingFixture, ...create, updatedAt: new Date('2026-01-10') } as typeof crossWeightingFixture
        storedCrossWeightings = [...storedCrossWeightings, created]
        return created
      }),
      findUnique: vi.fn(async ({ where }: { where: { crossId: string } }) => storedCrossWeightings.find((weighting) => weighting.crossId === where.crossId) ?? null),
      // Respeta el orderBy para que el orden por ponderado se pueda verificar de verdad.
      findMany: vi.fn(async ({ orderBy }: { orderBy?: Array<{ weightedScore?: 'asc' | 'desc' }> } = {}) => {
        const direction = orderBy?.[0]?.weightedScore === 'asc' ? 1 : -1
        return [...storedCrossWeightings].sort((left, right) => direction * (left.weightedScore - right.weightedScore))
      }),
    },
    strategyWeighting: {
      // El identificador de la combinación que la API usa en el upsert.
      upsert: vi.fn(async ({ where, create, update }: { where: { diagnosticId: string; source: string; sourceRef: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const same = (row: { diagnosticId: string; source: string; sourceRef: string }) => row.diagnosticId === where.diagnosticId && row.source === where.source && row.sourceRef === where.sourceRef
        const existing = storedStrategyWeightings.find(same)
        if (existing) {
          const merged = { ...existing, ...update, updatedAt: new Date('2026-02-01') } as typeof strategyWeightingFixture
          storedStrategyWeightings = storedStrategyWeightings.map((row) => same(row) ? merged : row)
          return merged
        }
        const created = { ...strategyWeightingFixture, ...create, createdAt: new Date('2026-01-10'), updatedAt: new Date('2026-01-10') } as typeof strategyWeightingFixture
        storedStrategyWeightings = [...storedStrategyWeightings, created]
        return created
      }),
      // Acotado al diagnóstico de la consulta, que es el aislamiento de esta tabla.
      findMany: vi.fn(async ({ where }: { where?: { diagnosticId?: string } } = {}) => storedStrategyWeightings.filter((row) => (where?.diagnosticId ? row.diagnosticId === where.diagnosticId : true))),
    },
    checkySession: {
      create: vi.fn(async ({ data }: { data: { diagnosticId: string; title: string | null; createdById: string } }) => {
        const id = `cmcheckysess${String(Object.keys(storedCheckySessionOwners).length).padStart(8, '0')}`
        storedCheckySessionOwners[id] = data.diagnosticId
        return { ...checkySessionFixture, id, diagnosticId: data.diagnosticId, title: data.title, createdById: data.createdById }
      }),
      findMany: vi.fn(async () => [checkySessionFixture]),
      findUnique: vi.fn(async () => ({ ...checkySessionFixture, diagnostic: { ...diagnostic, company: { id: company.id, name: company.name } } })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...checkySessionFixture, ...data })),
    },
    checkyMessage: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { ...checkyMessageFixture, ...data, id: `cmcheckymsg${String(storedCheckyMessages.length + 1).padStart(12, '0')}`, createdAt: new Date(Date.now() + storedCheckyMessages.length) }
        storedCheckyMessages = [...storedCheckyMessages, created]
        return created
      }),
      findMany: vi.fn(async ({ where }: { where?: { role?: string; status?: string; session?: { diagnosticId?: string } } } = {}) => {
        // El filtro por rol, estado y diagnóstico es el que aplica la priorización para leer solo lo
        // aceptado de esta empresa; el resto de llamadas siguen recibiendo todo lo almacenado.
        return storedCheckyMessages.filter((message) => {
          const record = message as unknown as { role?: string; status?: string | null; sessionId?: string }
          if (where?.role && record.role !== where.role) return false
          if (where?.status && record.status !== where.status) return false
          if (where?.session?.diagnosticId) {
            const owner = storedCheckySessionOwners[record.sessionId ?? '']
            if (owner !== where.session.diagnosticId) return false
          }
          return true
        })
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => storedCheckyMessages.find((message) => message.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        storedCheckyMessages = storedCheckyMessages.map((message) => message.id === where.id ? { ...message, ...data } : message)
        return storedCheckyMessages.find((message) => message.id === where.id) as typeof checkyMessageFixture
      }),
    },
  }
  // Interactive transaction: the same client is handed to the callback, and the message store is
  // rolled back when the callback throws so atomicity is actually observable in tests.
  ;(db as unknown as { $transaction: unknown }).$transaction = async (callback: (tx: unknown) => unknown) => {
    const messagesBefore = storedCheckyMessages
    try {
      return await callback(db as never)
    } catch (error) {
      storedCheckyMessages = messagesBefore
      throw error
    }
  }
  return db as unknown as PrismaClient
}

describe('validation schemas', () => {
  it('rejects short passwords and malformed tickets', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'short' }).success).toBe(false)
    expect(ticketCreateSchema.safeParse({ title: 'x', description: '' }).success).toBe(false)
    expect(ticketUpdateSchema.safeParse({}).success).toBe(false)
    expect(companyCreateSchema.safeParse({ name: 'A', identification: '', industry: 'x', description: '' }).success).toBe(false)
    expect(companyCreateSchema.safeParse({ name: 'Acme', identification: '900123', industry: 'Servicios', description: 'Empresa', admin: { name: 'Ana', email: 'ana@test.local', password: 'Password123!' } }).success).toBe(true)
    expect(companyCreateSchema.safeParse({ name: 'Acme', identification: '900123', industry: 'Servicios', description: 'Empresa', admin: { name: 'Ana', email: 'malformed', password: 'Password123!' } }).success).toBe(false)
    expect(companyUpdateSchema.safeParse({ admin: { name: 'Ana', email: 'ana@test.local', password: 'Password123!' } }).success).toBe(false)
    expect(companyUpdateSchema.safeParse({}).success).toBe(false)
    expect(companyUpdateSchema.safeParse({ name: 'Acme Actualizada' }).success).toBe(true)
    expect(diagnosticCreateSchema.safeParse({ title: 'x', description: '' }).success).toBe(false)
    expect(diagnosticUpdateSchema.safeParse({}).success).toBe(false)
    expect(swotItemCreateSchema.safeParse({ type: 'UNKNOWN', description: '' }).success).toBe(false)
    expect(swotItemUpdateSchema.safeParse({}).success).toBe(false)
    expect(processCreateSchema.safeParse({ name: 'Proceso válido', type: 'MISSIONAL', objective: 'Objetivo válido', version: '1.0', critical: true }).success).toBe(true)
    expect(processUpdateSchema.safeParse({ frequency: null, personalData: true }).success).toBe(true)
    expect(processUpdateSchema.safeParse({}).success).toBe(false)
    expect(aiAnalysisSchema.safeParse(aiResult).success).toBe(true)
    expect(aiAnalysisSchema.safeParse({ ...aiResult, recommendations: [{ title: 'invalid' }] }).success).toBe(false)
  })

  it('accepts a CUID company id when creating a user', () => {
    expect(userCreateSchema.safeParse({ name: 'New user', email: 'new@test.local', password: 'Password123!', role: 'COMPANY_USER', companyId }).success).toBe(true)
  })

  it('accepts a UUID company id when creating a user', () => {
    expect(userCreateSchema.safeParse({ name: 'New user', email: 'new@test.local', password: 'Password123!', role: 'COMPANY_USER', companyId: '550e8400-e29b-41d4-a716-446655440000' }).success).toBe(true)
  })

  it('rejects invalid and empty company ids when creating a user', () => {
    const baseUser = { name: 'New user', email: 'new@test.local', password: 'Password123!', role: 'COMPANY_USER' as const }
    expect(userCreateSchema.safeParse({ ...baseUser, companyId: 'not-an-id' }).success).toBe(false)
    expect(userCreateSchema.safeParse({ ...baseUser, companyId: '' }).success).toBe(false)
  })
})

describe('environment validation', () => {
  it('rejects production startup with development default database and frontend values', () => {
    const result = envSchema.safeParse({ NODE_ENV: 'production' })
    expect(result.success).toBe(false)
  })

  it('accepts production startup with explicit database and frontend values', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db.prod:5432/kanban',
      FRONTEND_URL: 'https://app.example.com',
    })
    expect(result.success).toBe(true)
    expect(result.success ? result.data.TRUST_PROXY_HOPS : -1).toBe(0)
  })
})

describe('authentication and authorization API', () => {
  it('logs in, persists the session cookie, and returns the current user', async () => {
    const agent = request.agent(createApp(makeDb()))
    const login = await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    expect(login.status).toBe(200)
    expect(login.headers['set-cookie'][0]).toContain('HttpOnly')
    expect(login.headers['set-cookie'][0]).toContain('SameSite=Lax')
    expect(login.headers['set-cookie'][0]).not.toContain('Secure')
    expect(login.body.user).toMatchObject({ id: admin.id, role: 'SUPERUSER' })

    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe(admin.email)
  })

  it('does not reveal whether an account exists and blocks unauthorized roles', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_USER')))
    const invalid = await agent.post('/api/auth/login').send({ email: member.email, password: 'wrong-password' })
    expect(invalid.status).toBe(401)
    expect(invalid.body).toEqual({ error: 'Invalid email or password' })

    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const userCreate = await agent.post('/api/users').send({ name: 'New user', email: 'new@test.local', password: 'Password123!', role: 'COMPANY_ADMIN' })
    expect(userCreate.status).toBe(403)
  })

  it('returns the same error for a login with an unknown email', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_USER')))
    const response = await agent.post('/api/auth/login').send({ email: 'nobody@test.local', password: 'Password123!' })
    expect(response.status).toBe(401)
    expect(response.body).toEqual({ error: 'Invalid email or password' })
  })

  it('does not expose emails in the user directory', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_USER')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const list = await agent.get('/api/users')
    expect(list.status).toBe(200)
    expect(list.body.users[0]).toMatchObject({ id: admin.id, name: admin.name, role: 'SUPERUSER' })
    expect(list.body.users[0]).not.toHaveProperty('email')
  })

  it('sets basic security headers and disables response caching', async () => {
    const response = await request(createApp(makeDb())).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['x-frame-options']).toBe('DENY')
    expect(response.headers['referrer-policy']).toBe('no-referrer')
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers['x-powered-by']).toBeUndefined()
  })

  it('returns 400 for a malformed JSON body instead of 500', async () => {
    const response = await request(createApp(makeDb())).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": broken')
    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: 'Invalid JSON body' })
  })

  it('rejects protected resources without a session', async () => {
    const app = createApp(makeDb())
    const responses = await Promise.all([
      request(app).get('/api/auth/me'),
      request(app).get('/api/users'),
      request(app).get('/api/tickets'),
      request(app).get('/api/dashboard'),
      request(app).get('/api/processes'),
      request(app).post('/api/processes'),
      request(app).get('/api/companies'),
      request(app).get(`/api/companies/${company.id}/diagnostics`),
      request(app).get(`/api/diagnostics/${diagnostic.id}`),
      request(app).post(`/api/diagnostics/${diagnostic.id}/swot/items`),
      request(app).patch(`/api/swot/items/${swotItem.id}`),
      request(app).delete(`/api/swot/items/${swotItem.id}`),
      request(app).post(`/api/diagnostics/${diagnostic.id}/ai-analysis`),
      request(app).get(`/api/diagnostics/${diagnostic.id}/ai-analysis`),
      request(app).get(`/api/diagnostics/${diagnostic.id}/recommendations`),
      request(app).post(`/api/diagnostics/${diagnostic.id}/recommendations/import`),
      request(app).patch(`/api/recommendations/${recommendation.id}`),
      request(app).get(`/api/diagnostics/${diagnostic.id}/action-plans`),
      request(app).post(`/api/diagnostics/${diagnostic.id}/action-plans`),
      request(app).get(`/api/action-plans/${actionPlan.id}`),
      request(app).patch(`/api/action-plans/${actionPlan.id}`),
      request(app).post(`/api/action-plans/${actionPlan.id}/items`),
      request(app).patch(`/api/action-items/${actionItem.id}`),
      request(app).delete(`/api/action-items/${actionItem.id}`),
    ])
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401])
  })

  it('invalidates the session and cookie on logout', async () => {
    const agent = request.agent(createApp(makeDb()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    expect((await agent.get('/api/auth/me')).status).toBe(200)

    const logout = await agent.post('/api/auth/logout')
    expect(logout.status).toBe(204)
    expect(logout.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970')
    expect((await agent.get('/api/auth/me')).status).toBe(401)
  })
})

describe('users API', () => {
  it('lets a superuser create company users and admins but never another superuser', async () => {
    const agent = request.agent(createApp(makeDb()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const created = await agent.post('/api/users').send({ name: 'Nuevo Admin', email: 'nuevoadmin@test.local', password: 'Password123!', role: 'COMPANY_ADMIN', companyId: company.id })
    expect(created.status).toBe(201)
    expect(created.body.user.role).toBe('COMPANY_ADMIN')
    expect(created.body.user.companyId).toBe(company.id)

    const blockedSuperuser = await agent.post('/api/users').send({ name: 'Nuevo Súper', email: 'nuevosuper@test.local', password: 'Password123!', role: 'SUPERUSER' })
    expect(blockedSuperuser.status).toBe(403)
  })

  it('lets a company admin create users only in its own company and only as company users', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_ADMIN')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })

    const created = await agent.post('/api/users').send({ name: 'Nuevo Usuario', email: 'nuevo@test.local', password: 'Password123!', role: 'COMPANY_USER' })
    expect(created.status).toBe(201)
    expect(created.body.user.role).toBe('COMPANY_USER')
    expect(created.body.user.companyId).toBe(company.id)

    const otherAdmin = await agent.post('/api/users').send({ name: 'Otro Admin', email: 'otroadmin@test.local', password: 'Password123!', role: 'COMPANY_ADMIN', companyId: company.id })
    expect(otherAdmin.status).toBe(403)

    const otherCompany = await agent.post('/api/users').send({ name: 'Otra Empresa', email: 'otra@test.local', password: 'Password123!', role: 'COMPANY_USER', companyId: otherCompanyId })
    expect(otherCompany.status).toBe(403)
  })

  it('blocks company users from creating, updating or deleting users', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_USER')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })

    expect((await agent.post('/api/users').send({ name: 'Nuevo', email: 'nuevo@test.local', password: 'Password123!', role: 'COMPANY_USER', companyId: company.id })).status).toBe(403)
    expect((await agent.patch(`/api/users/${companyUser.id}`).send({ name: 'Intrusión' })).status).toBe(403)
    expect((await agent.delete(`/api/users/${companyUser.id}`)).status).toBe(403)
  })

  it('lets a company admin update and delete a company user of its own company', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_ADMIN')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })

    const updated = await agent.patch(`/api/users/${companyUser.id}`).send({ name: 'Renombrado' })
    expect(updated.status).toBe(200)
    expect(updated.body.user.name).toBe('Renombrado')
    expect((await agent.delete(`/api/users/${companyUser.id}`)).status).toBe(204)
  })

  it('blocks a company admin from updating or deleting users of another company', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_ADMIN', member.id, null, admin.id)))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })

    expect((await agent.patch(`/api/users/${companyUser.id}`).send({ name: 'Intrusión' })).status).toBe(404)
    expect((await agent.delete(`/api/users/${companyUser.id}`)).status).toBe(404)
  })

  it('lets a superuser change a user role and company but not promote to superuser', async () => {
    const agent = request.agent(createApp(makeDb()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const promoted = await agent.patch(`/api/users/${companyUser.id}`).send({ role: 'COMPANY_ADMIN' })
    expect(promoted.status).toBe(200)
    expect(promoted.body.user.role).toBe('COMPANY_ADMIN')
    expect(promoted.body.user.companyId).toBe(company.id)

    const blocked = await agent.patch(`/api/users/${companyUser.id}`).send({ role: 'SUPERUSER' })
    expect(blocked.status).toBe(403)
    expect((await agent.delete(`/api/users/${admin.id}`)).status).toBe(403)
  })
})

describe('tickets API', () => {
  it('creates and updates tickets for an authenticated user', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_USER')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const created = await agent.post('/api/tickets').send({ title: ticket.title, description: ticket.description, priority: 'HIGH' })
    expect(created.status).toBe(201)
    expect(created.body.ticket.title).toBe(ticket.title)

    const updated = await agent.patch(`/api/tickets/${ticket.id}`).send({ status: 'IN_PROGRESS' })
    expect(updated.status).toBe(200)
  })

  it('only allows company admins and superusers to assign tickets', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_USER')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const response = await agent.post('/api/tickets').send({ title: 'Assigned', description: 'Test assignment', assignedToId: member.id })
    expect(response.status).toBe(403)
  })

  it('lets a company admin assign a ticket to a user of the same company', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_ADMIN')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const created = await agent.post('/api/tickets').send({ title: ticket.title, description: ticket.description, priority: 'HIGH', assignedToId: companyUser.id })
    expect(created.status).toBe(201)

    const updated = await agent.patch(`/api/tickets/${ticket.id}`).send({ status: 'IN_PROGRESS', assignedToId: companyUser.id })
    expect(updated.status).toBe(200)
  })

  it('blocks a company admin from assigning a ticket to a user of another company', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_ADMIN', member.id, null, company.id)))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const assigned = await agent.post('/api/tickets').send({ title: ticket.title, description: ticket.description, assignedToId: otherCompanyUser.id })
    expect(assigned.status).toBe(403)

    const patched = await agent.patch(`/api/tickets/${ticket.id}`).send({ assignedToId: otherCompanyUser.id })
    expect(patched.status).toBe(403)
  })

  it('lets a superuser manage a ticket created by another user', async () => {
    const agent = request.agent(createApp(makeDb('SUPERUSER', member.id)))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    expect((await agent.get(`/api/tickets/${ticket.id}`)).status).toBe(200)
    expect((await agent.patch(`/api/tickets/${ticket.id}`).send({ status: 'CLOSED' })).status).toBe(200)
    expect((await agent.delete(`/api/tickets/${ticket.id}`)).status).toBe(204)
  })

  it('denies a user access to another user ticket by manipulating its ID', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_ADMIN', admin.id)))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    expect((await agent.get(`/api/tickets/${ticket.id}`)).status).toBe(404)
    expect((await agent.patch(`/api/tickets/${ticket.id}`).send({ title: 'Intrusión' })).status).toBe(404)
    expect((await agent.delete(`/api/tickets/${ticket.id}`)).status).toBe(404)
  })

  it('allows an assigned user to access and update an allowed ticket', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_USER', admin.id, member.id)))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    expect((await agent.get(`/api/tickets/${ticket.id}`)).status).toBe(200)
    expect((await agent.patch(`/api/tickets/${ticket.id}`).send({ status: 'IN_PROGRESS' })).status).toBe(200)
  })

  it('lets a user update their own ticket with the full frontend payload (no assignment field)', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_USER')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const updated = await agent.patch(`/api/tickets/${ticket.id}`).send({ title: ticket.title, description: ticket.description, priority: 'MEDIUM', status: 'RESOLVED' })
    expect(updated.status).toBe(200)
  })

  it('rejects assignment changes (even null) by company users', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_USER', admin.id, member.id)))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const response = await agent.patch(`/api/tickets/${ticket.id}`).send({ status: 'IN_PROGRESS', assignedToId: null })
    expect(response.status).toBe(403)
  })

  it('allows the creator to delete a ticket and protects inaccessible resources', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_USER')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const deleted = await agent.delete(`/api/tickets/${ticket.id}`)
    expect(deleted.status).toBe(204)
  })

  it('returns the scoped ticket list', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_USER')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const list = await agent.get('/api/tickets?status=OPEN')
    expect(list.status).toBe(200)
    expect(list.body.tickets).toHaveLength(1)
  })
})

describe('processes API', () => {
  it('creates, lists and updates a process with its characterization fields', async () => {
    const db = makeDb()
    const agent = request.agent(createApp(db))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const created = await agent.post('/api/processes').send({
      name: 'Gestión de proveedores', type: 'SUPPORT', objective: 'Asegurar proveedores adecuados', companyId: company.id,
      version: '2.1', frequency: 'Mensual', organizationalArea: 'Compras',
      supervision: 'Jefatura administrativa', deliveryMethod: 'Plataforma interna', executionType: 'Interna', responsibleId: member.id,
      critical: true, personalData: true,
    })
    expect(created.status).toBe(201)
    expect(created.body.process).toMatchObject({ version: '2.1', frequency: 'Mensual', critical: true, personalData: true })

    const listed = await agent.get('/api/processes')
    expect(listed.status).toBe(200)
    expect(listed.body.processes).toHaveLength(2)
    expect(listed.body.processes.some((item: { name: string }) => item.name === 'Gestión de proveedores')).toBe(true)

    const updated = await agent.patch(`/api/processes/${created.body.process.id}`).send({ type: 'STRATEGIC', frequency: 'Semanal', critical: false })
    expect(updated.status).toBe(200)
    expect(updated.body.process).toMatchObject({ type: 'STRATEGIC', frequency: 'Semanal', critical: false, personalData: true })

    expect((await agent.delete(`/api/processes/${created.body.process.id}`)).status).toBe(204)
    const afterDelete = await agent.get('/api/processes')
    expect(afterDelete.body.processes.some((item: { id: string }) => item.id === created.body.process.id)).toBe(false)
  })

  it('keeps existing process rows readable with safe default attributes', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_USER')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const response = await agent.get('/api/processes')
    expect(response.status).toBe(200)
    expect(response.body.processes[0]).toMatchObject({ name: processFixture.name, critical: false, personalData: false })
  })

  it('allows company admins to write only for their company and keeps company users read-only', async () => {
    const companyAdmin = request.agent(createApp(makeDb('COMPANY_ADMIN')))
    await companyAdmin.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    expect((await companyAdmin.post('/api/processes').send({ name: 'Proceso propio', type: 'SUPPORT', objective: 'Objetivo propio' })).status).toBe(201)

    const companyUser = request.agent(createApp(makeDb('COMPANY_USER')))
    await companyUser.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    expect((await companyUser.post('/api/processes').send({ name: 'No permitido', type: 'SUPPORT', objective: 'Objetivo' })).status).toBe(403)
    expect((await companyUser.patch(`/api/processes/${processFixture.id}`).send({ critical: true })).status).toBe(403)
    expect((await companyUser.delete(`/api/processes/${processFixture.id}`)).status).toBe(403)

    const foreignAdmin = request.agent(createApp(makeDb('COMPANY_ADMIN', member.id, null, otherCompanyId)))
    await foreignAdmin.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    expect((await foreignAdmin.get('/api/processes')).body.processes).toHaveLength(0)
    expect((await foreignAdmin.patch(`/api/processes/${processFixture.id}`).send({ critical: true })).status).toBe(404)
  })
})

describe('dashboard API', () => {
  it('returns quality metrics and lists for an authenticated superuser', async () => {
    const agent = request.agent(createApp(makeDb('SUPERUSER', member.id, null, member.id, [recommendation])))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const dashboard = await agent.get('/api/dashboard')
    expect(dashboard.status).toBe(200)
    expect(dashboard.body.summary).toEqual({
      totalCompanies: 1,
      totalDiagnostics: 2,
      draftDiagnostics: 2,
      inProgressDiagnostics: 2,
      completedDiagnostics: 2,
      pendingRecommendations: 1,
      activeActionPlans: 1,
      pendingActionItems: 1,
      overdueActionItems: 1,
    })
    expect(dashboard.body.recentDiagnostics).toHaveLength(1)
    expect(dashboard.body.priorityRecommendations).toHaveLength(1)
    expect(dashboard.body.upcomingActions).toHaveLength(1)
    expect(dashboard.body.recentCompanies).toHaveLength(1)
  })

  it('returns the same metrics for an authenticated user', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_ADMIN', member.id, null, member.id, [recommendation])))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const dashboard = await agent.get('/api/dashboard')
    expect(dashboard.status).toBe(200)
    expect(dashboard.body.summary.totalCompanies).toBe(1)
    expect(dashboard.body.recentDiagnostics[0].company.name).toBe(company.name)
    expect(dashboard.body.upcomingActions[0].responsible.name).toBe(member.name)
  })

  it('scopes dashboard metrics to the authenticated user company', async () => {
    const db = makeDb('COMPANY_ADMIN')
    const agent = request.agent(createApp(db))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    await agent.get('/api/dashboard')
    expect((db.company.count as unknown as { mock: { calls: Array<[{ where: unknown }]> } }).mock.calls[0][0]?.where).toEqual({ id: company.id })
    expect((db.qualityDiagnostic.count as unknown as { mock: { calls: Array<[{ where: unknown }]> } }).mock.calls[0][0]?.where).toEqual({ company: { id: company.id } })
    expect((db.recommendation.count as unknown as { mock: { calls: Array<[{ where: unknown }]> } }).mock.calls[0][0]?.where).toEqual({ AND: [{ diagnostic: { company: { id: company.id } } }, { status: 'PENDING' }] })
    expect((db.actionPlan.count as unknown as { mock: { calls: Array<[{ where: unknown }]> } }).mock.calls[0][0]?.where).toEqual({ AND: [{ diagnostic: { company: { id: company.id } } }, { status: 'ACTIVE' }] })
    expect((db.actionItem.count as unknown as { mock: { calls: Array<[{ where: unknown }]> } }).mock.calls[0][0]?.where).toEqual({ AND: [{ actionPlan: { diagnostic: { company: { id: company.id } } } }, { status: { in: ['PENDING', 'IN_PROGRESS'] } }] })
  })

  it('gives superusers a global scope on the dashboard', async () => {
    const db = makeDb()
    const agent = request.agent(createApp(db))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    await agent.get('/api/dashboard')
    expect((db.company.count as unknown as { mock: { calls: Array<[{ where: unknown }]> } }).mock.calls[0][0]?.where).toEqual({})
  })

  it('builds per-role scopes for dashboard queries', () => {
    expect(dashboardScopesFor({ user: admin } as never)).toEqual({ company: {}, diagnostic: {}, recommendation: {}, actionPlan: {}, actionItem: {} })
    expect(dashboardScopesFor({ user: member } as never)).toEqual({
      company: { id: company.id },
      diagnostic: { company: { id: company.id } },
      recommendation: { diagnostic: { company: { id: company.id } } },
      actionPlan: { diagnostic: { company: { id: company.id } } },
      actionItem: { actionPlan: { diagnostic: { company: { id: company.id } } } },
    })
  })
})

describe('companies API', () => {
  it('supports the complete CRUD flow for a superuser', async () => {
    const agent = request.agent(createApp(makeDb()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const created = await agent.post('/api/companies').send({ name: company.name, identification: company.identification, industry: company.industry, description: company.description })
    expect(created.status).toBe(201)
    expect(created.body.company.name).toBe(company.name)
    expect((await agent.get('/api/companies')).status).toBe(200)
    expect((await agent.get(`/api/companies/${company.id}`)).status).toBe(200)
    const updated = await agent.patch(`/api/companies/${company.id}`).send({ name: 'Acme Actualizada' })
    expect(updated.status).toBe(200)
    expect(updated.body.company.name).toBe('Acme Actualizada')
    expect((await agent.delete(`/api/companies/${company.id}`)).status).toBe(204)
  })

  it('creates a company with its first company admin in the same request', async () => {
    const db = makeDb()
    ;(db.company.create as unknown as { mockImplementation: (fn: (args: { data: { name: string; identification: string; industry: string; description: string; users?: { create?: { name: string; email: string; passwordHash: string; role: Role } } } }) => Promise<unknown>) => unknown }).mockImplementation(async ({ data }) => {
      const createdAdmin = data.users?.create
        ? { id: 'cmnewadmin000000000000001', name: data.users.create.name, email: data.users.create.email, role: data.users.create.role as Role, companyId }
        : undefined
      return { ...company, users: createdAdmin ? [createdAdmin] : company.users }
    })
    const agent = request.agent(createApp(db))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const created = await agent.post('/api/companies').send({ name: company.name, identification: company.identification, industry: company.industry, description: company.description, admin: { name: 'Ana López', email: 'ana@test.local', password: 'Password123!' } })
    expect(created.status).toBe(201)
    expect(created.body.company.admin).toMatchObject({ id: 'cmnewadmin000000000000001', email: 'ana@test.local', role: 'COMPANY_ADMIN', companyId })
    expect(created.body.company.admin).not.toHaveProperty('passwordHash')

    const createArgs = (db.company.create as unknown as { mock: { calls: Array<[{ data: { users?: { create?: { passwordHash: string; role: string } } } }]> } }).mock.calls[0][0]
    expect(createArgs.data.users?.create?.role).toBe('COMPANY_ADMIN')
    const accountPassword = createArgs.data.users?.create?.passwordHash ?? ''
    expect(accountPassword).toMatch(/^\$2/)
    expect(accountPassword).not.toContain('Password123!')
    expect(bcrypt.compareSync('Password123!', accountPassword)).toBe(true)
  })

  it('creates a company without an admin when none is requested', async () => {
    const agent = request.agent(createApp(makeDb()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const created = await agent.post('/api/companies').send({ name: company.name, identification: company.identification, industry: company.industry, description: company.description })
    expect(created.status).toBe(201)
    expect(created.body.company.admin).toBeTruthy()
  })

  it('requires authentication and blocks company users from creating companies', async () => {
    const unauthenticated = await request(createApp(makeDb())).post('/api/companies').send({ name: company.name, identification: company.identification, industry: company.industry, description: company.description })
    expect(unauthenticated.status).toBe(401)

    const agent = request.agent(createApp(makeDb('COMPANY_USER')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const blocked = await agent.post('/api/companies').send({ name: company.name, identification: company.identification, industry: company.industry, description: company.description })
    expect(blocked.status).toBe(403)
  })

  it('restricts company creation to superusers', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_ADMIN')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const created = await agent.post('/api/companies').send({ name: company.name, identification: company.identification, industry: company.industry, description: company.description })
    expect(created.status).toBe(403)
  })

  it('prevents a company user from accessing another company by manipulating its ID', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_ADMIN', member.id, null, admin.id)))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    expect((await agent.post('/api/companies').send({ name: company.name, identification: company.identification, industry: company.industry, description: company.description })).status).toBe(403)
    expect((await agent.get(`/api/companies/${company.id}`)).status).toBe(404)
    expect((await agent.patch(`/api/companies/${company.id}`).send({ name: 'Intrusión' })).status).toBe(404)
    expect((await agent.delete(`/api/companies/${company.id}`)).status).toBe(403)
  })

  it('allows a company admin to manage its own company', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_ADMIN')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    expect((await agent.get(`/api/companies/${company.id}`)).status).toBe(200)
    expect((await agent.patch(`/api/companies/${company.id}`).send({ industry: 'Tecnología' })).status).toBe(200)
  })
})

describe('diagnostics and SWOT API', () => {
  it('supports diagnostic CRUD for a superuser', async () => {
    const agent = request.agent(createApp(makeDb()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const created = await agent.post(`/api/companies/${company.id}/diagnostics`).send({ title: diagnostic.title, description: diagnostic.description })
    expect(created.status).toBe(201)
    expect(created.body.diagnostic.swotAnalysis).toBeTruthy()
    expect((await agent.get(`/api/companies/${company.id}/diagnostics`)).status).toBe(200)
    expect((await agent.get(`/api/diagnostics/${diagnostic.id}`)).status).toBe(200)
    const updated = await agent.patch(`/api/diagnostics/${diagnostic.id}`).send({ status: 'COMPLETED' })
    expect(updated.status).toBe(200)
    expect((await agent.delete(`/api/diagnostics/${diagnostic.id}`)).status).toBe(204)
  })

  it('supports adding, editing and deleting SWOT items', async () => {
    const agent = request.agent(createApp(makeDb()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const created = await agent.post(`/api/diagnostics/${diagnostic.id}/swot/items`).send({ type: 'STRENGTH', description: swotItem.description })
    expect(created.status).toBe(201)
    expect(created.body.item.type).toBe('STRENGTH')
    const updated = await agent.patch(`/api/swot/items/${swotItem.id}`).send({ type: 'OPPORTUNITY', description: 'Nueva oportunidad detectada' })
    expect(updated.status).toBe(200)
    expect((await agent.delete(`/api/swot/items/${swotItem.id}`)).status).toBe(204)
  })

  it('creates a SWOT item with only type and description and returns the created factor', async () => {
    const db = makeDb()
    const agent = request.agent(createApp(db))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const created = await agent.post(`/api/diagnostics/${diagnostic.id}/swot/items`).send({ type: 'STRENGTH', description: 'La empresa cuenta con procesos eficientes' })
    expect(created.status).toBe(201)
    expect(created.body.item.type).toBe('STRENGTH')
    expect(created.body.item.description).toBe('La empresa cuenta con procesos eficientes')
    expect(created.body.item).not.toHaveProperty('priority')
    expect(created.body.item).not.toHaveProperty('impact')
    const createMock = db.sWOTItem.create as unknown as { mock: { calls: Array<Array<{ data?: { type?: string; description?: string; priority?: string; impact?: string } }>> } }
    const createArgs = createMock.mock.calls[0]?.[0]?.data
    expect(createArgs?.type).toBe('STRENGTH')
    expect(createArgs?.description).toBe('La empresa cuenta con procesos eficientes')
    expect(createArgs?.priority).toBeUndefined()
    expect(createArgs?.impact).toBeUndefined()
  })

  it('creates STRENGTH, WEAKNESS, OPPORTUNITY and THREAT factors without priority or impact', async () => {
    const db = makeDb()
    const agent = request.agent(createApp(db))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    for (const type of ['STRENGTH', 'WEAKNESS', 'OPPORTUNITY', 'THREAT']) {
      const created = await agent.post(`/api/diagnostics/${diagnostic.id}/swot/items`).send({ type, description: `Factor de prueba ${type}` })
      expect(created.status).toBe(201)
      expect(created.body.item.type).toBe(type)
      expect(created.body.item).not.toHaveProperty('priority')
      expect(created.body.item).not.toHaveProperty('impact')
    }
    const createMock = db.sWOTItem.create as unknown as { mock: { calls: Array<Array<{ data?: { type?: string; description?: string; priority?: string; impact?: string } }>> } }
    expect(createMock.mock.calls).toHaveLength(4)
    for (const call of createMock.mock.calls) {
      expect(call[0]?.data?.type).toBeDefined()
      expect(call[0]?.data?.description).toBeDefined()
      expect(call[0]?.data?.priority).toBeUndefined()
      expect(call[0]?.data?.impact).toBeUndefined()
    }
  })

  it('edits a factor with only the description and keeps the response free of priority and impact', async () => {
    const db = makeDb()
    const agent = request.agent(createApp(db))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const updated = await agent.patch(`/api/swot/items/${swotItem.id}`).send({ description: 'Descripción corregida' })
    expect(updated.status).toBe(200)
    expect(updated.body.item.description).toBe('Factor actualizado')
    expect(updated.body.item).not.toHaveProperty('priority')
    expect(updated.body.item).not.toHaveProperty('impact')
    const updateMock = db.sWOTItem.update as unknown as { mock: { calls: Array<Array<{ data?: Record<string, unknown> }>> } }
    expect(updateMock.mock.calls[0]?.[0]?.data).toEqual({ description: 'Descripción corregida' })
  })

  it('rejects invalid SWOT item type and short description on create', async () => {
    const agent = request.agent(createApp(makeDb()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const badType = await agent.post(`/api/diagnostics/${diagnostic.id}/swot/items`).send({ type: 'UNKNOWN', description: 'Descripción válida' })
    expect(badType.status).toBe(400)
    expect(badType.body.error).toBe('Invalid SWOT item data')
    const shortDescription = await agent.post(`/api/diagnostics/${diagnostic.id}/swot/items`).send({ type: 'STRENGTH', description: 'ab' })
    expect(shortDescription.status).toBe(400)
    expect(shortDescription.body.error).toBe('Invalid SWOT item data')
  })

  it('creates a strategic cross using factors created in the same flow, without priority or impact', async () => {
    const db = makeDb()
    const factors: Array<{ id: string; type: string }> = []
    const createItem = db.sWOTItem.create as unknown as { mockImplementation: (fn: (args: { data: { type: string; description: string } }) => Promise<unknown>) => unknown }
    createItem.mockImplementation(async ({ data }: { data: { type: string; description: string } }) => {
      const id = data.type === 'STRENGTH' ? 'cmfactor100000000000000001' : 'cmfactor200000000000000001'
      factors.push({ id, type: data.type })
      return { ...swotItem, id, type: data.type as 'STRENGTH', description: data.description, swot: { diagnostic: { companyId: company.id, company: { id: company.id, name: company.name } } } }
    })
    const findDiag = db.qualityDiagnostic.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }
    findDiag.mockResolvedValue({ ...diagnostic, company: { ...diagnostic.company }, swotAnalysis: { ...diagnostic.swotAnalysis, items: factors } })

    const agent = request.agent(createApp(db))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const strength = await agent.post(`/api/diagnostics/${diagnostic.id}/swot/items`).send({ type: 'STRENGTH', description: 'Equipo sólido' })
    expect(strength.status).toBe(201)
    const opportunity = await agent.post(`/api/diagnostics/${diagnostic.id}/swot/items`).send({ type: 'OPPORTUNITY', description: 'Nuevo mercado' })
    expect(opportunity.status).toBe(201)

    const cross = await agent.post(`/api/diagnostics/${diagnostic.id}/crosses`).send({ factor1Id: 'cmfactor100000000000000001', factor2Id: 'cmfactor200000000000000001', strategy: 'Explotar la fortaleza en el nuevo mercado' })
    expect(cross.status).toBe(201)
    expect(cross.body.cross.crossType).toBe('FO')
    expect(cross.body.cross.factor1.type).toBe('STRENGTH')
    expect(cross.body.cross.factor2.type).toBe('OPPORTUNITY')
    expect(cross.body.cross.factor1).not.toHaveProperty('priority')
    expect(cross.body.cross.factor1).not.toHaveProperty('impact')
  })

  it('sanitizes generated cross strategies before persisting them', async () => {
    const supportId = 'cmuoch1430004uwl58z1940k'
    const marketId = 'cmmarket1430004uwl58z1940x'
    const items = [
      { id: supportId, swotId: diagnostic.swotAnalysis.id, type: 'STRENGTH', description: 'El soporte del aplicativo contable está en casa', createdAt: new Date('2026-01-04') },
      { id: marketId, swotId: diagnostic.swotAnalysis.id, type: 'OPPORTUNITY', description: 'Mercado en expansión', createdAt: new Date('2026-01-04') },
    ]
    const db = makeDb()
    ;(db.qualityDiagnostic.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }).mockResolvedValue({ ...diagnostic, company: { ...diagnostic.company }, swotAnalysis: { ...diagnostic.swotAnalysis, items } })
    const aiService = {
      generateCrosses: vi.fn(async () => [{ factor1Id: supportId, factor2Id: marketId, type: 'FO', strategy: `Relación estratégica: capitalizar ${supportId} junto con ${marketId}.` }]),
    } as unknown as AIService
    const agent = request.agent(createApp(db, aiService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const generated = await agent.post(`/api/diagnostics/${diagnostic.id}/crosses/generate`)
    const createCall = (db.strategicCross.create as unknown as { mock: { calls: Array<Array<{ data: { strategy: string } }>> } }).mock.calls[0]?.[0]

    expect(generated.status).toBe(200)
    expect(createCall.data.strategy).toBe('Relación estratégica: capitalizar El soporte del aplicativo contable está en casa junto con Mercado en expansión.')
    expect(createCall.data.strategy).not.toContain(supportId)
    expect(createCall.data.strategy).not.toContain(marketId)
  })

  it('sanitizes legacy StrategicCross.strategy in crosses and consolidated strategies', async () => {
    const legacyStrategy = `Relación estratégica: capitalizar ${checkyFactorIds.strength} junto con ${checkyFactorIds.opportunity}.`
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [{
      id: 'cmlegacycross000000000001',
      crossType: 'FO',
      origin: 'AI',
      factor1Id: checkyFactorIds.strength,
      factor2Id: checkyFactorIds.opportunity,
      strategy: legacyStrategy,
      weighting: null,
    }])
    const agent = request.agent(createApp(db))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const crosses = await agent.get(`/api/diagnostics/${diagnostic.id}/crosses`)
    const strategies = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)
    const consolidated = strategies.body.strategies.find((strategy: { source: string }) => strategy.source === 'STRATEGIC_CROSS')

    expect(crosses.status).toBe(200)
    expect(crosses.body.crosses[0].strategy).toContain('Equipo comprometido')
    expect(crosses.body.crosses[0].strategy).not.toContain(checkyFactorIds.strength)
    expect(consolidated.description).toContain('Equipo comprometido')
    expect(consolidated.description).not.toContain(checkyFactorIds.strength)
  })

  it('allows a company admin to manage diagnostics in its own company', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_ADMIN')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const created = await agent.post(`/api/companies/${company.id}/diagnostics`).send({ title: diagnostic.title, description: diagnostic.description })
    expect(created.status).toBe(201)
    expect((await agent.patch(`/api/diagnostics/${diagnostic.id}`).send({ title: 'Actualizado' })).status).toBe(200)
    expect((await agent.post(`/api/diagnostics/${diagnostic.id}/swot/items`).send({ type: 'WEAKNESS', description: 'Proceso manual' })).status).toBe(201)
  })

  it('blocks a user from another company using diagnostic and SWOT IDs', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_ADMIN', member.id, null, admin.id)))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    expect((await agent.get(`/api/companies/${company.id}/diagnostics`)).status).toBe(404)
    expect((await agent.post(`/api/companies/${company.id}/diagnostics`).send({ title: diagnostic.title, description: diagnostic.description })).status).toBe(404)
    expect((await agent.get(`/api/diagnostics/${diagnostic.id}`)).status).toBe(404)
    expect((await agent.patch(`/api/diagnostics/${diagnostic.id}`).send({ title: 'Intrusión' })).status).toBe(404)
    expect((await agent.delete(`/api/diagnostics/${diagnostic.id}`)).status).toBe(404)
    expect((await agent.post(`/api/diagnostics/${diagnostic.id}/swot/items`).send({ type: 'THREAT', description: 'Intrusión' })).status).toBe(404)
    expect((await agent.patch(`/api/swot/items/${swotItem.id}`).send({ description: 'Intrusión' })).status).toBe(404)
    expect((await agent.delete(`/api/swot/items/${swotItem.id}`)).status).toBe(404)
  })
})

describe('AI analysis service and API', () => {
  it('validates a mocked OpenAI response before returning it', async () => {
    const client = { responses: { create: vi.fn(async () => ({ output_text: JSON.stringify(aiResult) })) } }
    const service = new AIService(client)
    const result = await service.analyze({ title: diagnostic.title, description: diagnostic.description, status: diagnostic.status, swotItems: [swotItem] })
    expect(result).toEqual(aiResult)
    expect(client.responses.create).toHaveBeenCalledOnce()
  })

  it('rejects an invalid mocked OpenAI response without producing a result', async () => {
    const client = { responses: { create: vi.fn(async () => ({ output_text: JSON.stringify({ executiveSummary: 'incompleto' }) })) } }
    const service = new AIService(client)
    await expect(service.analyze({ title: diagnostic.title, description: diagnostic.description, status: diagnostic.status, swotItems: [] })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('persists and retrieves an authorized AI analysis', async () => {
    const aiService = { analyze: vi.fn(async () => aiResult) } as unknown as AIService
    const agent = request.agent(createApp(makeDb('SUPERUSER'), aiService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const created = await agent.post(`/api/diagnostics/${diagnostic.id}/ai-analysis`)
    expect(created.status).toBe(200)
    expect(created.body.analysis.executiveSummary).toBe(aiResult.executiveSummary)
    expect((await agent.get(`/api/diagnostics/${diagnostic.id}/ai-analysis`)).status).toBe(200)
    expect(aiService.analyze).toHaveBeenCalledOnce()
  })

  it('sanitizes legacy AIAnalysis text on read while preserving evidenceIds', async () => {
    const supportId = 'cmuoch1430004uwl58z1940k'
    const marketId = 'cmmarket1430004uwl58z1940x'
    const seededItems = [
      { id: supportId, swotId: diagnostic.swotAnalysis.id, type: 'STRENGTH', description: 'El soporte del aplicativo contable está en casa', createdAt: new Date('2026-01-04') },
      { id: marketId, swotId: diagnostic.swotAnalysis.id, type: 'OPPORTUNITY', description: 'Mercado en expansión', createdAt: new Date('2026-01-04') },
    ]
    const legacy = {
      ...persistedAIAnalysis,
      executiveSummary: `Resumen ${supportId}`,
      diagnosis: `Diagnóstico ${marketId}`,
      keyFindings: [{ finding: `Hallazgo ${supportId}`, basis: 'INFERENCE', evidenceIds: [supportId], interpretation: `Relación estratégica ${marketId}` }],
      foStrategies: [`Estrategia ${supportId}`],
      doStrategies: [`Estrategia ${marketId}`],
      faStrategies: [],
      daStrategies: [],
      priorityRisks: [`Riesgo ${supportId}`],
      priorityOpportunities: [`Oportunidad ${marketId}`],
      recommendations: [{ ...aiResult.recommendations[0], title: `Recomendación ${supportId}`, description: `Descripción ${marketId}` }],
      swotFingerprint: swotFingerprint(seededItems),
    }
    const db = makeDb()
    ;(db.qualityDiagnostic.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }).mockResolvedValue({ ...diagnostic, company: { ...diagnostic.company }, swotAnalysis: { ...diagnostic.swotAnalysis, items: seededItems } })
    ;(db.aIAnalysis.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }).mockResolvedValue(legacy)
    const agent = request.agent(createApp(db))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const read = await agent.get(`/api/diagnostics/${diagnostic.id}/ai-analysis`)
    const visible = JSON.stringify({ ...read.body.analysis, keyFindings: read.body.analysis.keyFindings.map(({ evidenceIds, ...finding }: { evidenceIds: string[]; finding: string; interpretation: string }) => finding) })

    expect(read.status).toBe(200)
    expect(visible).not.toContain(supportId)
    expect(visible).not.toContain(marketId)
    expect(read.body.analysis.keyFindings[0].evidenceIds).toEqual([supportId])
  })

  it('returns a controlled error for missing configuration and invalid service output', async () => {
    const unconfiguredService = { analyze: vi.fn(async () => { throw new AIServiceError('NOT_CONFIGURED') }) } as unknown as AIService
    const unconfigured = request.agent(createApp(makeDb('SUPERUSER'), unconfiguredService))
    await unconfigured.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const unavailable = await unconfigured.post(`/api/diagnostics/${diagnostic.id}/ai-analysis`)
    expect(unavailable.status).toBe(503)
    expect(unavailable.body).toEqual({ error: 'AI analysis is not configured' })

    const invalidService = { analyze: vi.fn(async () => { throw new AIServiceError('INVALID_RESPONSE') }) } as unknown as AIService
    const app = createApp(makeDb('SUPERUSER'), invalidService)
    const agent = request.agent(app)
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const invalid = await agent.post(`/api/diagnostics/${diagnostic.id}/ai-analysis`)
    expect(invalid.status).toBe(502)
    expect(invalid.body).toEqual({ error: 'AI returned an invalid analysis' })
  })

  it('rate limits AI analysis generation to prevent cost abuse', async () => {
    const aiService = { analyze: vi.fn(async () => aiResult) } as unknown as AIService
    const agent = request.agent(createApp(makeDb('SUPERUSER'), aiService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    for (let i = 0; i < 15; i += 1) {
      expect((await agent.post(`/api/diagnostics/${diagnostic.id}/ai-analysis`)).status).toBe(200)
    }
    const blocked = await agent.post(`/api/diagnostics/${diagnostic.id}/ai-analysis`)
    expect(blocked.status).toBe(429)
    expect(aiService.analyze).toHaveBeenCalledTimes(15)
  })

  it('blocks AI analysis access through a diagnostic ID from another company', async () => {
    const aiService = { analyze: vi.fn(async () => aiResult) } as unknown as AIService
    const agent = request.agent(createApp(makeDb('COMPANY_ADMIN', member.id, null, admin.id), aiService))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    expect((await agent.post(`/api/diagnostics/${diagnostic.id}/ai-analysis`)).status).toBe(404)
    expect((await agent.get(`/api/diagnostics/${diagnostic.id}/ai-analysis`)).status).toBe(404)
    expect(aiService.analyze).not.toHaveBeenCalled()
  })
})

/**
 * Una inferencia sin evidencia es una opinión, y una lectura estratégica que describe una matriz que
 * el usuario ya cambió es un análisis que no se puede seguir usando como si fuera el de hoy. Aquí se
 * cubren las dos cosas: qué evidencia llega a pantalla y cuándo la lectura se considera vigente.
 */
describe('evidencia y vigencia de la lectura estratégica', () => {
  const weakness = { id: 'cmfactorlectura00000000001', type: 'WEAKNESS' as const, description: 'Falta de documentación' }
  const strength = { id: 'cmfactorlectura00000000002', type: 'STRENGTH' as const, description: 'Equipo comprometido' }

  /**
   * Siembra una matriz actual y una lectura guardada. `storedItems` es la matriz sobre la que se
   * escribió esa lectura: si no se indica, la lectura se guardó con la misma matriz que hay ahora y
   * por tanto está vigente.
   */
  const scenario = (options: { items: Array<{ id: string; type: string; description: string }>; storedItems?: Array<{ id: string; type: string; description: string }>; analysis?: Record<string, unknown>; storedFingerprint?: string | null }) => {
    const db = makeDb('SUPERUSER')
    const items = options.items.map((item) => ({ ...item, swotId: diagnostic.swotAnalysis.id, createdAt: new Date('2026-01-04') }))
    ;(db.qualityDiagnostic.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }).mockResolvedValue({ ...diagnostic, company: { ...diagnostic.company }, swotAnalysis: { ...diagnostic.swotAnalysis, items } })
    const stored = {
      ...persistedAIAnalysis,
      keyFindings: [{ finding: 'La operación depende de personas concretas.', basis: 'INFERENCE' as const, evidenceIds: [weakness.id] }],
      ...options.analysis,
      swotFingerprint: options.storedFingerprint === undefined ? swotFingerprint(options.storedItems ?? items) : options.storedFingerprint,
    }
    ;(db.aIAnalysis.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }).mockResolvedValue(stored)
    ;(db.aIAnalysis.upsert as unknown as { mockImplementation: (value: () => unknown) => unknown }).mockImplementation(() => stored)
    return { db, items }
  }

  const login = async (db: ReturnType<typeof makeDb>) => {
    const agent = request.agent(createApp(db, { analyze: vi.fn(async () => aiResult), consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    return agent
  }

  it('entrega la evidencia de cada inferencia con las palabras del factor, no con su id', async () => {
    const { db } = scenario({ items: [weakness, strength] })
    const agent = await login(db)
    const read = await agent.get(`/api/diagnostics/${diagnostic.id}/ai-analysis`)
    expect(read.status).toBe(200)
    const finding = read.body.analysis.keyFindings[0]
    // El id se conserva para poder llevar la lectura hasta el factor, pero lo que la pantalla muestra
    // es el tipo y la descripción: "Debilidad: Falta de documentación".
    expect(finding.evidenceIds).toEqual([weakness.id])
    expect(finding.evidence).toEqual([{ type: 'WEAKNESS', description: 'Falta de documentación' }])
  })

  it('no entrega evidencia de un factor que no está en la matriz actual', async () => {
    const { db } = scenario({ items: [strength], analysis: { keyFindings: [{ finding: 'Se apoya en algo que ya no existe.', basis: 'INFERENCE' as const, evidenceIds: [weakness.id] }] } })
    const agent = await login(db)
    const finding = (await agent.get(`/api/diagnostics/${diagnostic.id}/ai-analysis`)).body.analysis.keyFindings[0]
    expect(finding.evidenceIds).toEqual([])
    expect(finding.evidence).toEqual([])
  })

  it('deja la lectura vigente mientras la matriz DOFA no cambie', async () => {
    const { db } = scenario({ items: [weakness, strength] })
    const agent = await login(db)
    expect((await agent.get(`/api/diagnostics/${diagnostic.id}/ai-analysis`)).body.analysis.stale).toBe(false)
  })

  it('marca la lectura como desactualizada cuando el usuario editó un factor, sin borrarla', async () => {
    const edited = [{ id: weakness.id, type: weakness.type, description: 'Falta de documentación de procesos' }, strength]
    const { db } = scenario({ items: edited, storedItems: [weakness, strength] })
    const agent = await login(db)
    const read = await agent.get(`/api/diagnostics/${diagnostic.id}/ai-analysis`)
    expect(read.status).toBe(200)
    expect(read.body.analysis.stale).toBe(true)
    // No se borra: el aviso ofrece actualizarla, no desaparecerla.
    expect(read.body.analysis.diagnosis).toBe(persistedAIAnalysis.diagnosis)
  })

  it('trata como desactualizada una lectura anterior a la huella, porque no se sabe con qué matriz se escribió', async () => {
    const { db } = scenario({ items: [weakness], storedFingerprint: null })
    const agent = await login(db)
    expect((await agent.get(`/api/diagnostics/${diagnostic.id}/ai-analysis`)).body.analysis.stale).toBe(true)
  })

  it('no reutiliza en silencio una lectura desactualizada: Checky la regenera con la matriz actual', async () => {
    const edited = [{ id: weakness.id, type: weakness.type, description: 'Falta de documentación de procesos' }, strength]
    const { db, items } = scenario({ items: edited, storedItems: [weakness, strength] })
    const analyze = vi.fn(async () => aiResult)
    const agent = request.agent(createApp(db, { analyze, consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const sent = await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Qué cambió?' })
    expect(sent.status).toBe(201)
    expect(analyze).toHaveBeenCalledOnce()
    // Se regenera sobre lo que hay ahora, con la descripción editada y no con la que se había leído.
    expect((analyze as unknown as { mock: { calls: [{ swotItems: Array<{ id: string; description: string }> }][] } }).mock.calls[0][0].swotItems).toEqual(items.map((item) => ({ id: item.id, type: item.type, description: item.description })))
  })

  it('deja pasar una lectura vigente sin volver a gastar la cuota de análisis', async () => {
    const { db } = scenario({ items: [weakness, strength] })
    const analyze = vi.fn(async () => aiResult)
    const agent = request.agent(createApp(db, { analyze, consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    expect((await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Qué reviso primero?' })).status).toBe(201)
    expect(analyze).not.toHaveBeenCalled()
  })

  it('descarta la evidencia que el modelo cita y no existe en la matriz', async () => {
    const client = { responses: { create: vi.fn(async () => ({ output_text: JSON.stringify({ ...aiResult, keyFindings: [{ finding: 'Concluye algo.', basis: 'INFERENCE', evidenceIds: [weakness.id, 'cmfactorinventado00000001'] }] }) })) } }
    const result = await new AIService(client).analyze({ title: diagnostic.title, description: diagnostic.description, status: diagnostic.status, swotItems: [{ id: weakness.id, type: weakness.type, description: weakness.description }] })
    expect(result.keyFindings[0].evidenceIds).toEqual([weakness.id])
  })
})

/**
 * El paso de la matriz a Checky. La matriz DOFA se puede llenar y sus cruces generarse sin que exista
 * ninguna lectura estratégica, así que entrar a Checky no puede depender de que esa fila ya esté: la
 * ausencia de análisis es un estado normal de la pantalla y no un fallo. Lo que sí tiene que quedar
 * claro es cuándo hay un problema de verdad, porque un mismo 404 no puede significar las dos cosas.
 */
describe('paso de Matriz DOFA a Checky', () => {
  const factor = { id: 'cmfactorhito0000000000001', type: 'WEAKNESS' as const, description: 'Falta de documentación' }

  /** Diagnóstico con una matriz ya lista, y opcionalmente con la lectura estratégica guardada. */
  const handoff = (options: { stored?: Record<string, unknown> | null; items?: Array<{ id: string; type: string; description: string }> } = {}) => {
    const db = makeDb('SUPERUSER')
    const items = (options.items ?? [factor]).map((item) => ({ ...item, swotId: diagnostic.swotAnalysis.id, createdAt: new Date('2026-01-04') }))
    ;(db.qualityDiagnostic.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }).mockResolvedValue({ ...diagnostic, company: { ...diagnostic.company }, swotAnalysis: { ...diagnostic.swotAnalysis, items } })
    ;(db.aIAnalysis.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }).mockResolvedValue(options.stored === null ? null : (options.stored ?? { ...persistedAIAnalysis, swotFingerprint: swotFingerprint(items) }))
    const analyze = vi.fn(async () => aiResult)
    const consultChecky = vi.fn(async () => checkyConsultResult)
    return { db, items, analyze, consultChecky }
  }

  const session = async (db: ReturnType<typeof makeDb>, aiService: AIService) => {
    const agent = request.agent(createApp(db, aiService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    return agent
  }

  it('entra a Checky sin que exista análisis, sin error de carga', async () => {
    const { db, analyze, consultChecky } = handoff({ stored: null })
    const agent = await session(db, { analyze, consultChecky } as unknown as AIService)
    const read = await agent.get(`/api/diagnostics/${diagnostic.id}/ai-analysis`)
    // No es un 404: la pantalla necesita saber que el diagnóstico está bien y que lo que falta es la
    // lectura, para quedarse quieta esperando a que el usuario pulse "Analizar con Checky".
    expect(read.status).toBe(200)
    expect(read.body.analysis).toBeNull()
  })

  it('crea y guarda el análisis al analizar con Checky sobre la DOFA actual', async () => {
    const { db, items, analyze, consultChecky } = handoff({ stored: null })
    const agent = await session(db, { analyze, consultChecky } as unknown as AIService)
    expect((await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: 'Analiza mi diagnóstico' })).status).toBe(201)
    expect(analyze).toHaveBeenCalledOnce()
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ swotItems: [{ id: factor.id, type: factor.type, description: factor.description }] }))
    // Lo guardado lleva la huella de la matriz que se acaba de usar, que es lo que hará que la
    // siguiente consulta lo dé por vigente en vez de regenerarlo otra vez.
    expect(db.aIAnalysis.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ diagnosticId: diagnostic.id, swotFingerprint: swotFingerprint(items) }) }))
  })

  it('carga el análisis existente cuando lo hay', async () => {
    // La matriz incluye el factor que cita la inferencia guardada, así que además de la lectura se
    // comprueba que su evidencia llega resuelta y no como un id suelto.
    const { db, analyze, consultChecky } = handoff({ items: [factor, { id: swotItem.id, type: 'STRENGTH', description: 'Equipo comprometido' }] })
    const agent = await session(db, { analyze, consultChecky } as unknown as AIService)
    const read = await agent.get(`/api/diagnostics/${diagnostic.id}/ai-analysis`)
    expect(read.status).toBe(200)
    expect(read.body.analysis.diagnosis).toBe(persistedAIAnalysis.diagnosis)
    expect(read.body.analysis.stale).toBe(false)
    expect(read.body.analysis.keyFindings[0].interpretation).toBe('Esta capacidad interna puede sostener la ejecución de las prioridades.')
    expect(read.body.analysis.keyFindings[0].evidence).toEqual([{ type: 'STRENGTH', description: 'Equipo comprometido' }])
  })

  it('deja actualizar un análisis desactualizado y lo vuelve a guardar con la matriz vigente', async () => {
    const edited = [{ ...factor, description: 'Falta de documentación de procesos' }]
    const { db, items, analyze, consultChecky } = handoff({ items: edited, stored: { ...persistedAIAnalysis, swotFingerprint: swotFingerprint([factor]) } })
    const agent = await session(db, { analyze, consultChecky } as unknown as AIService)
    const read = await agent.get(`/api/diagnostics/${diagnostic.id}/ai-analysis`)
    expect(read.body.analysis.stale).toBe(true)
    expect((await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: 'Actualiza el análisis' })).status).toBe(201)
    expect(analyze).toHaveBeenCalledOnce()
    expect(db.aIAnalysis.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ swotFingerprint: swotFingerprint(items) }) }))
  })

  it('sigue avisando de los errores de verdad en lugar de callarlos como si no hubiera análisis', async () => {
    // Un fallo real de servidor no puede disfrazarse de "todavía no hay análisis": si la respuesta
    // fuera 200 con null, la pantalla dejaría de avisar de un problema que el usuario sí tiene.
    const { db, analyze, consultChecky } = handoff({ stored: null })
    ;(db.aIAnalysis.findUnique as unknown as { mockRejectedValue: (value: unknown) => unknown }).mockRejectedValue(new Error('column "swotFingerprint" does not exist'))
    const agent = await session(db, { analyze, consultChecky } as unknown as AIService)
    expect((await agent.get(`/api/diagnostics/${diagnostic.id}/ai-analysis`)).status).toBe(500)

    // Y el 404 queda para el diagnóstico que no existe o no es de esta empresa, no para la ausencia
    // de análisis: son dos cosas distintas y la pantalla las trata distinto.
    const foreignAgent = request.agent(createApp(makeDb('COMPANY_ADMIN', member.id, null, admin.id), { analyze: vi.fn(async () => aiResult), consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService))
    await foreignAgent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const denied = await foreignAgent.get(`/api/diagnostics/${diagnostic.id}/ai-analysis`)
    expect(denied.status).toBe(404)
    expect(denied.body).toEqual({ error: 'Diagnostic not found' })
  })
})

describe('recommendations and action plans API', () => {
  it('imports AI recommendations without calling OpenAI and lists them', async () => {
    const db = makeDb()
    const agent = request.agent(createApp(db))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const imported = await agent.post(`/api/diagnostics/${diagnostic.id}/recommendations/import`)
    expect(imported.status).toBe(200)
    expect(imported.body.imported).toHaveLength(1)
    expect(imported.body.imported[0].title).toBe(aiResult.recommendations[0].title)
    expect(imported.body.skipped).toBe(0)
    expect(db.aIAnalysis.upsert).not.toHaveBeenCalled()
    const list = await agent.get(`/api/diagnostics/${diagnostic.id}/recommendations`)
    expect(list.status).toBe(200)
    expect(list.body.recommendations).toHaveLength(1)
  })

  it('skips duplicate AI recommendations on a second import', async () => {
    const agent = request.agent(createApp(makeDb('SUPERUSER', member.id, null, member.id, [recommendation])))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const imported = await agent.post(`/api/diagnostics/${diagnostic.id}/recommendations/import`)
    expect(imported.status).toBe(200)
    expect(imported.body.imported).toHaveLength(0)
    expect(imported.body.skipped).toBe(1)
  })

  it('accepts and rejects imported recommendations', async () => {
    const agent = request.agent(createApp(makeDb()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const accepted = await agent.patch(`/api/recommendations/${recommendation.id}`).send({ status: 'ACCEPTED' })
    expect(accepted.status).toBe(200)
    expect(accepted.body.recommendation.status).toBe('ACCEPTED')
    expect((await agent.patch(`/api/recommendations/${recommendation.id}`).send({ status: 'REJECTED' })).status).toBe(200)
  })

  it('rejects invalid recommendation payloads', async () => {
    const agent = request.agent(createApp(makeDb()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const invalid = await agent.patch(`/api/recommendations/${recommendation.id}`).send({ status: 'UNKNOWN' })
    expect(invalid.status).toBe(400)
  })

  it('creates action plans and adds, updates and deletes action items', async () => {
    const agent = request.agent(createApp(makeDb()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const created = await agent.post(`/api/diagnostics/${diagnostic.id}/action-plans`).send({ title: actionPlan.title, description: actionPlan.description, status: 'ACTIVE' })
    expect(created.status).toBe(201)
    expect(created.body.actionPlan.title).toBe(actionPlan.title)
    expect((await agent.get(`/api/diagnostics/${diagnostic.id}/action-plans`)).status).toBe(200)
    expect((await agent.get(`/api/action-plans/${actionPlan.id}`)).status).toBe(200)

    const item = await agent.post(`/api/action-plans/${actionPlan.id}/items`).send({ title: actionItem.title, description: actionItem.description, priority: 'HIGH', recommendationId: recommendation.id, responsibleId: member.id, dueDate: '2026-03-01' })
    expect(item.status).toBe(201)
    expect(item.body.item.responsible.name).toBe(member.name)
    const updated = await agent.patch(`/api/action-items/${actionItem.id}`).send({ status: 'IN_PROGRESS', priority: 'MEDIUM' })
    expect(updated.status).toBe(200)
    expect(updated.body.item.status).toBe('IN_PROGRESS')
    expect((await agent.delete(`/api/action-items/${actionItem.id}`)).status).toBe(204)
  })

  it('updates an action item and reassigns the responsible user', async () => {
    const db = makeDb()
    const agent = request.agent(createApp(db))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const updated = await agent.patch(`/api/action-items/${actionItem.id}`).send({ title: 'Proceso documentado', priority: 'MEDIUM', status: 'IN_PROGRESS', responsibleId: member.id, dueDate: '2026-05-01' })
    expect(updated.status).toBe(200)
    expect(updated.body.item.status).toBe('IN_PROGRESS')
    const data = (db.actionItem.update as unknown as { mock: { calls: Array<[{ data: { title: string; responsibleId: string; dueDate: Date } }]> } }).mock.calls[0][0].data
    expect(data.title).toBe('Proceso documentado')
    expect(data.responsibleId).toBe(member.id)
    expect(data.dueDate).toBeInstanceOf(Date)
  })

  it('deletes action plans', async () => {
    const db = makeDb()
    const agent = request.agent(createApp(db))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const created = await agent.post(`/api/diagnostics/${diagnostic.id}/action-plans`).send({ title: 'Plan temporal', description: 'Plan para eliminar', status: 'DRAFT' })
    expect(created.status).toBe(201)
    expect((await agent.delete(`/api/action-plans/${actionPlan.id}`)).status).toBe(204)
    expect((db.actionPlan.delete as unknown as { mock: { calls: Array<unknown> } }).mock.calls).toHaveLength(1)
  })

  it('blocks assigning a responsible user from another company', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_ADMIN')))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const response = await agent.patch(`/api/action-items/${actionItem.id}`).send({ responsibleId: otherCompanyUser.id })
    expect(response.status).toBe(403)
  })

  it('validates action plan and action item payloads', async () => {
    const agent = request.agent(createApp(makeDb()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const badPlan = await agent.post(`/api/diagnostics/${diagnostic.id}/action-plans`).send({ title: 'x', description: '' })
    expect(badPlan.status).toBe(400)
    const badItem = await agent.post(`/api/action-plans/${actionPlan.id}/items`).send({ title: 'x', description: '', priority: 'UNKNOWN' })
    expect(badItem.status).toBe(400)
    expect((await agent.patch(`/api/action-items/${actionItem.id}`).send({})).status).toBe(400)
  })

  it('rejects a recommendation that does not belong to the diagnostic', async () => {
    const db = makeDb()
    ;(db.recommendation.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }).mockResolvedValue({ diagnosticId: 'another-diagnostic' })
    const agent = request.agent(createApp(db))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const response = await agent.post(`/api/action-plans/${actionPlan.id}/items`).send({ title: 'Acción correcta', description: 'Descripción válida', priority: 'HIGH', recommendationId: recommendation.id })
    expect(response.status).toBe(400)
  })

  it('blocks users from another company using recommendation and plan IDs', async () => {
    const agent = request.agent(createApp(makeDb('COMPANY_ADMIN', member.id, null, admin.id)))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    expect((await agent.get(`/api/diagnostics/${diagnostic.id}/recommendations`)).status).toBe(404)
    expect((await agent.post(`/api/diagnostics/${diagnostic.id}/recommendations/import`)).status).toBe(404)
    expect((await agent.patch(`/api/recommendations/${recommendation.id}`).send({ status: 'ACCEPTED' })).status).toBe(404)
    expect((await agent.get(`/api/diagnostics/${diagnostic.id}/action-plans`)).status).toBe(404)
    expect((await agent.post(`/api/diagnostics/${diagnostic.id}/action-plans`).send({ title: 'Intrusión', description: 'Intrusión' })).status).toBe(404)
    expect((await agent.get(`/api/action-plans/${actionPlan.id}`)).status).toBe(404)
    expect((await agent.patch(`/api/action-plans/${actionPlan.id}`).send({ status: 'COMPLETED' })).status).toBe(404)
    expect((await agent.delete(`/api/action-plans/${actionPlan.id}`)).status).toBe(404)
    expect((await agent.post(`/api/action-plans/${actionPlan.id}/items`).send({ title: 'Acción', description: 'Descripción', priority: 'HIGH' })).status).toBe(404)
    expect((await agent.patch(`/api/action-items/${actionItem.id}`).send({ status: 'COMPLETED' })).status).toBe(404)
    expect((await agent.delete(`/api/action-items/${actionItem.id}`)).status).toBe(404)
  })
})

describe('action item to ticket integration', () => {
  const companyAdminApp = () => {
    const db = makeDb('COMPANY_ADMIN')
    const agent = request.agent(createApp(db))
    return { db, agent }
  }
  const login = (agent: ReturnType<typeof request.agent>) => agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
  const createItem = (agent: ReturnType<typeof request.agent>, payload: Record<string, unknown> = {}) => agent
    .post(`/api/action-plans/${actionPlan.id}/items`)
    .send({ title: actionItem.title, description: actionItem.description, priority: 'HIGH', responsibleId: member.id, dueDate: '2026-03-01', ...payload })
  const ticketUpdateCalls = (db: ReturnType<typeof makeDb>) => (db.ticket.update as unknown as { mock: { calls: Array<[{ data: Record<string, unknown> }]> } }).mock.calls

  it('creates a ticket when an action item is created', async () => {
    const { agent } = companyAdminApp()
    await login(agent)
    const created = await createItem(agent)
    expect(created.status).toBe(201)
    expect(created.body.ticket).toBeDefined()
    expect(created.body.ticket.actionItemId).toBe(created.body.item.id)
    expect(created.body.ticket.title).toBe(actionItem.title)
  })

  it('keeps the generated ticket in the plan company', async () => {
    const { agent } = companyAdminApp()
    await login(agent)
    const created = await createItem(agent)
    expect(created.status).toBe(201)
    expect(created.body.ticket.createdBy.companyId).toBe(company.id)
    expect(created.body.ticket.assignedTo.companyId).toBe(company.id)
  })

  it('preserves the responsible user on the generated ticket', async () => {
    const { agent } = companyAdminApp()
    await login(agent)
    const created = await createItem(agent)
    expect(created.status).toBe(201)
    expect(created.body.ticket.assignedToId).toBe(member.id)
    expect(created.body.ticket.assignedTo.name).toBe(member.name)
  })

  it('preserves the priority on the generated ticket', async () => {
    const { agent } = companyAdminApp()
    await login(agent)
    const created = await createItem(agent, { priority: 'HIGH' })
    expect(created.status).toBe(201)
    expect(created.body.ticket.priority).toBe('HIGH')
  })

  it('preserves the due date on the generated ticket', async () => {
    const { agent } = companyAdminApp()
    await login(agent)
    const created = await createItem(agent, { dueDate: '2026-03-01' })
    expect(created.status).toBe(201)
    expect(new Date(created.body.ticket.dueDate).getTime()).toBe(new Date('2026-03-01').getTime())
  })

  it('links the generated ticket to the action item', async () => {
    const { db, agent } = companyAdminApp()
    await login(agent)
    const created = await createItem(agent)
    expect(created.status).toBe(201)
    expect(created.body.ticket.actionItemId).toBe(created.body.item.id)
    const createData = (db.ticket.create as unknown as { mock: { calls: Array<[{ data: { actionItemId: string } }]> } }).mock.calls[0][0]?.data
    expect(createData?.actionItemId).toBe(created.body.item.id)
  })

  it('does not create a duplicate ticket when creating the same action item again', async () => {
    const { db, agent } = companyAdminApp()
    await login(agent)
    const first = await createItem(agent)
    expect(first.status).toBe(201)
    const second = await createItem(agent, {})
    expect(second.status).toBe(201)
    expect((db.ticket.create as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
  })

  it('syncs the ticket when the action item moves from PENDING to IN_PROGRESS', async () => {
    const { db, agent } = companyAdminApp()
    await login(agent)
    await createItem(agent)
    const updated = await agent.patch(`/api/action-items/${actionItem.id}`).send({ status: 'IN_PROGRESS' })
    expect(updated.status).toBe(200)
    expect(ticketUpdateCalls(db)[0]?.[0]?.data?.status).toBe('IN_PROGRESS')
  })

  it('syncs the ticket when the action item reaches COMPLETED', async () => {
    const { db, agent } = companyAdminApp()
    await login(agent)
    await createItem(agent)
    const updated = await agent.patch(`/api/action-items/${actionItem.id}`).send({ status: 'COMPLETED' })
    expect(updated.status).toBe(200)
    expect(ticketUpdateCalls(db)[0]?.[0]?.data?.status).toBe('RESOLVED')
  })

  it('syncs the ticket back to OPEN when the action item returns to PENDING', async () => {
    const { db, agent } = companyAdminApp()
    await login(agent)
    await createItem(agent)
    const updated = await agent.patch(`/api/action-items/${actionItem.id}`).send({ status: 'PENDING' })
    expect(updated.status).toBe(200)
    expect(ticketUpdateCalls(db)[0]?.[0]?.data?.status).toBe('OPEN')
  })

  it('syncs the ticket to CLOSED when the action item is cancelled', async () => {
    const { db, agent } = companyAdminApp()
    await login(agent)
    await createItem(agent)
    const updated = await agent.patch(`/api/action-items/${actionItem.id}`).send({ status: 'CANCELLED' })
    expect(updated.status).toBe(200)
    expect(ticketUpdateCalls(db)[0]?.[0]?.data?.status).toBe('CLOSED')
  })

  it('edits the linked ticket when the action item is edited', async () => {
    const { db, agent } = companyAdminApp()
    await login(agent)
    await createItem(agent)
    const updated = await agent.patch(`/api/action-items/${actionItem.id}`).send({ title: 'Proceso documentado', description: 'Nueva descripción', priority: 'MEDIUM', responsibleId: companyUser.id, dueDate: '2026-05-01' })
    expect(updated.status).toBe(200)
    const data = ticketUpdateCalls(db)[0]?.[0]?.data
    expect(data?.title).toBe('Proceso documentado')
    expect(data?.description).toBe('Nueva descripción')
    expect(data?.priority).toBe('MEDIUM')
    expect(data?.assignedToId).toBe(companyUser.id)
    expect(data?.dueDate).toBeInstanceOf(Date)
  })

  it('deletes the linked ticket when the action item is deleted', async () => {
    const { db, agent } = companyAdminApp()
    await login(agent)
    await createItem(agent)
    const deleted = await agent.delete(`/api/action-items/${actionItem.id}`)
    expect(deleted.status).toBe(204)
    expect((db.ticket.delete as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
    expect((db.actionItem.delete as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
  })

  it('denies a user from another company access to the generated ticket', async () => {
    const { agent } = companyAdminApp()
    await login(agent)
    const created = await createItem(agent)
    expect(created.status).toBe(201)
    const intruder = request.agent(createApp(makeDb('COMPANY_USER', member.id, null, otherCompanyId)))
    await login(intruder)
    expect((await intruder.get(`/api/tickets/${created.body.ticket.id}`)).status).toBe(404)
    expect((await intruder.patch(`/api/tickets/${created.body.ticket.id}`).send({ status: 'CLOSED' })).status).toBe(404)
    expect((await intruder.delete(`/api/tickets/${created.body.ticket.id}`)).status).toBe(404)
  })

  it('gives a superuser global access to the generated ticket', async () => {
    const { agent } = companyAdminApp()
    await login(agent)
    const created = await createItem(agent)
    expect(created.status).toBe(201)
    const global = request.agent(createApp(makeDb()))
    await global.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    expect((await global.get(`/api/tickets/${created.body.ticket.id}`)).status).toBe(200)
    expect((await global.patch(`/api/tickets/${created.body.ticket.id}`).send({ status: 'CLOSED' })).status).toBe(200)
    expect((await global.delete(`/api/tickets/${created.body.ticket.id}`)).status).toBe(204)
  })

  it('creates the missing ticket for a legacy action item when it is updated', async () => {
    const { db, agent } = companyAdminApp()
    await login(agent)
    const updated = await agent.patch(`/api/action-items/${actionItem.id}`).send({ status: 'IN_PROGRESS' })
    expect(updated.status).toBe(200)
    const createData = (db.ticket.create as unknown as { mock: { calls: Array<[{ data: { actionItemId: string; status: string; title: string; assignedToId: string | null } }]> } }).mock.calls[0]?.[0]?.data
    expect(createData?.actionItemId).toBe(actionItem.id)
    expect(createData?.status).toBe('IN_PROGRESS')
    expect(createData?.title).toBe(actionItem.title)
    expect(createData?.assignedToId).toBe(actionItem.responsibleId)
  })

  it('runs the full flow: plan → item → ticket → list → status sync', async () => {
    const { agent } = companyAdminApp()
    await login(agent)
    const plan = await agent.post(`/api/diagnostics/${diagnostic.id}/action-plans`).send({ title: actionPlan.title, description: actionPlan.description, status: 'ACTIVE' })
    expect(plan.status).toBe(201)
    expect(plan.body.actionPlan.id).toBe(actionPlan.id)

    const created = await agent.post(`/api/action-plans/${actionPlan.id}/items`).send({ title: actionItem.title, description: actionItem.description, priority: 'HIGH', recommendationId: recommendation.id, responsibleId: member.id, dueDate: '2026-03-01' })
    expect(created.status).toBe(201)
    expect(created.body.ticket).toBeDefined()
    expect(created.body.ticket.actionItemId).toBe(created.body.item.id)
    expect(created.body.ticket.title).toBe(actionItem.title)
    expect(created.body.ticket.assignedToId).toBe(member.id)
    const ticketId = created.body.ticket.id

    const list = await agent.get('/api/tickets')
    expect(list.status).toBe(200)
    const generated = list.body.tickets.find((entry: { actionItemId: string | null }) => entry.actionItemId === created.body.item.id)
    expect(generated).toBeDefined()
    expect(generated.id).toBe(ticketId)
    expect(generated.status).toBe('OPEN')

    const inProgress = await agent.patch(`/api/action-items/${actionItem.id}`).send({ status: 'IN_PROGRESS' })
    expect(inProgress.status).toBe(200)
    const afterInProgress = await agent.get('/api/tickets')
    const synced = afterInProgress.body.tickets.find((entry: { id: string }) => entry.id === ticketId)
    expect(synced.status).toBe('IN_PROGRESS')

    const completed = await agent.patch(`/api/action-items/${actionItem.id}`).send({ status: 'COMPLETED' })
    expect(completed.status).toBe(200)
    const afterCompleted = await agent.get('/api/tickets')
    const resolved = afterCompleted.body.tickets.find((entry: { id: string }) => entry.id === ticketId)
    expect(resolved.status).toBe('RESOLVED')
  })
})

describe('Checky strategic assistant', () => {
  const checkyClient = (payload: unknown) => ({ responses: { create: vi.fn(async () => ({ output_text: JSON.stringify(payload) })) } })
  const checkyContext = () => ({
    question: '¿Qué debo revisar?',
    diagnostic: { title: diagnostic.title, description: diagnostic.description, status: diagnostic.status },
    swotItems: [
      { id: checkyFactorIds.strength, type: 'STRENGTH', description: 'Equipo comprometido' },
      { id: checkyFactorIds.opportunity, type: 'OPPORTUNITY', description: 'Mercado en expansión' },
    ],
    crosses: [],
    aiAnalysis: null,
    recommendations: [],
  })

  it('validates a mocked Checky response and keeps FACT and INFERENCE apart', async () => {
    const client = checkyClient(checkyConsultResult)
    const service = new AIService(client)
    const result = await service.consultChecky(checkyContext())
    expect(result.reply).toBe(checkyConsultResult.reply)
    expect(result.findings.map((finding) => finding.basis)).toEqual(['FACT', 'INFERENCE'])
    expect(result.findings[0].category).toBe('MISSING_CROSSES')
    expect(client.responses.create).toHaveBeenCalledOnce()
  })

  it('rejects a Checky response citing evidence that does not exist', async () => {
    const service = new AIService(checkyClient({ ...checkyConsultResult, findings: [{ ...checkyConsultResult.findings[0], evidenceIds: ['cmfactorinexistente0000000001'] }] }))
    await expect(service.consultChecky(checkyContext())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('rejects a Checky response that neither finds something nor declares insufficient data', async () => {
    const service = new AIService(checkyClient({ reply: 'Sin hallazgos.', insufficientData: false, missingInformation: [], findings: [] }))
    await expect(service.consultChecky(checkyContext())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('accepts a Checky response that explicitly declares insufficient data', async () => {
    const service = new AIService(checkyClient(checkyInsufficientResult))
    const result = await service.consultChecky(checkyContext())
    expect(result.insufficientData).toBe(true)
    expect(result.missingInformation).toEqual(['No hay amenazas registradas en la matriz DOFA.'])
    expect(result.findings).toEqual([])
  })

  it('creates a session, sends a message and persists the suggestions as pending', async () => {
    const aiService = { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    const agent = request.agent(createApp(makeDb('SUPERUSER'), aiService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const created = await agent.post(`/api/diagnostics/${diagnostic.id}/checky/sessions`).send({ title: 'Revisión DOFA' })
    expect(created.status).toBe(201)
    expect(created.body.session.diagnosticId).toBe(diagnostic.id)

    const sent = await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Qué cruces me faltan?' })
    expect(sent.status).toBe(201)
    expect(sent.body.userMessage.role).toBe('USER')
    expect(sent.body.reply.content).toBe(checkyConsultResult.reply)
    expect(sent.body.suggestions).toHaveLength(2)
    expect(sent.body.suggestions[0].status).toBe('PENDING')
    expect(sent.body.suggestions[0].basis).toBe('FACT')
    expect(sent.body.suggestions[0].evidenceIds).toEqual([checkyFactorIds.strength, checkyFactorIds.opportunity])
    expect(sent.body.suggestions[1].basis).toBe('INFERENCE')
    expect(aiService.consultChecky).toHaveBeenCalledOnce()

    const read = await agent.get(`/api/checky/sessions/${checkySessionFixture.id}`)
    expect(read.status).toBe(200)
    expect(read.body.messages).toHaveLength(4)
  })

  it('sanitizes legacy Checky messages when reading a session without changing evidenceIds', async () => {
    const db = makeDb()
    const created = await (db.checkyMessage.create as unknown as (args: { data: Record<string, unknown> }) => Promise<{ id: string }> )({
      data: {
        sessionId: checkySessionFixture.id,
        role: 'CHECKY',
        content: `Hallazgo sobre ${checkyFactorIds.strength}.\nRelación estratégica con ${checkyFactorIds.opportunity}.`,
        category: 'STRENGTHEN_STRATEGIES',
        basis: 'INFERENCE',
        evidenceIds: [checkyFactorIds.strength, checkyFactorIds.opportunity],
        missingInformation: [],
        suggestedStrategyTitle: `Activar ${checkyFactorIds.strength}`,
        suggestedStrategyDescription: `Usar ${checkyFactorIds.opportunity} para validar la oportunidad.`,
        status: 'PENDING',
      },
    })
    const agent = request.agent(createApp(db))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const read = await agent.get(`/api/checky/sessions/${checkySessionFixture.id}`)
    const message = read.body.messages.find((entry: { id: string }) => entry.id === created.id)

    expect(read.status).toBe(200)
    expect(message.content).toContain('Equipo comprometido')
    expect(message.content).toContain('Mercado en expansión')
    expect(message.content).not.toContain(checkyFactorIds.strength)
    expect(message.evidenceIds).toEqual([checkyFactorIds.strength, checkyFactorIds.opportunity])
    expect(message.suggestedStrategyDescription).toContain('Mercado en expansión')
    expect(message.suggestedStrategyDescription).not.toContain(checkyFactorIds.opportunity)
  })

  it('removes internal factor ids from persisted Checky text without changing evidence ids', async () => {
    const dirtyResult = {
      ...checkyConsultResult,
      reply: `La relación entre ${checkyFactorIds.strength} y ${checkyFactorIds.opportunity} merece revisión.`,
      findings: [{
        ...checkyConsultResult.findings[0],
        title: `Revisar ${checkyFactorIds.strength}`,
        detail: `El cruce entre ${checkyFactorIds.strength} y ${checkyFactorIds.opportunity} puede abrir una línea de trabajo.`,
        suggestedStrategy: {
          title: `Activar ${checkyFactorIds.strength}`,
          description: `Usar ${checkyFactorIds.strength} junto con ${checkyFactorIds.opportunity} para validar una oportunidad concreta.`,
        },
      }],
    }
    const db = makeDb()
    const seededItems = [
      { id: checkyFactorIds.strength, swotId: diagnostic.swotAnalysis.id, type: 'STRENGTH', description: 'Equipo comprometido', createdAt: new Date('2026-01-04') },
      { id: checkyFactorIds.opportunity, swotId: diagnostic.swotAnalysis.id, type: 'OPPORTUNITY', description: 'Mercado en expansión', createdAt: new Date('2026-01-04') },
    ]
    ;(db.qualityDiagnostic.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }).mockResolvedValue({ ...diagnostic, company: { ...diagnostic.company }, swotAnalysis: { ...diagnostic.swotAnalysis, items: seededItems } })
    ;(db.aIAnalysis.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }).mockResolvedValue({ ...persistedAIAnalysis, swotFingerprint: swotFingerprint(seededItems) })
    const agent = request.agent(createApp(db, { consultChecky: vi.fn(async () => dirtyResult) } as unknown as AIService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const sent = await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Qué debo revisar?' })

    expect(sent.status).toBe(201)
    expect(sent.body.reply.content).toContain('Equipo comprometido')
    expect(sent.body.reply.content).toContain('Mercado en expansión')
    expect(sent.body.reply.content).not.toContain(checkyFactorIds.strength)
    expect(sent.body.reply.content).not.toContain(checkyFactorIds.opportunity)
    expect(sent.body.suggestions[0].content).not.toContain(checkyFactorIds.strength)
    expect(sent.body.suggestions[0].content).not.toContain(checkyFactorIds.opportunity)
    expect(sent.body.suggestions[0].suggestedStrategyDescription).toContain('Equipo comprometido')
    expect(sent.body.suggestions[0].suggestedStrategyDescription).toContain('Mercado en expansión')
    expect(sent.body.suggestions[0].evidenceIds).toEqual([checkyFactorIds.strength, checkyFactorIds.opportunity])
  })

  it('orchestrates the strategic analysis when the diagnostic has none, and reuses it afterwards', async () => {
    const db = makeDb('SUPERUSER')
    const aiService = { analyze: vi.fn(async () => aiResult), consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    // El diagnóstico todavía no tiene lectura estratégica guardada.
    ;(db.aIAnalysis.findUnique as unknown as { mockResolvedValueOnce: (value: unknown) => unknown }).mockResolvedValueOnce(null)
    const agent = request.agent(createApp(db, aiService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const first = await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: 'Revisa el diagnóstico completo' })
    expect(first.status).toBe(201)
    expect(aiService.analyze).toHaveBeenCalledOnce()
    expect(db.aIAnalysis.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { diagnosticId: diagnostic.id } }))
    // El contexto que recibe Checky ya lleva la lectura recién generada.
    const context = (aiService.consultChecky as unknown as { mock: { calls: [{ aiAnalysis: unknown }][] } }).mock.calls[0][0]
    expect(context.aiAnalysis).not.toBeNull()

    const second = await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: 'Y ahora prioriza' })
    expect(second.status).toBe(201)
    // Ya está guardada: no se vuelve a gastar la cuota ni a cambiar una lectura que el usuario leyó.
    expect(aiService.analyze).toHaveBeenCalledOnce()
  })

  it('reports a controlled error when the orchestrated analysis cannot be generated', async () => {
    const db = makeDb('SUPERUSER')
    ;(db.aIAnalysis.findUnique as unknown as { mockResolvedValueOnce: (value: unknown) => unknown }).mockResolvedValueOnce(null)
    const unconfigured = { analyze: vi.fn(async () => { throw new AIServiceError('NOT_CONFIGURED') }), consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    const unavailable = request.agent(createApp(db, unconfigured))
    await unavailable.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const response = await unavailable.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: 'Revisa el diagnóstico' })
    expect(response.status).toBe(503)
    expect(response.body).toEqual({ error: 'Checky is not configured' })
    expect(unconfigured.consultChecky).not.toHaveBeenCalled()
  })

  it('never orchestrates an analysis for a session from another company', async () => {
    const db = makeDb('COMPANY_ADMIN', member.id, null, admin.id)
    ;(db.aIAnalysis.findUnique as unknown as { mockResolvedValueOnce: (value: unknown) => unknown }).mockResolvedValueOnce(null)
    const aiService = { analyze: vi.fn(async () => aiResult), consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    const agent = request.agent(createApp(db, aiService))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    expect((await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: 'Intrusión' })).status).toBe(404)
    expect(aiService.analyze).not.toHaveBeenCalled()
    expect(aiService.consultChecky).not.toHaveBeenCalled()
  })

  it('builds the Checky context from the diagnostic, factors, crosses, analysis and recommendations', async () => {
    const db = makeDb()
    const findDiag = db.qualityDiagnostic.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }
    const seededItems = [
      { id: checkyFactorIds.strength, swotId: diagnostic.swotAnalysis.id, type: 'STRENGTH', description: 'Equipo comprometido', createdAt: new Date('2026-01-04') },
      { id: checkyFactorIds.opportunity, swotId: diagnostic.swotAnalysis.id, type: 'OPPORTUNITY', description: 'Mercado en expansión', createdAt: new Date('2026-01-04') },
    ]
    findDiag.mockResolvedValue({ ...diagnostic, company: { ...diagnostic.company }, swotAnalysis: { ...diagnostic.swotAnalysis, items: seededItems } })
    // Esta prueba es sobre el contexto, no sobre la vigencia: la lectura guardada tiene que pasar por
    // la comprobación de huella igual que en producción, así que se le da la de esta matriz.
    ;(db.aIAnalysis.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }).mockResolvedValue({ ...persistedAIAnalysis, swotFingerprint: swotFingerprint(seededItems) })
    const findCrosses = db.strategicCross.findMany as unknown as { mockResolvedValue: (value: unknown) => unknown }
    // La consolidación de estrategias lee los dos factores y la ponderación incluidos, igual que
    // haría Prisma: el contexto de Checky ya no se arma solo con los ids del cruce.
    findCrosses.mockResolvedValue([{
      ...strategicCrossFixture,
      factor1Id: checkyFactorIds.strength,
      factor2Id: checkyFactorIds.opportunity,
      origin: 'AI',
      factor1: { ...checkySwotItemFixtures.strength, swotId: diagnostic.swotAnalysis.id, createdAt: new Date('2026-01-04') },
      factor2: { ...checkySwotItemFixtures.opportunity, swotId: diagnostic.swotAnalysis.id, createdAt: new Date('2026-01-04') },
      weighting: null,
    }])
    const aiService = { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    const agent = request.agent(createApp(db, aiService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: 'Revisa el diagnóstico' })
    const context = (aiService.consultChecky as unknown as { mock: { calls: [{ question: string; swotItems: unknown[]; crosses: unknown[]; aiAnalysis: unknown; recommendations: unknown; strategies: Array<{ strategyRef: string; source: string; crossId: string | null; factorIds: string[]; weightedScore: number | null; weightingBand: string | null }> }][] } }).mock.calls[0][0]
    expect(context.question).toBe('Revisa el diagnóstico')
    expect(context.swotItems).toEqual([
      { id: checkyFactorIds.strength, type: 'STRENGTH', description: 'Equipo comprometido' },
      { id: checkyFactorIds.opportunity, type: 'OPPORTUNITY', description: 'Mercado en expansión' },
    ])
    expect(context.crosses).toEqual([{ id: strategicCrossFixture.id, crossType: 'FO', origin: 'AI', factor1Id: checkyFactorIds.strength, factor2Id: checkyFactorIds.opportunity, strategy: strategicCrossFixture.strategy }])
    expect(context.aiAnalysis).toEqual({ executiveSummary: persistedAIAnalysis.executiveSummary, keyFindings: persistedAIAnalysis.keyFindings, priorityRisks: persistedAIAnalysis.priorityRisks, priorityOpportunities: persistedAIAnalysis.priorityOpportunities })
    expect(context.recommendations).toEqual([])
    // La priorización consolidada entra con el cruce y con las cuatro estrategias del análisis con IA.
    // El cruce conserva sus factores reales y llega sin ponderar, porque este escenario no tiene fila guardada.
    expect(context.strategies.map((strategy) => strategy.source)).toEqual(['STRATEGIC_CROSS', 'AI_ANALYSIS', 'AI_ANALYSIS', 'AI_ANALYSIS', 'AI_ANALYSIS'])
    const crossStrategy = context.strategies[0]
    expect(crossStrategy).toMatchObject({ strategyRef: `cross:${strategicCrossFixture.id}`, source: 'STRATEGIC_CROSS', crossId: strategicCrossFixture.id, factorIds: [checkyFactorIds.strength, checkyFactorIds.opportunity], weightedScore: null, weightingBand: null })
    // Una estrategia de IA no tiene factores ni cruce: no hay ningún id que Checky pueda citar sobre ella.
    expect(context.strategies.slice(1).every((strategy) => strategy.crossId === null && strategy.factorIds.length === 0)).toBe(true)
  })

  it('never creates factors, crosses, action plans or tickets while consulting', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [recommendation])
    const aiService = { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    const agent = request.agent(createApp(db, aiService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Qué me falta?' })
    expect(db.sWOTItem.create).not.toHaveBeenCalled()
    expect(db.strategicCross.create).not.toHaveBeenCalled()
    expect(db.actionPlan.create).not.toHaveBeenCalled()
    expect(db.actionItem.create).not.toHaveBeenCalled()
    expect(db.ticket.create).not.toHaveBeenCalled()
    expect(db.recommendation.create).not.toHaveBeenCalled()
  })

  it('lets the user accept or reject a suggestion and refuses to decide twice', async () => {
    const db = makeDb()
    const aiService = { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    const agent = request.agent(createApp(db, aiService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const sent = await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Qué cruces me faltan?' })

    const accepted = await agent.patch(`/api/checky/sessions/${checkySessionFixture.id}/messages/${sent.body.suggestions[1].id}`).send({ status: 'ACCEPTED', decisionNote: 'Lo reviso con el equipo' })
    expect(accepted.status).toBe(200)
    expect(accepted.body.message.status).toBe('ACCEPTED')
    expect(accepted.body.message.decisionNote).toBe('Lo reviso con el equipo')

    const decided = await agent.patch(`/api/checky/sessions/${checkySessionFixture.id}/messages/${sent.body.suggestions[1].id}`).send({ status: 'REJECTED' })
    expect(decided.status).toBe(409)

    const rejected = await agent.patch(`/api/checky/sessions/${checkySessionFixture.id}/messages/${sent.body.suggestions[0].id}`).send({ status: 'REJECTED' })
    expect(rejected.status).toBe(200)
    expect(rejected.body.message.status).toBe('REJECTED')
    expect(db.strategicCross.create).not.toHaveBeenCalled()
  })

  it('refuses to decide on a user message or on a Checky reply', async () => {
    const db = makeDb()
    const aiService = { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    const agent = request.agent(createApp(db, aiService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const sent = await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Qué cruces me faltan?' })
    expect((await agent.patch(`/api/checky/sessions/${checkySessionFixture.id}/messages/${sent.body.userMessage.id}`).send({ status: 'ACCEPTED' })).status).toBe(400)
    expect((await agent.patch(`/api/checky/sessions/${checkySessionFixture.id}/messages/${sent.body.reply.id}`).send({ status: 'ACCEPTED' })).status).toBe(400)
    expect((await agent.patch(`/api/checky/sessions/${checkySessionFixture.id}/messages/${checkyMessageFixture.id}`).send({ status: 'PENDING' })).status).toBe(400)
  })

  it('returns a controlled error when Checky is not configured or returns an invalid analysis', async () => {
    const unconfiguredService = { consultChecky: vi.fn(async () => { throw new AIServiceError('NOT_CONFIGURED') }) } as unknown as AIService
    const unconfigured = request.agent(createApp(makeDb('SUPERUSER'), unconfiguredService))
    await unconfigured.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const unavailable = await unconfigured.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Qué debo revisar?' })
    expect(unavailable.status).toBe(503)
    expect(unavailable.body).toEqual({ error: 'Checky is not configured' })

    for (const code of ['INVALID_RESPONSE', 'PROVIDER_ERROR'] as const) {
      const invalidService = { consultChecky: vi.fn(async () => { throw new AIServiceError(code) }) } as unknown as AIService
      const agent = request.agent(createApp(makeDb('SUPERUSER'), invalidService))
      await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
      const invalid = await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Qué debo revisar?' })
      expect(invalid.status).toBe(502)
      expect(invalid.body).toEqual({ error: 'Checky returned an invalid analysis' })
    }
  })

  it('rejects invalid Checky payloads', async () => {
    const aiService = { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    const agent = request.agent(createApp(makeDb('SUPERUSER'), aiService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    expect((await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '' })).status).toBe(400)
    expect((await agent.post(`/api/diagnostics/${diagnostic.id}/checky/sessions`).send({ title: 'x' })).status).toBe(400)
    expect(aiService.consultChecky).not.toHaveBeenCalled()
  })

  it('blocks a company from reaching Checky through another company diagnostic, session or message', async () => {
    const db = makeDb('COMPANY_ADMIN', member.id, null, admin.id)
    const aiService = { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    const agent = request.agent(createApp(db, aiService))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    expect((await agent.post(`/api/diagnostics/${diagnostic.id}/checky/sessions`).send({ title: 'Intrusión' })).status).toBe(404)
    expect((await agent.get(`/api/diagnostics/${diagnostic.id}/checky/sessions`)).status).toBe(404)
    expect((await agent.get(`/api/checky/sessions/${checkySessionFixture.id}`)).status).toBe(404)
    expect((await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: 'Intrusión' })).status).toBe(404)
    expect((await agent.patch(`/api/checky/sessions/${checkySessionFixture.id}/messages/${checkyMessageFixture.id}`).send({ status: 'ACCEPTED' })).status).toBe(404)
    expect(aiService.consultChecky).not.toHaveBeenCalled()
  })

  it('blocks company users from creating sessions or sending messages', async () => {
    const aiService = { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    const agent = request.agent(createApp(makeDb('COMPANY_USER', companyUser.id, null, company.id), aiService))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    expect((await agent.post(`/api/diagnostics/${diagnostic.id}/checky/sessions`).send({ title: 'Revisión DOFA' })).status).toBe(403)
    expect((await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Qué debo revisar?' })).status).toBe(403)
    expect(aiService.consultChecky).not.toHaveBeenCalled()
  })

  it('rate limits Checky consultations to prevent cost abuse', async () => {
    const aiService = { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    const agent = request.agent(createApp(makeDb('SUPERUSER'), aiService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    for (let i = 0; i < 30; i += 1) {
      expect((await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: `Consulta ${i}` })).status).toBe(201)
    }
    const blocked = await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: 'Una más' })
    expect(blocked.status).toBe(429)
    expect(aiService.consultChecky).toHaveBeenCalledTimes(30)
  })

  describe('accepting a missing cross suggestion', () => {
    const missingCrossContent = 'Falta el cruce FO\nNo existe ningún cruce entre la fortaleza registrada y la oportunidad detectada.'
    const seedSuggestion = async (db: PrismaClient, overrides: Record<string, unknown> = {}) => {
      const created = await (db.checkyMessage.create as unknown as (args: unknown) => Promise<{ id: string }>)({
        data: {
          sessionId: checkySessionFixture.id, role: 'CHECKY', content: missingCrossContent, category: 'MISSING_CROSSES',
          basis: 'FACT', evidenceIds: [checkyFactorIds.strength, checkyFactorIds.opportunity],
          insufficientData: false, missingInformation: [], status: 'PENDING', decisionNote: null,
          suggestedStrategyTitle: checkySuggestedStrategyFixture.title, suggestedStrategyDescription: checkySuggestedStrategyFixture.description,
          ...overrides,
        },
      })
      return created.id
    }
    const loginAgent = async (db: PrismaClient, email = admin.email) => {
      const agent = request.agent(createApp(db, { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService))
      await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
      return agent
    }

    it('creates the StrategicCross, marks the suggestion accepted and uses the real database factors', async () => {
      const db = makeDb()
      const agent = await loginAgent(db)
      const suggestionId = await seedSuggestion(db)

      const accepted = await agent.post(`/api/checky/suggestions/${suggestionId}/accept`)
      expect(accepted.status).toBe(201)
      expect(accepted.body.suggestion.status).toBe('ACCEPTED')
      expect(accepted.body.cross.diagnosticId).toBe(diagnostic.id)
      expect(accepted.body.cross.factor1).toMatchObject({ id: checkyFactorIds.strength, type: 'STRENGTH' })
      expect(accepted.body.cross.factor2).toMatchObject({ id: checkyFactorIds.opportunity, type: 'OPPORTUNITY' })
      expect(db.strategicCross.create).toHaveBeenCalledTimes(1)
      expect(db.strategicCross.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
        diagnosticId: diagnostic.id, crossType: 'FO', origin: 'AI',
        factor1Id: checkyFactorIds.strength, factor2Id: checkyFactorIds.opportunity, createdById: admin.id,
      }) }))
      const read = await agent.get(`/api/checky/sessions/${checkySessionFixture.id}`)
      expect(read.body.messages.find((message: { id: string }) => message.id === suggestionId).status).toBe('ACCEPTED')
    })

    it('stores the structured strategy Checky suggested and leaves it null when the finding has none', async () => {
      const db = makeDb()
      const agent = await loginAgent(db)
      const withStrategy = await agent.post(`/api/checky/suggestions/${await seedSuggestion(db)}/accept`)
      expect(withStrategy.status).toBe(201)
      expect(withStrategy.body.cross.strategy).toBe(checkySuggestedStrategyFixture.description)

      const second = makeDb()
      const secondAgent = await loginAgent(second)
      const withoutStrategy = await secondAgent.post(`/api/checky/suggestions/${await seedSuggestion(second, { suggestedStrategyTitle: null, suggestedStrategyDescription: null })}/accept`)
      expect(withoutStrategy.status).toBe(201)
      expect(withoutStrategy.body.cross.strategy).toBeNull()
    })

    it('refuses to accept the same suggestion twice', async () => {
      const db = makeDb()
      const agent = await loginAgent(db)
      const suggestionId = await seedSuggestion(db)
      expect((await agent.post(`/api/checky/suggestions/${suggestionId}/accept`)).status).toBe(201)

      const second = await agent.post(`/api/checky/suggestions/${suggestionId}/accept`)
      expect(second.status).toBe(409)
      expect(second.body.error).toBe('This suggestion was already decided')
      expect(db.strategicCross.create).toHaveBeenCalledTimes(1)
    })

    it('does not create a cross when the suggestion is rejected', async () => {
      const db = makeDb()
      const agent = await loginAgent(db)
      const suggestionId = await seedSuggestion(db)
      const rejected = await agent.patch(`/api/checky/sessions/${checkySessionFixture.id}/messages/${suggestionId}`).send({ status: 'REJECTED' })
      expect(rejected.status).toBe(200)
      expect(rejected.body.message.status).toBe('REJECTED')
      expect(db.strategicCross.create).not.toHaveBeenCalled()
    })

    it('does not create a cross for a suggestion that is not a missing cross', async () => {
      const db = makeDb()
      const agent = await loginAgent(db)
      const suggestionId = await seedSuggestion(db, { category: 'REVIEW_ASPECTS' })
      const response = await agent.post(`/api/checky/suggestions/${suggestionId}/accept`)
      expect(response.status).toBe(400)
      expect(response.body.error).toBe('Only a missing cross suggestion can create a strategic cross')
      expect(db.strategicCross.create).not.toHaveBeenCalled()

      const userMessage = await (db.checkyMessage.create as unknown as (args: unknown) => Promise<{ id: string }>)({
        data: { sessionId: checkySessionFixture.id, role: 'USER', content: '¿Qué cruces me faltan?', evidenceIds: [], missingInformation: [] },
      })
      expect((await agent.post(`/api/checky/suggestions/${userMessage.id}/accept`)).status).toBe(400)
      expect((await agent.post('/api/checky/suggestions/cminexistente00000000001/accept')).status).toBe(404)
    })

    it('never accepts a missing cross through the plain decision endpoint', async () => {
      const db = makeDb()
      const agent = await loginAgent(db)
      const suggestionId = await seedSuggestion(db)
      const response = await agent.patch(`/api/checky/sessions/${checkySessionFixture.id}/messages/${suggestionId}`).send({ status: 'ACCEPTED' })
      expect(response.status).toBe(400)
      expect(db.strategicCross.create).not.toHaveBeenCalled()
      const read = await agent.get(`/api/checky/sessions/${checkySessionFixture.id}`)
      expect(read.body.messages.find((message: { id: string }) => message.id === suggestionId).status).toBe('PENDING')
    })

    it('cannot use factors that belong to another company or diagnostic', async () => {
      const db = makeDb()
      const agent = await loginAgent(db)
      const suggestionId = await seedSuggestion(db, { evidenceIds: [checkyFactorIds.strength, checkySwotItemFixtures.foreign.id] })
      const response = await agent.post(`/api/checky/suggestions/${suggestionId}/accept`)
      expect(response.status).toBe(400)
      expect(response.body.error).toBe('A missing cross suggestion must cite exactly two factors of this diagnostic')
      expect(db.sWOTItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ swot: { diagnosticId: diagnostic.id } }) }))
      expect(db.strategicCross.create).not.toHaveBeenCalled()
    })

    it('rejects a pair that is not a valid FO, DO, FA or DA cross', async () => {
      const db = makeDb()
      const agent = await loginAgent(db)
      const suggestionId = await seedSuggestion(db, { evidenceIds: [checkyFactorIds.strength, checkySwotItemFixtures.sameQuadrant.id] })
      const response = await agent.post(`/api/checky/suggestions/${suggestionId}/accept`)
      expect(response.status).toBe(400)
      expect(response.body.error).toBe('These factors do not form a valid strategic cross (FO, DO, FA or DA)')
      expect(db.strategicCross.create).not.toHaveBeenCalled()
    })

    it('accepts over the strategic cross that already exists for the pair instead of duplicating it', async () => {
      const existingCross: SeededCross = {
        id: 'cmcrossalreadythere0001',
        crossType: 'FO',
        origin: 'USER',
        factor1Id: checkyFactorIds.strength,
        factor2Id: checkyFactorIds.opportunity,
        strategy: 'Cruce registrado por la usuaria antes de la sugerencia de Checky.',
        weighting: null,
      }
      const db = makeDb('SUPERUSER', member.id, null, company.id, [], [existingCross])
      const agent = await loginAgent(db)
      const suggestionId = await seedSuggestion(db)

      const response = await agent.post(`/api/checky/suggestions/${suggestionId}/accept`)
      expect(response.status).toBe(201)
      expect(response.body.suggestion.status).toBe('ACCEPTED')
      // El cruce que ya existía es el que se devuelve: la Matriz DOFA manda y no se crea otro.
      expect(response.body.cross.id).toBe(existingCross.id)
      expect(db.strategicCross.create).not.toHaveBeenCalled()
      const read = await agent.get(`/api/checky/sessions/${checkySessionFixture.id}`)
      expect(read.body.messages.find((message: { id: string }) => message.id === suggestionId).status).toBe('ACCEPTED')
    })

    it('rolls back the suggestion when the cross cannot be created', async () => {
      const db = makeDb()
      const agent = await loginAgent(db)
      const createCross = db.strategicCross.create as unknown as { mockRejectedValueOnce: (error: Error) => unknown }
      createCross.mockRejectedValueOnce(new Error('database is unavailable'))
      const suggestionId = await seedSuggestion(db)

      const response = await agent.post(`/api/checky/suggestions/${suggestionId}/accept`)
      expect(response.status).toBe(500)
      expect(response.body.error).toBe('The strategic cross could not be created')
      const read = await agent.get(`/api/checky/sessions/${checkySessionFixture.id}`)
      expect(read.body.messages.find((message: { id: string }) => message.id === suggestionId).status).toBe('PENDING')
      expect(db.checkyMessage.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ACCEPTED' }) }))
    })

    it('keeps the same authorization rules for company users and other companies', async () => {
      const readOnly = request.agent(createApp(makeDb('COMPANY_USER', companyUser.id, null, company.id), { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService))
      await readOnly.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
      const blockedSuggestion = await seedSuggestion(makeDb())
      expect((await readOnly.post(`/api/checky/suggestions/${blockedSuggestion}/accept`)).status).toBe(403)

      const otherCompany = makeDb('COMPANY_ADMIN', member.id, null, admin.id)
      const intruderAgent = await loginAgent(otherCompany, member.email)
      const foreignSuggestion = await seedSuggestion(otherCompany)
      expect((await intruderAgent.post(`/api/checky/suggestions/${foreignSuggestion}/accept`)).status).toBe(404)
      expect(otherCompany.strategicCross.create).not.toHaveBeenCalled()
    })

    it('does not create recommendations, action plans, action items or tickets', async () => {
      const db = makeDb()
      const agent = await loginAgent(db)
      const suggestionId = await seedSuggestion(db)
      expect((await agent.post(`/api/checky/suggestions/${suggestionId}/accept`)).status).toBe(201)
      expect(db.recommendation.create).not.toHaveBeenCalled()
      expect(db.actionPlan.create).not.toHaveBeenCalled()
      expect(db.actionItem.create).not.toHaveBeenCalled()
      expect(db.ticket.create).not.toHaveBeenCalled()
      expect(db.sWOTItem.create).not.toHaveBeenCalled()
    })
  })

  describe('structured Checky strategy', () => {
    it('lets Checky return a suggested strategy for a finding', async () => {
      const service = new AIService(checkyClient(checkyConsultResult))
      const result = await service.consultChecky(checkyContext())
      expect(result.findings[0].suggestedStrategy).toEqual(checkySuggestedStrategyFixture)
    })

    it('validates the suggested strategy with Zod and rejects an empty one', async () => {
      const service = new AIService(checkyClient(checkyConsultResult))
      expect((await service.consultChecky(checkyContext())).findings[1].suggestedStrategy).toBeNull()

      const allowedIds = new Set([checkyFactorIds.strength, checkyFactorIds.opportunity])
      const schema = buildCheckyConsultSchema(allowedIds)
      const base = { reply: 'r', insufficientData: false, missingInformation: [] }
      const finding = { category: 'MISSING_CROSSES', title: 'Falta el cruce FO', detail: 'No existe el cruce FO entre los dos factores registrados.', basis: 'FACT', evidenceIds: [checkyFactorIds.strength, checkyFactorIds.opportunity] }
      expect(schema.safeParse({ ...base, findings: [{ ...finding, suggestedStrategy: checkySuggestedStrategyFixture }] }).success).toBe(true)
      expect(schema.safeParse({ ...base, findings: [{ ...finding, suggestedStrategy: null }] }).success).toBe(true)
      expect(schema.safeParse({ ...base, findings: [{ ...finding }] }).success).toBe(true)
      for (const empty of [
        { title: '', description: 'Una descripción suficientemente larga para pasar el mínimo.' },
        { title: '   ', description: 'Una descripción suficientemente larga para pasar el mínimo.' },
        { title: 'Título válido', description: '' },
        { title: 'Título válido', description: '   ' },
        { title: 'ok', description: 'corta' },
      ]) {
        expect(schema.safeParse({ ...base, findings: [{ ...finding, suggestedStrategy: empty }] }).success).toBe(false)
      }

      const emptyService = new AIService(checkyClient({
        ...checkyConsultResult,
        findings: [{ ...checkyConsultResult.findings[0], suggestedStrategy: { title: 'Título', description: '' } }],
      }))
      await expect(emptyService.consultChecky(checkyContext())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    })

    it('persists the suggested strategy of a missing cross as structured columns', async () => {
      const db = makeDb()
      const agent = request.agent(createApp(db, { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService))
      await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
      const sent = await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Qué cruces me faltan?' })
      expect(sent.status).toBe(201)
      expect(sent.body.suggestions[0].suggestedStrategyTitle).toBe(checkySuggestedStrategyFixture.title)
      expect(sent.body.suggestions[0].suggestedStrategyDescription).toBe(checkySuggestedStrategyFixture.description)
      expect(sent.body.suggestions[1].suggestedStrategyTitle).toBeNull()
      expect(sent.body.suggestions[1].suggestedStrategyDescription).toBeNull()
      expect(db.checkyMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
        suggestedStrategyTitle: checkySuggestedStrategyFixture.title,
        suggestedStrategyDescription: checkySuggestedStrategyFixture.description,
      }) }))

      const read = await agent.get(`/api/checky/sessions/${checkySessionFixture.id}`)
      expect(read.body.messages.find((message: { id: string }) => message.id === sent.body.suggestions[0].id).suggestedStrategyDescription).toBe(checkySuggestedStrategyFixture.description)
    })

    it('uses the structured description on accept and ignores an "Estrategia:" label in the content', async () => {
      const db = makeDb()
      const agent = request.agent(createApp(db, { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService))
      await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
      const sent = await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Qué cruces me faltan?' })
      const accepted = await agent.post(`/api/checky/suggestions/${sent.body.suggestions[0].id}/accept`)
      expect(accepted.status).toBe(201)
      expect(accepted.body.cross.strategy).toBe(checkySuggestedStrategyFixture.description)
      expect(accepted.body.suggestion.suggestedStrategyTitle).toBe(checkySuggestedStrategyFixture.title)

      const second = makeDb()
      const secondAgent = request.agent(createApp(second, { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService))
      await secondAgent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
      const withLabel = await (second.checkyMessage.create as unknown as (args: unknown) => Promise<{ id: string }>)({
        data: {
          sessionId: checkySessionFixture.id, role: 'CHECKY', content: 'Falta el cruce FO\nNo existe el cruce. Estrategia: mejorarlo con estándares del sector',
          category: 'MISSING_CROSSES', basis: 'FACT', evidenceIds: [checkyFactorIds.strength, checkyFactorIds.opportunity],
          insufficientData: false, missingInformation: [], status: 'PENDING', decisionNote: null,
          suggestedStrategyTitle: null, suggestedStrategyDescription: null,
        },
      })
      const labelOnly = await secondAgent.post(`/api/checky/suggestions/${withLabel.id}/accept`)
      expect(labelOnly.status).toBe(201)
      expect(labelOnly.body.cross.strategy).toBeNull()
    })

    it('keeps rejecting a suggestion without creating a cross', async () => {
      const db = makeDb()
      const agent = request.agent(createApp(db, { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService))
      await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
      const sent = await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Qué cruces me faltan?' })
      const rejected = await agent.patch(`/api/checky/sessions/${checkySessionFixture.id}/messages/${sent.body.suggestions[0].id}`).send({ status: 'REJECTED' })
      expect(rejected.status).toBe(200)
      expect(rejected.body.message.status).toBe('REJECTED')
      expect(rejected.body.message.suggestedStrategyTitle).toBe(checkySuggestedStrategyFixture.title)
      expect(db.strategicCross.create).not.toHaveBeenCalled()
    })
  })

  describe('strategic cross weighting API', () => {
    const criteria = { impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'MUY_ALTO', sinergiaInterna: 'BAJO', impactoReputacional: 'MEDIO' }
    // 4*0.20 + 3*0.25 + 5*0.20 + 2*0.15 + 3*0.20
    const expectedScore = 3.45
    const withCross = (db: PrismaClient, overrides: Record<string, unknown> = {}) => {
      const findCross = db.strategicCross.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }
      findCross.mockResolvedValue({
        ...strategicCrossFixture,
        factor1: { id: strategicCrossFixture.factor1Id, swotId: diagnostic.swotAnalysis.id, type: 'STRENGTH', description: 'Equipo comprometido', createdAt: new Date('2026-01-04') },
        factor2: { id: strategicCrossFixture.factor2Id, swotId: diagnostic.swotAnalysis.id, type: 'OPPORTUNITY', description: 'Nuevo mercado', createdAt: new Date('2026-01-04') },
        diagnostic: { companyId: company.id, company: { id: company.id, name: company.name } },
        ...overrides,
      })
      return db
    }
    const loginAgent = async (db: PrismaClient, email = admin.email) => {
      const agent = request.agent(createApp(db, { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService))
      await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
      return agent
    }

    it('calculates the weighted score in the backend when a weighting is created', async () => {
      const db = withCross(makeDb())
      const agent = await loginAgent(db)
      const response = await agent.put(`/api/crosses/${strategicCrossFixture.id}/weighting`).send(criteria)
      expect(response.status).toBe(200)
      expect(response.body.weighting).toMatchObject({ ...criteria, crossId: strategicCrossFixture.id, weightedScore: expectedScore, createdById: admin.id })
      expect(db.strategicCrossWeighting.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { crossId: strategicCrossFixture.id },
        create: expect.objectContaining({ ...criteria, weightedScore: expectedScore }),
      }))
    })

    it('updates the criteria of an existing weighting instead of creating a second one', async () => {
      const db = withCross(makeDb())
      const agent = await loginAgent(db)
      await agent.put(`/api/crosses/${strategicCrossFixture.id}/weighting`).send(criteria)
      const updated = await agent.put(`/api/crosses/${strategicCrossFixture.id}/weighting`).send({ ...criteria, viabilidad: 'MUY_ALTO', sinergiaInterna: 'MUY_ALTO' })
      expect(updated.status).toBe(200)
      expect(updated.body.weighting.viabilidad).toBe('MUY_ALTO')
      // 4*0.20 + 5*0.25 + 5*0.20 + 5*0.15 + 3*0.20
      expect(updated.body.weighting.weightedScore).toBe(4.4)
      const upsert = db.strategicCrossWeighting.upsert as unknown as { mock: { calls: Array<[{ where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }]> } }
      expect(upsert.mock.calls).toHaveLength(2)
      expect(upsert.mock.calls[1][0].create).toBeDefined()
      expect(upsert.mock.calls[1][0].update).toMatchObject({ viabilidad: 'MUY_ALTO', sinergiaInterna: 'MUY_ALTO', weightedScore: 4.4 })
      expect(upsert.mock.calls[1][0].where).toEqual({ crossId: strategicCrossFixture.id })
      const list = await agent.get(`/api/diagnostics/${diagnostic.id}/weightings`)
      expect(list.body.weightings).toHaveLength(1)
      const read = await agent.get(`/api/crosses/${strategicCrossFixture.id}/weighting`)
      expect(read.status).toBe(200)
      expect(read.body.weighting.weightedScore).toBe(4.4)
    })

    it('never lets the client set the weighted score or any extra field', async () => {
      const db = withCross(makeDb())
      const agent = await loginAgent(db)
      for (const payload of [
        { ...criteria, weightedScore: 99 },
        { ...criteria, weightedScore: 1 },
        { ...criteria, crossId: 'cmcrossotro000000000000001' },
        { ...criteria, createdById: member.id },
      ]) {
        const response = await agent.put(`/api/crosses/${strategicCrossFixture.id}/weighting`).send(payload)
        expect(response.status).toBe(400)
        expect(response.body.error).toBe('Invalid weighting data')
      }
      expect(db.strategicCrossWeighting.upsert).not.toHaveBeenCalled()

      const ignored = await agent.put(`/api/crosses/${strategicCrossFixture.id}/weighting`).send({ ...criteria, weightedScore: 1 })
      expect(ignored.status).toBe(400)
    })

    it('rejects a weighting with an unknown, missing or blank level', async () => {
      const db = withCross(makeDb())
      const agent = await loginAgent(db)
      for (const payload of [
        { ...criteria, viabilidad: 'MUY_ALTO ' },
        { ...criteria, viabilidad: 'ALTISIMO' },
        { ...criteria, viabilidad: 4 },
        { ...criteria, viabilidad: '' },
        { impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'MUY_ALTO', sinergiaInterna: 'BAJO' },
        { ...criteria, extra: 'x' },
      ]) {
        expect((await agent.put(`/api/crosses/${strategicCrossFixture.id}/weighting`).send(payload)).status).toBe(400)
      }
      expect(db.strategicCrossWeighting.upsert).not.toHaveBeenCalled()
    })

    it('refuses to weigh a strategic cross that has no strategy', async () => {
      const db = withCross(makeDb(), { strategy: null })
      const agent = await loginAgent(db)
      const response = await agent.put(`/api/crosses/${strategicCrossFixture.id}/weighting`).send(criteria)
      expect(response.status).toBe(400)
      expect(response.body.error).toBe('This strategic cross has no strategy to evaluate')
      expect(db.strategicCrossWeighting.upsert).not.toHaveBeenCalled()
    })

    it('returns the weighting of a cross and 404 when it has none', async () => {
      const db = withCross(makeDb())
      const agent = await loginAgent(db)
      expect((await agent.get(`/api/crosses/${strategicCrossFixture.id}/weighting`)).status).toBe(404)
      await agent.put(`/api/crosses/${strategicCrossFixture.id}/weighting`).send(criteria)
      const read = await agent.get(`/api/crosses/${strategicCrossFixture.id}/weighting`)
      expect(read.status).toBe(200)
      expect(read.body.weighting).toMatchObject({ ...criteria, weightedScore: expectedScore })
    })

    it('lists the weightings of a diagnostic ordered by weighted score', async () => {
      const secondCrossId = 'cmcross000000000000000002'
      const db = withCross(makeDb())
      const agent = await loginAgent(db)
      await agent.put(`/api/crosses/${strategicCrossFixture.id}/weighting`).send(criteria)
      withCross(db, { id: secondCrossId })
      // 4*0.20 + 3*0.25 + 1*0.20 + 1*0.15 + 3*0.20
      await agent.put(`/api/crosses/${secondCrossId}/weighting`).send({ ...criteria, urgencia: 'MUY_BAJO', sinergiaInterna: 'MUY_BAJO' })
      const list = await agent.get(`/api/diagnostics/${diagnostic.id}/weightings`)
      expect(list.status).toBe(200)
      expect(list.body.weightings).toHaveLength(2)
      expect(list.body.weightings[0]).toMatchObject({ crossId: strategicCrossFixture.id, weightedScore: expectedScore })
      expect(list.body.weightings[1]).toMatchObject({ crossId: secondCrossId, weightedScore: 2.5 })
      expect(list.body.weightings[0].weightedScore).toBeGreaterThan(list.body.weightings[1].weightedScore)
      const findMany = db.strategicCrossWeighting.findMany as unknown as { mock: { calls: [{ where: { cross: { diagnosticId: string } } }][] } }
      expect(findMany.mock.calls[0][0].where.cross.diagnosticId).toBe(diagnostic.id)
    })

    it('weighs crosses of any origin without ever writing to the cross itself', async () => {
      for (const origin of ['USER', 'AI', 'BOTH'] as const) {
        const db = withCross(makeDb(), { origin })
        const agent = await loginAgent(db)
        const response = await agent.put(`/api/crosses/${strategicCrossFixture.id}/weighting`).send(criteria)
        expect(response.status).toBe(200)
        expect(response.body.weighting.weightedScore).toBe(expectedScore)
        expect(db.strategicCross.update).not.toHaveBeenCalled()
        expect(db.strategicCross.create).not.toHaveBeenCalled()
        expect(db.strategicCross.delete).not.toHaveBeenCalled()
      }

      const adminDb = withCross(makeDb())
      const adminAgent = await loginAgent(adminDb)
      const byAdmin = await adminAgent.put(`/api/crosses/${strategicCrossFixture.id}/weighting`).send(criteria)
      expect(byAdmin.body.weighting.createdById).toBe(admin.id)

      const memberDb = withCross(makeDb('COMPANY_ADMIN', member.id, null, company.id))
      const memberAgent = await loginAgent(memberDb, member.email)
      const byMember = await memberAgent.put(`/api/crosses/${strategicCrossFixture.id}/weighting`).send(criteria)
      expect(byMember.status).toBe(200)
      expect(byMember.body.weighting.createdById).toBe(member.id)
    })

    it('does not let another company reach a cross weighting', async () => {
      const db = withCross(makeDb('COMPANY_ADMIN', member.id, null, admin.id))
      const agent = await loginAgent(db, member.email)
      expect((await agent.put(`/api/crosses/${strategicCrossFixture.id}/weighting`).send(criteria)).status).toBe(404)
      expect((await agent.get(`/api/crosses/${strategicCrossFixture.id}/weighting`)).status).toBe(404)
      expect((await agent.get(`/api/diagnostics/${diagnostic.id}/weightings`)).status).toBe(404)
      expect(db.strategicCrossWeighting.upsert).not.toHaveBeenCalled()
    })

    it('blocks company users from evaluating or deleting anything', async () => {
      const db = withCross(makeDb('COMPANY_USER', companyUser.id, null, company.id))
      const agent = await loginAgent(db, member.email)
      expect((await agent.put(`/api/crosses/${strategicCrossFixture.id}/weighting`).send(criteria)).status).toBe(403)
      expect(db.strategicCrossWeighting.upsert).not.toHaveBeenCalled()
      // Company users keep read access, same as the rest of the diagnostic.
      const withWeighting = withCross(makeDb('COMPANY_USER', companyUser.id, null, company.id))
      const readOnly = await loginAgent(withWeighting, member.email)
      await (withWeighting.strategicCrossWeighting.upsert as unknown as (args: unknown) => Promise<unknown>)({
        where: { crossId: strategicCrossFixture.id },
        create: { crossId: strategicCrossFixture.id, ...criteria, weightedScore: expectedScore, createdById: member.id },
        update: {},
      })
      expect((await readOnly.get(`/api/crosses/${strategicCrossFixture.id}/weighting`)).status).toBe(200)
    })

    it('requires authentication on every weighting endpoint', async () => {
      const db = withCross(makeDb())
      const anonymous = request(createApp(db, { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService))
      expect((await anonymous.put(`/api/crosses/${strategicCrossFixture.id}/weighting`).send(criteria)).status).toBe(401)
      expect((await anonymous.get(`/api/crosses/${strategicCrossFixture.id}/weighting`)).status).toBe(401)
      expect((await anonymous.get(`/api/diagnostics/${diagnostic.id}/weightings`)).status).toBe(401)
    })

    it('validates the weighting payload with Zod', () => {
      expect(crossWeightingSchema.safeParse(criteria).success).toBe(true)
      expect(crossWeightingSchema.safeParse({ ...criteria, impactoEstrategico: 'MUY_ALTO', viabilidad: 'MUY_BAJO', urgencia: 'MEDIO', sinergiaInterna: 'ALTO', impactoReputacional: 'BAJO' }).success).toBe(true)
      expect(crossWeightingSchema.safeParse({ ...criteria, weightedScore: 5 }).success).toBe(false)
      expect(crossWeightingSchema.safeParse({ ...criteria, urgencia: 'MUY_ALTO!' }).success).toBe(false)
      expect(crossWeightingSchema.safeParse({ ...criteria, sinergiaInterna: 1 }).success).toBe(false)
      expect(crossWeightingSchema.safeParse(criteria).data).toEqual(criteria)
    })
  })
})

describe('Checky weighting context', () => {
  const weightingCriteria = {
    impactoEstrategico: 'ALTO' as const, viabilidad: 'MEDIO' as const, urgencia: 'MUY_ALTO' as const,
    sinergiaInterna: 'BAJO' as const, impactoReputacional: 'MEDIO' as const,
  }
  const crossIds = { immediate: 'cmcrossinmediata000000001', shortTerm: 'cmcrosscorto00000000002', midTerm: 'cmcrossmedio0000000003', unweighted: 'cmcrosssinpeso000000004', bare: 'cmcrosssinestr00000005', lowFeasible: 'cmcrossviablebaja0000006' }
  // Tres cruces ponderados que caen en bandas distintas, uno pendiente, uno sin estrategia y otro
  // con impacto alto pero viabilidad baja.
  const seededCrosses: SeededCross[] = [
    { id: crossIds.immediate, crossType: 'FO', origin: 'USER', factor1Id: checkyFactorIds.strength, factor2Id: checkyFactorIds.opportunity, strategy: 'Llevar el equipo al mercado en expansión', weighting: { ...weightingCriteria, weightedScore: 4.4 } },
    { id: crossIds.shortTerm, crossType: 'DO', origin: 'AI', factor1Id: checkySwotItemFixtures.sameQuadrant.id, factor2Id: checkyFactorIds.opportunity, strategy: 'Corregir procesos antes de entrar', weighting: { ...weightingCriteria, weightedScore: 3.2 } },
    { id: crossIds.midTerm, crossType: 'FA', origin: 'USER', factor1Id: checkyFactorIds.strength, factor2Id: checkySwotItemFixtures.foreign.id, strategy: 'Blindar la operación frente al mercado', weighting: { ...weightingCriteria, weightedScore: 2.5 } },
    { id: crossIds.unweighted, crossType: 'DA', origin: 'USER', factor1Id: checkySwotItemFixtures.sameQuadrant.id, factor2Id: checkySwotItemFixtures.foreign.id, strategy: 'Estrategia escrita pero nunca ponderada', weighting: null },
    { id: crossIds.bare, crossType: 'FO', origin: 'USER', factor1Id: checkyFactorIds.strength, factor2Id: checkySwotItemFixtures.sameQuadrant.id, strategy: '   ', weighting: { ...weightingCriteria, weightedScore: 3.9 } },
    { id: crossIds.lowFeasible, crossType: 'DO', origin: 'AI', factor1Id: checkySwotItemFixtures.sameQuadrant.id, factor2Id: checkyFactorIds.opportunity, strategy: 'Reestructurar por completo la operación', weighting: { ...weightingCriteria, viabilidad: 'MUY_BAJO', impactoEstrategico: 'MUY_ALTO', weightedScore: 3.05 } },
  ]

  /** Corre la ruta real de Checky y devuelve el contexto exacto que recibe la IA. */
  const captureContext = async (crosses: SeededCross[], role: Role = 'SUPERUSER', userCompanyId: string | null = company.id) => {
    const db = makeDb(role, member.id, null, userCompanyId, [], crosses)
    let captured: CheckyContext | null = null
    const aiService = { consultChecky: vi.fn(async (context: CheckyContext) => { captured = context; return checkyConsultResult }) } as unknown as AIService
    const agent = request.agent(createApp(db, aiService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    const sent = await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Por dónde empiezo?' })
    return { db, sent, context: captured as unknown as CheckyContext, aiService }
  }

  /**
   * Lee el workMap tal cual viaja en el prompt, que es lo que el modelo recibe. El mock compartido
   * del diagnóstico devuelve swotAnalysis.items vacío, así que se completan los dos factores del
   * escenario: son los que hacen válidos los evidenceIds de la respuesta y no afectan a los conteos.
   */
  const workMapFrom = async (context: CheckyContext) => {
    const create = vi.fn(async () => ({ output_text: JSON.stringify(checkyConsultResult) }))
    const swotItems = [checkySwotItemFixtures.strength, checkySwotItemFixtures.opportunity, checkySwotItemFixtures.sameQuadrant, checkySwotItemFixtures.foreign]
    await new AIService({ responses: { create } } as unknown as { responses: { create: (input: unknown) => Promise<{ output_text?: string }> } }).consultChecky({ ...context, swotItems })
    const input = (create.mock.calls[0] as unknown as [{ input: string }])[0].input
    return JSON.parse(input.slice(input.indexOf('{'))).workMap as {
      crosses: Array<{ id: string; weightedScore: number | null; weightingBand: string | null; hasWeighting: boolean }>
      totalStrategies: number
      evaluatedStrategies: number
      pendingStrategies: number
      priorityCounts: Record<string, number>
      highPriorityStrategies: Array<{ crossId: string; weightedScore: number; weightingBand: string }>
      lowFeasibilityHighImpact: Array<{ crossId: string; viabilidad: string; impactoEstrategico: string }>
      crossesWithoutStrategy: string[]
      strategiesWithoutWeighting: string[]
    }
  }

  it('sends each stored weighting with its cross, its five levels and its factors', async () => {
    const { sent, context } = await captureContext(seededCrosses)
    expect(sent.status).toBe(201)
    const weighting = context.weightings?.find((entry) => entry.crossId === crossIds.immediate)
    expect(weighting).toEqual({
      crossId: crossIds.immediate,
      crossType: 'FO',
      origin: 'USER',
      strategy: 'Llevar el equipo al mercado en expansión',
      weightedScore: 4.4,
      weightingBand: 'INMEDIATA',
      criteria: weightingCriteria,
      factors: [
        { id: checkyFactorIds.strength, type: 'STRENGTH', description: 'Equipo comprometido' },
        { id: checkyFactorIds.opportunity, type: 'OPPORTUNITY', description: 'Mercado en expansión' },
      ],
    })
  })

  it('classifies every stored weighted score with the methodology bands without recalculating it', async () => {
    const { context } = await captureContext(seededCrosses)
    expect((context.weightings ?? []).map((entry) => [entry.weightedScore, entry.weightingBand])).toEqual([
      [4.4, 'INMEDIATA'], [3.2, 'CORTO_PLAZO'], [2.5, 'MEDIANO_PLAZO'], [3.9, 'CORTO_PLAZO'], [3.05, 'CORTO_PLAZO'],
    ])
    expect(resolveWeightingBand(5)).toBe('INMEDIATA')
    expect(resolveWeightingBand(4)).toBe('INMEDIATA')
    expect(resolveWeightingBand(3.99)).toBe('CORTO_PLAZO')
    expect(resolveWeightingBand(2)).toBe('MEDIANO_PLAZO')
    expect(resolveWeightingBand(1)).toBe('LARGO_PLAZO')
  })

  it('counts the strategies that are still pending and lists their ids', async () => {
    const { context } = await captureContext(seededCrosses)
    const workMap = await workMapFrom(context)
    // Cinco de los seis cruces tienen estrategia escrita: el que solo tiene espacios en blanco no cuenta.
    expect(workMap.totalStrategies).toBe(5)
    expect(workMap.evaluatedStrategies).toBe(4)
    expect(workMap.pendingStrategies).toBe(1)
    expect(workMap.strategiesWithoutWeighting).toEqual([crossIds.unweighted])
    expect(context.weightings?.map((entry) => entry.crossId)).not.toContain(crossIds.unweighted)
  })

  it('counts the evaluated strategies per priority band', async () => {
    const { context } = await captureContext(seededCrosses)
    const workMap = await workMapFrom(context)
    expect(workMap.priorityCounts).toEqual({ INMEDIATA: 1, CORTO_PLAZO: 2, MEDIANO_PLAZO: 1, LARGO_PLAZO: 0 })
  })

  it('surfaces the high priority strategies in descending order of their stored score', async () => {
    const { context } = await captureContext(seededCrosses)
    const workMap = await workMapFrom(context)
    expect(workMap.highPriorityStrategies).toEqual([{ crossId: crossIds.immediate, crossType: 'FO', strategy: 'Llevar el equipo al mercado en expansión', weightedScore: 4.4, weightingBand: 'INMEDIATA' }])
  })

  it('flags low feasibility with high impact from the stored levels', async () => {
    const { context } = await captureContext(seededCrosses)
    const workMap = await workMapFrom(context)
    expect(workMap.lowFeasibilityHighImpact).toEqual([{ crossId: crossIds.lowFeasible, crossType: 'DO', strategy: 'Reestructurar por completo la operación', weightedScore: 3.05, weightingBand: 'CORTO_PLAZO', viabilidad: 'MUY_BAJO', impactoEstrategico: 'MUY_ALTO' }])
  })

  it('lists the crosses that have no strategy written yet', async () => {
    const { context } = await captureContext(seededCrosses)
    const workMap = await workMapFrom(context)
    expect(workMap.crossesWithoutStrategy).toEqual([crossIds.bare])
  })

  it('keeps the weighting and the work map stable when no crossing has been weighted', async () => {
    const { context } = await captureContext([{ id: crossIds.unweighted, crossType: 'DA', origin: 'USER', factor1Id: checkyFactorIds.strength, factor2Id: checkyFactorIds.opportunity, strategy: 'Sin ponderar todavía', weighting: null }])
    expect(context.weightings).toEqual([])
    const workMap = await workMapFrom(context)
    expect(workMap.totalStrategies).toBe(1)
    expect(workMap.evaluatedStrategies).toBe(0)
    expect(workMap.pendingStrategies).toBe(1)
    expect(workMap.priorityCounts).toEqual({ INMEDIATA: 0, CORTO_PLAZO: 0, MEDIANO_PLAZO: 0, LARGO_PLAZO: 0 })
    expect(workMap.highPriorityStrategies).toEqual([])
    expect(workMap.lowFeasibilityHighImpact).toEqual([])
    expect(workMap.strategiesWithoutWeighting).toEqual([crossIds.unweighted])
  })

  it('reads the weightings of the requested diagnostic only and never writes while reading', async () => {
    const { db, context } = await captureContext(seededCrosses)
    const findMany = db.strategicCross.findMany as unknown as { mock: { calls: Array<[{ where: { diagnosticId: string }; include: Record<string, boolean> }]> } }
    expect(findMany.mock.calls[0][0].where).toEqual({ diagnosticId: diagnostic.id })
    expect(findMany.mock.calls[0][0].include).toMatchObject({ weighting: true, factor1: true, factor2: true })
    expect(context.weightings?.every((entry) => seededCrosses.some((cross) => cross.id === entry.crossId))).toBe(true)
    expect(db.strategicCrossWeighting.upsert).not.toHaveBeenCalled()
    expect(db.strategicCrossWeighting.findMany).not.toHaveBeenCalled()
  })

  it('keeps the weighting context inside the company and never leaks it to another tenant', async () => {
    const aiService = { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    const db = makeDb('COMPANY_ADMIN', member.id, null, company.id, [], seededCrosses)
    const intruder = request.agent(createApp(db, aiService))
    await intruder.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    const foreignSession = makeDb('COMPANY_ADMIN', member.id, null, admin.id, [], seededCrosses)
    const foreignAgent = request.agent(createApp(foreignSession, aiService))
    await foreignAgent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })

    expect((await foreignAgent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: 'Intrusión' })).status).toBe(404)
    expect(aiService.consultChecky).not.toHaveBeenCalled()
    expect(foreignSession.strategicCross.findMany).not.toHaveBeenCalled()
    expect(db.strategicCrossWeighting.upsert).not.toHaveBeenCalled()
  })

  it('keeps the current evidence id validation, so a weighting id is still not evidence', async () => {
    const { context } = await captureContext(seededCrosses)
    const respondWith = (evidenceIds: string[]) => ({ responses: { create: vi.fn(async () => ({ output_text: JSON.stringify({ ...checkyConsultResult, findings: [{ ...checkyConsultResult.findings[0], evidenceIds }, checkyConsultResult.findings[1]] }) })) } })
    const swotItems = [checkySwotItemFixtures.strength, checkySwotItemFixtures.opportunity, checkySwotItemFixtures.sameQuadrant, checkySwotItemFixtures.foreign]
    const withFactors = { ...context, swotItems }

    // Un factor y un cruce siguen siendo evidencia válida: la validación no se estrecha.
    await expect(new AIService(respondWith([checkyFactorIds.strength, checkyFactorIds.opportunity])).consultChecky(withFactors)).resolves.toMatchObject({ insufficientData: false })
    await expect(new AIService(respondWith([crossIds.immediate])).consultChecky(withFactors)).resolves.toMatchObject({ insufficientData: false })
    // Un id de ponderación no es un factor ni un cruce, así que sigue invalidando la respuesta.
    await expect(new AIService(respondWith([`cmweighting${crossIds.immediate}`])).consultChecky(withFactors)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})

describe('Checky strategic recommendations', () => {
  // Factores propios de este bloque: los del escenario compartido no alcanzan para seis cruces con
  // pares válidos, y añadirlos ahí alteraría los conteos de los tests de DOFA existentes.
  const f = {
    strength: { id: 'cmcheckystrength00000000001', type: 'STRENGTH', description: 'Equipo comprometido' },
    strength2: { id: 'cmcheckystrength00000000002', type: 'STRENGTH', description: 'Tecnología propia' },
    weakness: { id: 'cmcheckyweakness000000000001', type: 'WEAKNESS', description: 'Procesos lentos' },
    opportunity: { id: 'cmcheckyopportun0000000001', type: 'OPPORTUNITY', description: 'Mercado en expansión' },
    opportunity2: { id: 'cmcheckyopportun0000000002', type: 'OPPORTUNITY', description: 'Nuevo segmento' },
    threat: { id: 'cmcheckythreat0000000000001', type: 'THREAT', description: 'Normativa nueva' },
    threat2: { id: 'cmcheckythreat0000000000002', type: 'THREAT', description: 'Competencia #' },
  }
  const allFactors = Object.values(f)
  const c = { prio: 'cmcheckyprio000000000000001', alsoHigh: 'cmcheckyprio000000000000002', medium: 'cmcheckymedium000000000001', unweighted: 'cmcheckyunweighted00000001', bare: 'cmcheckybare0000000000001', weightedBare: 'cmcheckyweightedbare0001', unweightedShort: 'cmcheckyunweighted0002' }
  const impactLowViability = { impactoEstrategico: 'MUY_ALTO' as const, viabilidad: 'MUY_BAJO' as const, urgencia: 'MUY_ALTO' as const, sinergiaInterna: 'MEDIO' as const, impactoReputacional: 'ALTO' as const }
  const balanced = { impactoEstrategico: 'MEDIO' as const, viabilidad: 'ALTO' as const, urgencia: 'MEDIO' as const, sinergiaInterna: 'MEDIO' as const, impactoReputacional: 'MEDIO' as const }
  const crosses: SeededCross[] = [
    { id: c.prio, crossType: 'FO', origin: 'USER', factor1Id: f.strength.id, factor2Id: f.opportunity.id, strategy: 'Llevar el equipo al mercado en expansión antes de que se consolide', weighting: { ...impactLowViability, weightedScore: 4.4 } },
    { id: c.alsoHigh, crossType: 'DO', origin: 'USER', factor1Id: f.weakness.id, factor2Id: f.opportunity2.id, strategy: 'Alinear el proceso con el nuevo segmento desde el primer trimestre', weighting: { ...impactLowViability, weightedScore: 4.45 } },
    { id: c.medium, crossType: 'DO', origin: 'AI', factor1Id: f.weakness.id, factor2Id: f.opportunity.id, strategy: 'Corregir el cuello de botella antes de escalar la operación', weighting: { ...balanced, weightedScore: 3.3 } },
    { id: c.unweighted, crossType: 'DA', origin: 'USER', factor1Id: f.weakness.id, factor2Id: f.threat.id, strategy: 'Blindar la operación ante el cambio normativo', weighting: null },
    { id: c.bare, crossType: 'FA', origin: 'USER', factor1Id: f.strength.id, factor2Id: f.threat.id, strategy: '   ', weighting: null },
    { id: c.weightedBare, crossType: 'FO', origin: 'AI', factor1Id: f.strength2.id, factor2Id: f.opportunity2.id, strategy: null, weighting: { ...balanced, weightedScore: 3.8 } },
    { id: c.unweightedShort, crossType: 'DO', origin: 'USER', factor1Id: f.strength2.id, factor2Id: f.threat.id, strategy: 'Urge', weighting: null },
  ]

  /** Contexto real (BD incluida) más los factores del escenario, que el mock de DOFA deja vacíos. */
  const contextFor = async (seeded: SeededCross[] = crosses) => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], seeded)
    let captured: CheckyContext | null = null
    const agent = request.agent(createApp(db, { consultChecky: vi.fn(async (context: CheckyContext) => { captured = context; return checkyConsultResult }) } as unknown as AIService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Qué debería hacer primero?' })
    return { db, context: { ...(captured as unknown as CheckyContext), swotItems: allFactors } }
  }

  /** Corre el servicio real y devuelve el resultado validado y el bloque que viaja en el prompt. */
  const consult = async (context: CheckyContext, output: unknown = defaultResult) => {
    const create = vi.fn(async () => ({ output_text: JSON.stringify(output) }))
    const result = await new AIService({ responses: { create } } as unknown as { responses: { create: (input: unknown) => Promise<{ output_text?: string }> } }).consultChecky(context)
    const input = (create.mock.calls[0] as unknown as [{ input: string }])[0].input
    return { result, analysis: JSON.parse(input.slice(input.indexOf('{'))).analysis, workMap: JSON.parse(input.slice(input.indexOf('{'))).workMap }
  }

  const finding = (overrides: Record<string, unknown>) => ({ category: 'REVIEW_ASPECTS', title: 'Ordenar el ataque', detail: 'Detalle con motivo y evidencia.', basis: 'FACT', evidenceIds: [c.prio, f.strength.id], suggestedStrategy: null, ...overrides })
  /** Respuesta por defecto del bloque: cita ids de este escenario, no los del escenario compartido. */
  const defaultResult = {
    reply: 'Hay trabajo por hacer en la priorización.',
    insufficientData: false,
    missingInformation: [],
    findings: [finding({}), finding({ category: 'STRATEGIC_RISKS', title: 'Riesgo', detail: 'Otro motivo con evidencia.', basis: 'INFERENCE' as const, evidenceIds: [c.alsoHigh, f.opportunity2.id] })],
  }

  it('drops a suggested cross that already exists, whichever order the factors arrive in', async () => {
    const { context } = await contextFor()
    const cross = (overrides: Record<string, unknown>) => finding({ category: 'MISSING_CROSSES', suggestedStrategy: null, ...overrides })
    // `c.prio` es el cruce strength + opportunity que el usuario ya registró. La comparación es por tipo
    // de cruce y por pareja de factores, nunca por el orden: proponerlo al revés es el mismo cruce.
    const { result } = await consult(context, {
      reply: 'Hay un cruce que ya existe y otro que sí falta.',
      insufficientData: false,
      missingInformation: [],
      findings: [
        cross({ title: 'Repite el FO registrado', evidenceIds: [f.strength.id, f.opportunity.id] }),
        cross({ title: 'Repite el mismo FO al revés', evidenceIds: [f.opportunity.id, f.strength.id] }),
        cross({ title: 'Repite el DO registrado', evidenceIds: [f.opportunity2.id, f.weakness.id] }),
        cross({ title: 'Cruce nuevo', evidenceIds: [f.strength.id, f.opportunity2.id] }),
      ],
    })
    expect(result.findings.map((entry) => entry.title)).toEqual(['Cruce nuevo'])
  })

  it('keeps only the first of two identical crosses proposed in the same answer', async () => {
    const { context } = await contextFor()
    const cross = (title: string) => finding({ category: 'MISSING_CROSSES', title, evidenceIds: [f.strength2.id, f.threat2.id], suggestedStrategy: null })
    const { result } = await consult(context, {
      reply: 'La misma pareja llega dos veces.',
      insufficientData: false,
      missingInformation: [],
      findings: [cross('Primera vez'), cross('Segunda vez')],
    })
    expect(result.findings.map((entry) => entry.title)).toEqual(['Primera vez'])
  })

  it('drops a suggested cross whose cited factors cannot form a FO, DO, FA or DA', async () => {
    const { context } = await contextFor()
    const { result } = await consult(context, {
      reply: 'Hay parejas que no son cruces.',
      insufficientData: false,
      missingInformation: [],
      findings: [
        // Dos factores externos: no hay ningún factor interno, así que no hay cruce que crear.
        finding({ category: 'MISSING_CROSSES', title: 'Amenaza y oportunidad', evidenceIds: [f.threat.id, f.opportunity2.id], suggestedStrategy: null }),
        // Un solo factor no forma pareja.
        finding({ category: 'MISSING_CROSSES', title: 'Un factor suelto', evidenceIds: [f.strength.id], suggestedStrategy: null }),
        // Un id de cruce no es un factor, así que la pareja no se puede resolver.
        finding({ category: 'MISSING_CROSSES', title: 'Factor y cruce', evidenceIds: [f.strength.id, c.prio], suggestedStrategy: null }),
        // Un hallazgo de otra categoría no compite con la matriz y se conserva intacto.
        finding({ category: 'REVIEW_ASPECTS', title: 'Ordenar el ataque', evidenceIds: [f.threat.id, f.opportunity2.id] }),
      ],
    })
    expect(result.findings.map((entry) => entry.title)).toEqual(['Ordenar el ataque'])
  })

  it('anchors a priority recommendation on the stored criteria instead of the number alone', async () => {
    const { context } = await contextFor()
    const { analysis } = await consult(context, {
      reply: 'Empieza por la estrategia con menor viabilidad, no por la más alta.',
      insufficientData: false,
      missingInformation: [],
      findings: [finding({ category: 'STRATEGIC_RISKS', evidenceIds: [c.prio, c.alsoHigh] })],
    })
    // El andamiaje entrega los cinco niveles de cada estrategia ponderada: el motivo se puede apoyar en ellos.
    expect(analysis.priorityRanking[0]).toMatchObject({ crossId: c.alsoHigh, weightedScore: 4.45, weightingBand: 'INMEDIATA' })
    expect(analysis.priorityRanking[0].criteria).toEqual({ ...impactLowViability })
    expect(analysis.priorityRanking.map((entry: { crossId: string }) => entry.crossId)).toEqual([c.alsoHigh, c.prio, c.weightedBare, c.medium])
  })

  it('keeps a FACT finding and an INFERENCE finding apart and stores both', async () => {
    const { context } = await contextFor()
    const { result } = await consult(context, {
      reply: 'Dos lecturas, una constatada y otra inferida.',
      insufficientData: false,
      missingInformation: [],
      findings: [
        finding({ category: 'STRENGTHEN_STRATEGIES', title: 'Constatado', basis: 'FACT', evidenceIds: [c.unweighted] }),
        finding({ category: 'STRATEGIC_RISKS', title: 'Inferido', basis: 'INFERENCE', evidenceIds: [c.alsoHigh, f.opportunity2.id] }),
      ],
    })
    expect(result.findings.map((entry) => entry.basis)).toEqual(['FACT', 'INFERENCE'])
    expect(result.findings[0].evidenceIds).toEqual([c.unweighted])
    expect(result.findings[1].evidenceIds).toEqual([c.alsoHigh, f.opportunity2.id])
  })

  it('rejects a recommendation that cites an evidence id that does not exist', async () => {
    const { context } = await contextFor()
    await expect(consult(context, { reply: 'r', insufficientData: false, missingInformation: [], findings: [finding({ evidenceIds: ['cmfactorinventado00000001'] })] })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    await expect(consult(context, { reply: 'r', insufficientData: false, missingInformation: [], findings: [finding({ evidenceIds: [f.threat2.id] })] })).resolves.toBeTruthy()
  })

  it('accepts insufficientData and still lets Checky report what it could evaluate', async () => {
    const { context } = await contextFor()
    const declared = await consult(context, { reply: 'Falta información de la otra empresa.', insufficientData: true, missingInformation: ['No hay nivel de viabilidad registrado para el cruce FA.'], findings: [] })
    expect(declared.result.insufficientData).toBe(true)
    expect(declared.result.missingInformation).toEqual(['No hay nivel de viabilidad registrado para el cruce FA.'])
    expect(declared.result.findings).toEqual([])

    const mixed = await consult(context, { reply: 'Parcial.', insufficientData: true, missingInformation: ['Falta validar con la empresa.'], findings: [finding({ evidenceIds: [c.unweighted] })] })
    expect(mixed.result.insufficientData).toBe(true)
    expect(mixed.result.findings).toHaveLength(1)

    // Declarar que no hay datos y a la vez no reportar nada sigue siendo una respuesta vacía.
    await expect(consult(context, { reply: 'Nada.', insufficientData: true, missingInformation: [], findings: [] })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('hands the pending weighting work to the model with the real ids of each strategy', async () => {
    const { context } = await contextFor()
    const { analysis, workMap } = await consult(context)
    expect(analysis.hasAnyWeighting).toBe(true)
    expect(analysis.unweightedStrategies).toEqual([
      { crossId: c.unweighted, crossType: 'DA', strategy: 'Blindar la operación ante el cambio normativo', factorIds: [f.weakness.id, f.threat.id] },
      { crossId: c.unweightedShort, crossType: 'DO', strategy: 'Urge', factorIds: [f.strength2.id, f.threat.id] },
    ])
    expect(analysis.priorityRanking.map((entry: { crossId: string }) => entry.crossId)).not.toContain(c.unweighted)
    expect(workMap.pendingStrategies).toBe(2)
    // Sin ponderación no hay orden: el modelo no puede inventar una jerarquía sobre estas dos.
    expect(analysis.priorityRanking.every((entry: { weightedScore: number | null }) => entry.weightedScore !== null)).toBe(true)
  })

  it('raises low feasibility with high impact as a risk with its own ids', async () => {
    const { context } = await contextFor()
    const { analysis, workMap } = await consult(context)
    expect(workMap.lowFeasibilityHighImpact.map((entry: { crossId: string }) => entry.crossId)).toEqual([c.prio, c.alsoHigh])
    const signals = analysis.strategyWeightingSignals as Array<{ kind: string; crossId: string; factorIds: string[] }>
    expect(signals.map((entry) => entry.kind)).toEqual(['IMPACT_HIGH_FEASIBILITY_LOW', 'IMPACT_HIGH_FEASIBILITY_LOW'])
    // Las señales salen en el orden de prioridad del ponderado: 4.45 antes que 4.4.
    expect(signals.map((entry) => entry.crossId)).toEqual([c.alsoHigh, c.prio])
    expect(signals[1].factorIds).toEqual([f.strength.id, f.opportunity.id])
    // La señal es una observación estructural, no un veredicto de calidad: el ponderado solo informa.
    expect(analysis.strategyWeightingSignals.every((entry: { weightedScore: number | null }) => entry.weightedScore !== null)).toBe(true)
  })

  it('separates the crosses with no strategy from the ones that were weighted without a strategy', async () => {
    const { context } = await contextFor()
    const { analysis, workMap } = await consult(context)
    expect(workMap.crossesWithoutStrategy).toEqual([c.bare, c.weightedBare])
    expect(analysis.crossesWithoutStrategy).toEqual([
      { crossId: c.bare, crossType: 'FA', hasWeighting: false, weightedScore: null, factorIds: [f.strength.id, f.threat.id] },
      { crossId: c.weightedBare, crossType: 'FO', hasWeighting: true, weightedScore: 3.8, factorIds: [f.strength2.id, f.opportunity2.id] },
    ])
    // Ponderado y sin texto es el hueco incoherente: hay una valoracion sin el que.
    expect(analysis.weightedCrossesWithoutStrategy).toEqual([{ crossId: c.weightedBare, crossType: 'FO', weightedScore: 3.8, weightingBand: 'CORTO_PLAZO', factorIds: [f.strength2.id, f.opportunity2.id] }])
  })

  it('surfaces the factors that take part in no cross at all, with their real ids', async () => {
    const { context } = await contextFor()
    const { analysis } = await consult(context)
    expect(analysis.unusedFactors).toEqual([{ id: f.threat2.id, type: 'THREAT' }])
  })

  it('keeps accepting a finding without evidence but gives the model an id to cite for every gap', async () => {
    const { context } = await contextFor()
    const { analysis } = await consult(context, { reply: 'r', insufficientData: false, missingInformation: [], findings: [finding({ evidenceIds: [], suggestedStrategy: null })] })
    expect(analysis.priorityRanking[0].crossId).toBe(c.alsoHigh)
    // Cada hueco que el modelo puede elevar a hallazgo lleva ids reales, así que el veto no depende de su memoria.
    const cited = [
      ...analysis.unweightedStrategies.flatMap((entry: { crossId: string; factorIds: string[] }) => [entry.crossId, ...entry.factorIds]),
      ...analysis.crossesWithoutStrategy.flatMap((entry: { crossId: string; factorIds: string[] }) => [entry.crossId, ...entry.factorIds]),
      ...analysis.strategyWeightingSignals.flatMap((entry: { crossId: string; factorIds: string[] }) => [entry.crossId, ...entry.factorIds]),
      ...analysis.unusedFactors.map((entry: { id: string }) => entry.id),
    ]
    const allowed = new Set([...allFactors.map((item) => item.id), ...crosses.map((item) => item.id)])
    expect(cited.length).toBeGreaterThan(0)
    expect(cited.every((id) => allowed.has(id))).toBe(true)
  })

  it('only ever suggests a strategy that derives from the cited factors', async () => {
    const { context } = await contextFor()
    // La pareja citada tiene que ser un cruce DOFA que no exista todavía, porque la compuerta de
    // duplicados descarta antes de persistir cualquier propuesta que no se pueda crear.
    const derived = await consult(context, { reply: 'r', insufficientData: false, missingInformation: [], findings: [finding({ category: 'MISSING_CROSSES', evidenceIds: [f.threat2.id, f.weakness.id], suggestedStrategy: { title: 'Blindar la norma con el mercado', description: 'Usar la capacidad de reacción para anticipar la nueva exigencia y convertirla en argumento de venta.' } })] })
    expect(derived.result.findings[0].suggestedStrategy?.title).toBe('Blindar la norma con el mercado')

    // El contrato sigue exigiendo un suggestedStrategy con contenido real.
    await expect(consult(context, { reply: 'r', insufficientData: false, missingInformation: [], findings: [finding({ suggestedStrategy: { title: 'ok', description: 'corta' } })] })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    // El contrato no impone un minimo arbitrario: "Mejorar procesos" es larga y valida. Lo que lo
    // descarta es la regla del prompt, y eso ya no es verificable desde un cliente simulado.
    await expect(consult(context, { reply: 'r', insufficientData: false, missingInformation: [], findings: [finding({ suggestedStrategy: { title: 'Mejorar procesos', description: 'Mejorar los procesos internos de la organizacion para alcanzar los objetivos del periodo.' } })] })).resolves.toBeTruthy()
  })

  it('keeps the recommendation loop inside the company of the diagnostic', async () => {
    const aiService = { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    const foreign = makeDb('COMPANY_ADMIN', member.id, null, admin.id, [], crosses)
    const agent = request.agent(createApp(foreign, aiService))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    expect((await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: 'Intrusión' })).status).toBe(404)
    expect(aiService.consultChecky).not.toHaveBeenCalled()
    expect(foreign.strategicCross.findMany).not.toHaveBeenCalled()
  })

  it('never creates a cross, a weighting, a strategy, a plan or a ticket on its own', async () => {
    const { db, context } = await contextFor()
    await consult(context, {
      reply: 'Cinco hallazgos y una estrategia sugerida.',
      insufficientData: false,
      missingInformation: [],
      findings: [
        finding({ category: 'MISSING_CROSSES', evidenceIds: [f.threat2.id, f.opportunity.id], suggestedStrategy: { title: 'Anticipar la norma con el mercado', description: 'Usar el equipo en expansión para llegar antes a la nueva exigencia y convertirla en argumento de venta.' } }),
        finding({ category: 'STRENGTHEN_STRATEGIES', evidenceIds: [c.unweighted] }),
        finding({ category: 'STRATEGIC_RISKS', evidenceIds: [c.alsoHigh] }),
        finding({ category: 'NEXT_STEPS', evidenceIds: [c.weightedBare] }),
      ],
    })
    // Se comprueban solo las escrituras que el mock expone: strategicCross solo tiene create/upsert
    // en el módulo real cuando el usuario acepta, así que la vía de escritura es create.
    const writeSpies = [
      ['strategicCross', 'create'], ['strategicCross', 'update'], ['strategicCross', 'delete'],
      ['strategicCrossWeighting', 'upsert'],
      ['sWOTItem', 'create'], ['sWOTItem', 'update'],
      ['recommendation', 'create'], ['actionPlan', 'create'], ['actionItem', 'create'], ['ticket', 'create'],
    ] as const
    for (const [store, method] of writeSpies) {
      expect((db as unknown as Record<string, Record<string, { mock?: unknown }>>)[store]?.[method], `${store}.${method}`).toHaveProperty('mock')
      expect((db as unknown as Record<string, Record<string, unknown>>)[store][method]).not.toHaveBeenCalled()
    }
  })

  it('responde 201 con el AIService real y la matriz DOFA completa, no solo con el servicio simulado', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], crosses)
    // La producción siempre llega con matriz DOFA poblada; el mock compartido la devuelve vacía, y
    // sin factores el evidenceIds de la respuesta no valida. Esta es la única prueba que atraviesa
    // la ruta con el AIService real, que es donde se construyen workMap y analysis.
    const items = allFactors.map((item) => ({ ...item, createdAt: new Date('2026-01-04') }))
    // La lectura guardada dice que se escribió con esta misma matriz, así que no hay nada que
    // regenerar y el AIService real solo responde a la consulta de Checky, que es lo que se prueba.
    ;(db.aIAnalysis.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }).mockResolvedValue({ ...persistedAIAnalysis, swotFingerprint: swotFingerprint(items) })
    const original = db.qualityDiagnostic.findUnique
    db.qualityDiagnostic.findUnique = vi.fn(async (args: unknown) => ({
      ...(await original(args as never)) as Record<string, unknown>,
      swotAnalysis: { id: 'cmswot000000000000000001', diagnosticId: diagnostic.id, items, createdAt: new Date('2026-01-04'), updatedAt: new Date('2026-01-04') },
    })) as unknown as typeof db.qualityDiagnostic.findUnique

    const create = vi.fn(async () => ({ output_text: JSON.stringify(defaultResult) }))
    const agent = request.agent(createApp(db, new AIService({ responses: { create } } as unknown as { responses: { create: (input: unknown) => Promise<{ output_text?: string }> } })))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const sent = await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Qué debería hacer primero?' })
    expect(sent.status).toBe(201)
    expect(sent.body.reply.insufficientData).toBe(false)
    expect(sent.body.suggestions).toHaveLength(defaultResult.findings.length)
    expect(sent.body.messages.length).toBeGreaterThan(0)
  })
})

/**
 * Fase 9: Checky lee la priorización consolidada. Antes de esta fase el contexto solo incluía las
 * ponderaciones de los cruces, así que las estrategias del análisis con IA y las sugerencias de
 * Checky aceptadas, aunque ya se pudieran ponderar en pantalla, nunca llegaban al modelo.
 */
describe('Checky consolidated strategy context', () => {
  // Se reutilizan los factores del escenario compartido porque el mock de DOFA solo almacena esos
  // cuatro: una sugerencia de Checky solo recupera los factores que la BD tiene, y un factor
  // inventado aquí dejaría sus estrategias sin evidencia citable sin que el fallo se notara.
  const f = { strength: checkySwotItemFixtures.strength, opportunity: checkySwotItemFixtures.opportunity, weakness: checkySwotItemFixtures.sameQuadrant }
  const allFactors = [f.strength, f.opportunity, f.weakness]

  // Tres perfiles de criterios con el ponderado que el servidor calcula al guardar: balanced da 3.25
  // (CORTO_PLAZO), ambitious 3.5 (CORTO_PLAZO) y distant 1.2 (LARGO_PLAZO). Los cruces, en cambio,
  // llegan con 4.6 y 2.4 escritos a mano en su fila: justo lo que demuestra que aquí no se recalcula.
  const ambitious = { impactoEstrategico: 'MUY_ALTO' as const, viabilidad: 'MUY_BAJO' as const, urgencia: 'MUY_ALTO' as const, sinergiaInterna: 'MEDIO' as const, impactoReputacional: 'ALTO' as const }
  const balanced = { impactoEstrategico: 'MEDIO' as const, viabilidad: 'ALTO' as const, urgencia: 'MEDIO' as const, sinergiaInterna: 'MEDIO' as const, impactoReputacional: 'MEDIO' as const }
  const distant = { impactoEstrategico: 'MUY_BAJO' as const, viabilidad: 'MUY_BAJO' as const, urgencia: 'BAJO' as const, sinergiaInterna: 'MUY_BAJO' as const, impactoReputacional: 'MUY_BAJO' as const }
  const BALANCED_SCORE = 3.25
  const AMBITIOUS_SCORE = 3.5
  const DISTANT_SCORE = 1.2

  const crosses: SeededCross[] = [
    { id: 'cmconsolcross0000000001', crossType: 'FO', origin: 'USER', factor1Id: f.strength.id, factor2Id: f.opportunity.id, strategy: 'Llevar el equipo comprometido al mercado en expansión antes de que se consolide', weighting: { ...ambitious, weightedScore: 4.6 } },
    { id: 'cmconsolcross0000000002', crossType: 'DO', origin: 'USER', factor1Id: f.weakness.id, factor2Id: f.opportunity.id, strategy: 'Acelerar los procesos para entrar en el mercado en expansión', weighting: { ...balanced, weightedScore: 2.4 } },
  ]

  const aiTexts = {
    thin: 'Urge',
    distant: 'Reputación por construir: ordenar el discurso institucional antes de presentarlo en el sector.',
    pending: 'Medir la satisfacción del equipo antes de comprometer nuevos procesos de apertura de cuentas.',
  }
  const checkyText = 'Formar al equipo comprometido en la apertura de cuentas del mercado en expansión.'

  /** Una sugerencia de Checky aceptada es la única forma de estrategia de Checky que existe. */
  const seedAcceptedCheckyStrategy = async (target: ReturnType<typeof makeDb>) => {
    await (target.checkyMessage.create as (input: unknown) => Promise<unknown>)({
      data: {
        sessionId: checkySessionFixture.id, role: 'CHECKY', content: 'Reforzar la apertura de cuentas', category: 'STRENGTHEN_STRATEGIES',
        basis: 'INFERENCE', evidenceIds: [f.strength.id, f.opportunity.id], insufficientData: false, missingInformation: [],
        status: 'ACCEPTED', suggestedStrategyTitle: 'Formar al equipo en la apertura de cuentas', suggestedStrategyDescription: checkyText, decisionNote: null,
      },
    })
  }

  /**
   * Escenario completo: dos cruces ponderados, tres estrategias de IA (una sin ponderar) y una
   * sugerencia de Checky aceptada. Las de IA y la de Checky se valoran llamando a la ruta real de
   * ponderación, de modo que los scores que Checky acaba leyendo son los que el servidor guardó.
   */
  const contextFor = async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], crosses)
    const seededItems = allFactors.map((item) => ({ ...item, swotId: diagnostic.swotAnalysis.id, createdAt: new Date('2026-01-04') }))
    ;(db.aIAnalysis.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }).mockResolvedValue({
      ...persistedAIAnalysis,
      foStrategies: [aiTexts.thin],
      doStrategies: [aiTexts.distant],
      faStrategies: [aiTexts.pending],
      daStrategies: [],
      // La huella corresponde a la matriz que se siembra abajo, así que la lectura guardada está
      // vigente y esta prueba mide la priorización, no la vigencia.
      swotFingerprint: swotFingerprint(seededItems),
    })
    const findDiag = db.qualityDiagnostic.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }
    findDiag.mockResolvedValue({
      ...diagnostic, company: { ...diagnostic.company },
      swotAnalysis: { ...diagnostic.swotAnalysis, items: seededItems },
    })
    await seedAcceptedCheckyStrategy(db)

    let captured: CheckyContext | null = null
    const aiService = { consultChecky: vi.fn(async (context: CheckyContext) => { captured = context; return checkyConsultResult }) } as unknown as AIService
    const agent = request.agent(createApp(db, aiService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    // Se valoran por la ruta real, con el mismo ancla que usa la pantalla de ponderación.
    const value = async (source: 'AI_ANALYSIS' | 'CHECKY', text: string, criteria: Record<string, string>) => {
      const response = await agent.put(`/api/diagnostics/${diagnostic.id}/strategies/weighting`).send({ source, sourceRef: strategySourceRef(text), ...criteria })
      expect(response.status).toBe(200)
    }
    await value('AI_ANALYSIS', aiTexts.thin, ambitious)
    await value('AI_ANALYSIS', aiTexts.distant, distant)
    await value('CHECKY', checkyText, balanced)

    await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Por dónde empiezo?' })
    return { db, agent, context: captured as unknown as CheckyContext }
  }

  /**
   * Respuesta del modelo para leer el prompt. Cita un factor de este escenario, no los del bloque
   * compartido, porque el contrato rechaza cualquier evidenceId que no exista en los swotItems.
   */
  const mockedResult = {
    reply: 'Hay priorización que revisar.',
    insufficientData: false,
    missingInformation: [],
    findings: [{ category: 'REVIEW_ASPECTS', title: 'Ordenar el ataque', detail: 'Ponderado alto con viabilidad baja.', basis: 'INFERENCE' as const, evidenceIds: [f.opportunity.id], suggestedStrategy: null }],
  }

  /** Corre el servicio real y devuelve la priorización consolidada tal cual viaja en el prompt. */
  const prioritizationFrom = async (context: CheckyContext) => {
    const create = vi.fn(async () => ({ output_text: JSON.stringify(mockedResult) }))
    await new AIService({ responses: { create } } as unknown as { responses: { create: (input: unknown) => Promise<{ output_text?: string }> } }).consultChecky(context)
    const input = (create.mock.calls[0] as unknown as [{ input: string }])[0].input
    return JSON.parse(input.slice(input.indexOf('{'))).analysis.strategyPrioritization as {
      hasAnyWeighting: boolean
      totalStrategies: number
      valuedStrategies: number
      unvaluedStrategies: number
      bySource: Array<{ source: string; total: number; valued: number; unvalued: number }>
      bandCounts: Record<string, number>
      weightedStrategies: Array<{ strategyRef: string; source: string; description: string; weightedScore: number | null; weightingBand: string | null; criteria: Record<string, string> | null; factorIds: string[]; crossId: string | null }>
      pendingStrategies: Array<{ strategyRef: string; source: string; title: string; crossId: string | null; crossType: string | null; factorIds: string[] }>
      needsAttention: Array<{ strategyRef: string; weightedScore: number; weightingBand: string }>
      highPriorityLowFeasibility: Array<{ strategyRef: string; viabilidad: string; impactoEstrategico: string }>
      strengthenSignals: Array<{ kind: string; strategyRef: string; detail: string }>
      possibleDuplicates: Array<{ kind: string; strategyRefs: string[]; factorIds: string[] }>
      missingInformationInputs: { unvaluedStrategies: Array<{ strategyRef: string }>; valuedWithoutCitableEvidence: Array<{ strategyRef: string }>; hasAnyWeighting: boolean }
    }
  }

  /** Traduce una strategyRef al texto de la estrategia, para que las aserciones no dependan del id de fila. */
  const textOf = (context: CheckyContext, ref: string) => context.strategies?.find((strategy) => strategy.strategyRef === ref)?.description
  const textsOf = (context: CheckyContext, refs: string[]) => refs.map((ref) => textOf(context, ref)).sort()

  it('sends Checky the strategies of the three sources with the score and band already stored', async () => {
    const { context } = await contextFor()
    const sources = context.strategies?.map((strategy) => strategy.source) ?? []
    expect(sources).toContain('AI_ANALYSIS')
    expect(sources).toContain('STRATEGIC_CROSS')
    expect(sources).toContain('CHECKY')

    // La estrategia de IA valorada llega con los cinco niveles, el ponderado guardado y su banda.
    const valuedAi = context.strategies?.find((strategy) => strategy.description === aiTexts.thin)
    expect(valuedAi).toMatchObject({ source: 'AI_ANALYSIS', crossId: null, factorIds: [] })
    expect(valuedAi?.weightedScore).toBe(AMBITIOUS_SCORE)
    expect(valuedAi?.weightingBand).toBe('CORTO_PLAZO')
    expect(valuedAi?.criteria).toEqual(ambitious)

    // La de Checky conserva su texto y el cruce conserva el suyo: son estrategias distintas.
    const valuedChecky = context.strategies?.find((strategy) => strategy.description === checkyText)
    expect(valuedChecky).toMatchObject({ source: 'CHECKY', factorIds: [f.strength.id, f.opportunity.id] })
    expect(valuedChecky?.weightedScore).toBe(BALANCED_SCORE)
    expect(valuedChecky?.weightingBand).toBe('CORTO_PLAZO')
    const cross = context.strategies?.find((strategy) => strategy.source === 'STRATEGIC_CROSS' && strategy.description.startsWith('Llevar el equipo'))
    expect(cross).toMatchObject({ crossId: 'cmconsolcross0000000001', weightedScore: 4.6, weightingBand: 'INMEDIATA', factorIds: [f.strength.id, f.opportunity.id] })
  })

  it('classifies the band from the stored score without ever recomputing it', async () => {
    const { context } = await contextFor()
    const prioritization = await prioritizationFrom(context)
    // 4.6 cae en INMEDIATA, 3.5 y 3.25 en CORTO_PLAZO, 2.4 en MEDIANO_PLAZO y 1.2 en LARGO_PLAZO, con
    // los mismos rangos inclusivos por arriba que ve la pantalla de ponderación.
    expect(prioritization.bandCounts).toEqual({ INMEDIATA: 1, CORTO_PLAZO: 2, MEDIANO_PLAZO: 1, LARGO_PLAZO: 1 })
    expect(prioritization.weightedStrategies.map((entry) => [entry.weightedScore, entry.weightingBand])).toEqual([
      [4.6, 'INMEDIATA'], [AMBITIOUS_SCORE, 'CORTO_PLAZO'], [BALANCED_SCORE, 'CORTO_PLAZO'], [2.4, 'MEDIANO_PLAZO'], [DISTANT_SCORE, 'LARGO_PLAZO'],
    ])
    // El cruce se lee con el 4.6 que tenía guardado, aunque sus cinco niveles no darían ese número
    // por la vía nueva: el ponderado es un hecho guardado, no un cálculo que se repita aquí.
    const crossEntry = prioritization.weightedStrategies.find((entry) => entry.crossId === 'cmconsolcross0000000001')
    expect(crossEntry?.weightedScore).toBe(4.6)
    expect(crossEntry?.criteria).toEqual(ambitious)
  })

  it('counts the pending and the unvalued strategies per source and never gives them a score', async () => {
    const { context } = await contextFor()
    const prioritization = await prioritizationFrom(context)
    expect(prioritization.hasAnyWeighting).toBe(true)
    expect(prioritization.totalStrategies).toBe(6)
    expect(prioritization.valuedStrategies).toBe(5)
    expect(prioritization.unvaluedStrategies).toBe(1)

    const bySource = Object.fromEntries(prioritization.bySource.map((entry) => [entry.source, entry]))
    expect(bySource.STRATEGIC_CROSS).toEqual({ source: 'STRATEGIC_CROSS', total: 2, valued: 2, unvalued: 0 })
    expect(bySource.AI_ANALYSIS).toEqual({ source: 'AI_ANALYSIS', total: 3, valued: 2, unvalued: 1 })
    expect(bySource.CHECKY).toEqual({ source: 'CHECKY', total: 1, valued: 1, unvalued: 0 })

    // Lo pendiente se entrega sin ponderado y sin banda: no hay nada que leer y nada que suponer.
    expect(prioritization.pendingStrategies).toHaveLength(1)
    expect(textOf(context, prioritization.pendingStrategies[0].strategyRef)).toBe(aiTexts.pending)
    expect(prioritization.pendingStrategies[0]).toMatchObject({ source: 'AI_ANALYSIS', crossId: null, factorIds: [] })
    expect(prioritization.weightedStrategies.some((entry) => entry.description === aiTexts.pending)).toBe(false)
  })

  it('hands over what needs attention and what is high priority with low feasibility', async () => {
    const { context } = await contextFor()
    const prioritization = await prioritizationFrom(context)
    // Requiere atención = banda alta (INMEDIATA o CORTO_PLAZO), en cualquiera de las tres fuentes.
    // Quedan fuera el cruce con 2.4 y la estrategia de IA con 1.2: no es que valgan poco, es que el
    // usuario los dejó en una banda larga.
    expect(textsOf(context, prioritization.needsAttention.map((entry) => entry.strategyRef))).toEqual([aiTexts.thin, checkyText, 'Llevar el equipo comprometido al mercado en expansión antes de que se consolide'].sort())
    expect(prioritization.needsAttention.map((entry) => entry.weightingBand).sort()).toEqual(['CORTO_PLAZO', 'CORTO_PLAZO', 'INMEDIATA'])

    // Alta prioridad con poca viabilidad: el cruce y la estrategia de IA corta. La de Checky está en
    // banda alta pero con viabilidad ALTO, así que no entra: no es lo mismo prioritized que difícil.
    expect(textsOf(context, prioritization.highPriorityLowFeasibility.map((entry) => entry.strategyRef))).toEqual([aiTexts.thin, 'Llevar el equipo comprometido al mercado en expansión antes de que se consolide'].sort())
    expect(prioritization.highPriorityLowFeasibility.map((entry) => [entry.viabilidad, entry.impactoEstrategico])).toEqual([['MUY_BAJO', 'MUY_ALTO'], ['MUY_BAJO', 'MUY_ALTO']])
  })

  it('signals the strategies to strengthen without turning the signal into a verdict', async () => {
    const { context } = await contextFor()
    const prioritization = await prioritizationFrom(context)
    const kinds = prioritization.strengthenSignals.map((entry) => entry.kind)
    expect(kinds).toContain('THIN_TEXT_IN_HIGH_BAND')
    expect(kinds).toContain('HIGH_IMPACT_LOW_FEASIBILITY')
    expect(kinds).toContain('LOW_FEASIBILITY')
    // El texto corto es el único que recibe la señal de redacción, y la recibe por su banda, no por
    // su ponderado. La de Checky, en la misma banda y con mejor viabilidad, no aparece.
    expect(textsOf(context, prioritization.strengthenSignals.filter((entry) => entry.kind === 'THIN_TEXT_IN_HIGH_BAND').map((entry) => entry.strategyRef))).toEqual([aiTexts.thin])
    expect(prioritization.strengthenSignals.every((entry) => entry.detail.length > 0)).toBe(true)
  })

  it('reports the possible redundancy between a cross and a Checky strategy on the same factors', async () => {
    const { context } = await contextFor()
    const prioritization = await prioritizationFrom(context)
    expect(prioritization.possibleDuplicates).toHaveLength(1)
    expect(prioritization.possibleDuplicates[0]).toMatchObject({ kind: 'SHARED_FACTORS', factorIds: [f.strength.id, f.opportunity.id] })
    expect(textsOf(context, prioritization.possibleDuplicates[0].strategyRefs)).toEqual([checkyText, 'Llevar el equipo comprometido al mercado en expansión antes de que se consolide'].sort())
  })

  it('lists what is missing to decide, including the strategies that cannot cite any evidence', async () => {
    const { context } = await contextFor()
    const prioritization = await prioritizationFrom(context)
    expect(textsOf(context, prioritization.missingInformationInputs.unvaluedStrategies.map((entry) => entry.strategyRef))).toEqual([aiTexts.pending])
    // Las estrategias de IA valoradas no tienen factores: Checky puede leer sus números pero no
    // tiene ningún id que citar, y el andamiaje se lo dice en vez de dejarlo adivinar.
    expect(textsOf(context, prioritization.missingInformationInputs.valuedWithoutCitableEvidence.map((entry) => entry.strategyRef))).toEqual([aiTexts.thin, aiTexts.distant].sort())
    expect(prioritization.missingInformationInputs.hasAnyWeighting).toBe(true)
  })

  it('refuses a finding that cites a strategyRef instead of a real factor or cross id', async () => {
    const { context } = await contextFor()
    const output = {
      reply: 'La estrategia del análisis con IA es la que más pesa.',
      insufficientData: false,
      missingInformation: [],
      findings: [{ category: 'REVIEW_ASPECTS', title: 'Prioridad', detail: 'Con ponderado de 3.4.', basis: 'FACT', evidenceIds: [`ai:${persistedAIAnalysis.id}:FO:0`], suggestedStrategy: null }],
    }
    const respondWith = (payload: unknown) => new AIService({ responses: { create: vi.fn(async () => ({ output_text: JSON.stringify(payload) })) } } as unknown as { responses: { create: (input: unknown) => Promise<{ output_text?: string }> } })
    // strategyRef es una etiqueta de referencia: copiarla en evidenceIds invalida la respuesta.
    await expect(respondWith(output).consultChecky(context)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    // Con un id real de la matriz la misma respuesta sí valida.
    await expect(respondWith({ ...output, findings: [{ ...output.findings[0], evidenceIds: [f.opportunity.id] }] }).consultChecky(context)).resolves.toMatchObject({ insufficientData: false })
  })

  it('says the diagnostic is not prioritised when nothing has been weighted, instead of inventing an order', async () => {
    // Mismos cruces pero sin fila de ponderación: el diagnóstico existe y tiene estrategias, pero
    // nadie ha elegido niveles todavía. Es el caso en el que no puede inventarse ninguna jerarquía.
    const unweightedCrosses: SeededCross[] = crosses.map((cross) => ({ ...cross, weighting: null }))
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], unweightedCrosses)
    const findDiag = db.qualityDiagnostic.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }
    const unweightedItems = allFactors.map((item) => ({ ...item, swotId: diagnostic.swotAnalysis.id, createdAt: new Date('2026-01-04') }))
    findDiag.mockResolvedValue({
      ...diagnostic, company: { ...diagnostic.company },
      swotAnalysis: { ...diagnostic.swotAnalysis, items: unweightedItems },
    })
    ;(db.aIAnalysis.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }).mockResolvedValue({ ...persistedAIAnalysis, swotFingerprint: swotFingerprint(unweightedItems) })
    let captured: CheckyContext | null = null
    const agent = request.agent(createApp(db, { consultChecky: vi.fn(async (context: CheckyContext) => { captured = context; return checkyConsultResult }) } as unknown as AIService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Por dónde empiezo?' })
    const prioritization = await prioritizationFrom(captured as unknown as CheckyContext)
    expect(prioritization.hasAnyWeighting).toBe(false)
    expect(prioritization.valuedStrategies).toBe(0)
    expect(prioritization.weightedStrategies).toEqual([])
    expect(prioritization.needsAttention).toEqual([])
    expect(prioritization.highPriorityLowFeasibility).toEqual([])
    expect(prioritization.pendingStrategies).toHaveLength(6)
  })

  it('keeps the consolidated read inside the company of the diagnostic and never writes', async () => {
    const foreign = makeDb('COMPANY_ADMIN', member.id, null, admin.id, [], crosses)
    const aiService = { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    const agent = request.agent(createApp(foreign, aiService))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    expect((await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: 'Intrusión' })).status).toBe(404)
    expect(aiService.consultChecky).not.toHaveBeenCalled()
    // Ni la sesión ni las estrategias de la otra empresa llegan a leerse.
    expect(foreign.strategyWeighting.findMany).not.toHaveBeenCalled()

    const { db, agent: own } = await contextFor()
    const writeSpies = [
      ['strategyWeighting', 'upsert'], ['strategicCrossWeighting', 'upsert'], ['strategicCross', 'create'],
      ['sWOTItem', 'create'], ['recommendation', 'create'], ['actionPlan', 'create'], ['actionItem', 'create'], ['ticket', 'create'],
    ] as const
    for (const [store, method] of writeSpies) {
      expect((db as unknown as Record<string, Record<string, { mock?: unknown }>>)[store]?.[method], `${store}.${method}`).toHaveProperty('mock')
    }
    // Las tres ponderaciones del escenario se guardaron antes de consultar; desde la consulta en
    // adelante nada escribe, así que se cuentan las llamadas del último tramo.
    const before = (db.strategyWeighting.upsert as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    await own.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: '¿Y ahora?' })
    expect((db.strategyWeighting.upsert as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(before)
  })
})

describe('GET /api/diagnostics/:id/strategies', () => {
  const priorityWeighting = { impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'MUY_ALTO', sinergiaInterna: 'BAJO', impactoReputacional: 'MEDIO', weightedScore: 4.4 } as const

  /** La priorización es de lectura pura: si el endpoint llamara a OpenAI, estos tests fallan. */
  const readOnlyAI = () => new AIService({ responses: { create: async () => { throw new Error('Priorizar no debe llamar a OpenAI') } } } as unknown as { responses: { create: (input: unknown) => Promise<{ output_text?: string }> } })

  const weightedCross: SeededCross = { id: 'cmprioridad00000000000001', crossType: 'FO', origin: 'USER', factor1Id: checkyFactorIds.strength, factor2Id: checkyFactorIds.opportunity, strategy: 'Llevar el equipo comprometido al mercado antes de que se consolide.', weighting: priorityWeighting }
  const unweightedCross: SeededCross = { id: 'cmprioridad00000000000002', crossType: 'DA', origin: 'AI', factor1Id: 'cmdebilidad000000000000000001', factor2Id: checkyFactorIds.opportunity, strategy: 'Cubrir los procesos lentos antes de la auditoría.', weighting: null }
  const checkyDescription = 'Asignar al equipo comprometido la apertura de cuentas nuevas.'

  /** Siembra una sugerencia de Checky aceptada, que es la única forma de Checky que entra aquí. */
  const seedAcceptedCheckyStrategy = async (target: ReturnType<typeof makeDb>, overrides: Record<string, unknown> = {}) => {
    await (target.checkyMessage.create as (input: unknown) => Promise<unknown>)({
      data: {
        sessionId: checkySessionFixture.id,
        role: 'CHECKY',
        status: 'ACCEPTED',
        category: 'STRENGTHEN_STRATEGIES',
        content: 'Propongo reforzar la estrategia.',
        suggestedStrategyTitle: 'Reforzar la estrategia FO',
        suggestedStrategyDescription: checkyDescription,
        evidenceIds: [checkyFactorIds.strength, checkyFactorIds.opportunity],
        ...overrides,
      },
    })
  }

  it('reúne las tres fuentes en una sola lista', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [weightedCross, unweightedCross])
    await seedAcceptedCheckyStrategy(db)
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    expect(res.status).toBe(200)
    const sources = [...new Set(res.body.strategies.map((strategy: { source: string }) => strategy.source))]
    expect(sources).toEqual(expect.arrayContaining(['STRATEGIC_CROSS', 'AI_ANALYSIS', 'CHECKY']))
    // Las 4 estrategias del análisis DOFA siguen completas, y los cruces y Checky se suman.
    expect(res.body.strategies.filter((strategy: { source: string }) => strategy.source === 'AI_ANALYSIS')).toHaveLength(aiResult.foStrategies.length + aiResult.doStrategies.length + aiResult.faStrategies.length + aiResult.daStrategies.length)
    expect(res.body.strategies.filter((strategy: { source: string }) => strategy.source === 'STRATEGIC_CROSS')).toHaveLength(2)
    expect(res.body.strategies.filter((strategy: { source: string }) => strategy.source === 'CHECKY')).toHaveLength(1)
  })

  it('devuelve el cruce con su score almacenado, su banda y los factores que lo respaldan', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [weightedCross])
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    expect(res.status).toBe(200)
    const strategy = res.body.strategies.find((item: { id: string }) => item.id === `cross:${weightedCross.id}`)
    expect(strategy).toMatchObject({
      id: `cross:${weightedCross.id}`,
      description: weightedCross.strategy,
      source: 'STRATEGIC_CROSS',
      crossId: weightedCross.id,
      crossType: 'FO',
      origin: 'USER',
      weightedScore: priorityWeighting.weightedScore,
      weightingBand: 'INMEDIATA',
    })
    expect(strategy.factor1).toMatchObject({ id: checkyFactorIds.strength, type: 'STRENGTH' })
    expect(strategy.factor2).toMatchObject({ id: checkyFactorIds.opportunity, type: 'OPPORTUNITY' })
    expect(strategy.weighting).toMatchObject({ impactoEstrategico: 'ALTO', urgencia: 'MUY_ALTO', weightedScore: priorityWeighting.weightedScore })
  })

  it('devuelve el cruce sin ponderación con score y banda nulos, sin inventar una nota', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [unweightedCross])
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    const strategy = res.body.strategies.find((item: { id: string }) => item.id === `cross:${unweightedCross.id}`)
    expect(strategy.weighting).toBeNull()
    expect(strategy.weightedScore).toBeNull()
    expect(strategy.weightingBand).toBeNull()
  })

  it('expone los pesos de nivel una sola vez para que el cliente no los repita en cada estrategia', async () => {
    const agent = request.agent(createApp(makeDb(), readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    expect(res.status).toBe(200)
    expect(res.body.weightingLevels).toEqual(WEIGHTING_LEVEL_SCORE)
  })

  it('trae los factores que evidencia la sugerencia de Checky, sin convertirlos en un cruce', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [])
    await seedAcceptedCheckyStrategy(db)
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    const strategy = res.body.strategies.find((item: { source: string }) => item.source === 'CHECKY')
    expect(strategy).toMatchObject({ title: 'Reforzar la estrategia FO', description: checkyDescription, crossId: null, origin: null, crossType: null, weighting: null, weightedScore: null, weightingBand: null })
    expect(strategy.factor1).toMatchObject({ id: checkyFactorIds.strength, type: 'STRENGTH' })
    expect(strategy.factor2).toMatchObject({ id: checkyFactorIds.opportunity, type: 'OPPORTUNITY' })
  })

  it('no trae sugerencias de Checky que el usuario todavía no aceptó', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [])
    await seedAcceptedCheckyStrategy(db, { status: 'PENDING', suggestedStrategyDescription: 'Estrategia que aún no está aceptada.' })
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    expect(res.status).toBe(200)
    expect(res.body.strategies.filter((strategy: { source: string }) => strategy.source === 'CHECKY')).toEqual([])
  })

  it('devuelve exactamente las estrategias aceptadas cuando Ponderación solicita acceptedOnly', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [])
    const acceptedDescriptions = ['Estrategia aceptada 1.', 'Estrategia aceptada 2.', 'Estrategia aceptada 3.']
    const pendingDescriptions = ['Estrategia pendiente 1.', 'Estrategia pendiente 2.', 'Estrategia pendiente 3.', 'Estrategia pendiente 4.']
    for (const [index, description] of [...acceptedDescriptions, ...pendingDescriptions].entries()) {
      await seedAcceptedCheckyStrategy(db, { status: index < acceptedDescriptions.length ? 'ACCEPTED' : 'PENDING', suggestedStrategyDescription: description })
    }
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)

    expect(res.status).toBe(200)
    expect(res.body.strategies).toHaveLength(acceptedDescriptions.length)
    expect(res.body.strategies.map((strategy: { description: string }) => strategy.description)).toEqual(acceptedDescriptions)
  })

  it('conserva como CHECKY una aceptación MISSING_CROSSES aunque ya exista el cruce relacionado', async () => {
    const relatedCross: SeededCross = { id: 'cmprioridadchecky000001', crossType: 'FO', origin: 'AI', factor1Id: checkyFactorIds.strength, factor2Id: checkyFactorIds.opportunity, strategy: checkyDescription, weighting: null }
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [relatedCross])
    await seedAcceptedCheckyStrategy(db, { category: 'MISSING_CROSSES' })
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)

    expect(res.status).toBe(200)
    expect(res.body.strategies).toHaveLength(1)
    expect(res.body.strategies[0]).toMatchObject({ source: 'CHECKY', description: checkyDescription, crossId: null, weighting: null })
  })

  it('no incluye una aceptación MISSING_CROSSES que sigue pendiente en Ponderación', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [])
    await seedAcceptedCheckyStrategy(db, { category: 'MISSING_CROSSES', status: 'PENDING' })
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)

    expect(res.status).toBe(200)
    expect(res.body.strategies).toEqual([])
  })

  it('evita duplicar una estrategia que ya existe como cruce aceptado', async () => {
    const duplicateText = 'Cubrir los procesos lentos antes de la auditoría.'
    const relatedCross: SeededCross = { id: 'cmprioridadchecky000002', crossType: 'FO', origin: 'AI', factor1Id: checkyFactorIds.strength, factor2Id: checkyFactorIds.opportunity, strategy: duplicateText, weighting: null }
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [relatedCross])
    await seedAcceptedCheckyStrategy(db, { category: 'MISSING_CROSSES', suggestedStrategyTitle: 'Cubrir los procesos', suggestedStrategyDescription: duplicateText })
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    const matching = res.body.strategies.filter((strategy: { description: string }) => strategy.description === duplicateText)
    expect(matching).toHaveLength(1)
    expect(matching[0].source).toBe('STRATEGIC_CROSS')
  })

  it('conserva la estrategia de Checky que no está repetida y descarta solo la duplicada', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [unweightedCross])
    await seedAcceptedCheckyStrategy(db)
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    expect(res.body.strategies.filter((strategy: { source: string }) => strategy.source === 'CHECKY')).toHaveLength(1)
    expect(res.body.strategies.filter((strategy: { description: string }) => strategy.description === checkyDescription)).toHaveLength(1)
  })

  it('no filtra por empresa lo que ya se guardó: el cruce, la IA y Checky llegan juntos', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [weightedCross])
    await seedAcceptedCheckyStrategy(db)
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    expect(res.status).toBe(200)
    expect(res.body.strategies.some((strategy: { id: string }) => strategy.id === `cross:${weightedCross.id}`)).toBe(true)
    expect(res.body.strategies.some((strategy: { description: string }) => strategy.description === checkyDescription)).toBe(true)
  })

  it('no deja que un usuario de otra empresa vea las estrategias del diagnóstico', async () => {
    const db = makeDb('COMPANY_USER', member.id, null, otherCompanyId, [], [weightedCross])
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    expect(res.status).toBe(404)
    expect(res.body).not.toHaveProperty('strategies')
  })

  it('requiere sesión y no responde sin token', async () => {
    const res = await request(createApp(makeDb(), readOnlyAI())).get(`/api/diagnostics/${diagnostic.id}/strategies`)

    expect(res.status).toBe(401)
  })

  it('mantiene la regla de lectura actual: COMPANY_USER de la misma empresa sí prioriza', async () => {
    const db = makeDb('COMPANY_USER', member.id, null, companyId, [], [weightedCross])
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    expect(res.status).toBe(200)
    expect(res.body.strategies.some((strategy: { id: string }) => strategy.id === `cross:${weightedCross.id}`)).toBe(true)
  })

  it('es de solo lectura: no invoca ninguna escritura de la base de datos', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [weightedCross, unweightedCross])
    await seedAcceptedCheckyStrategy(db)
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    /** makeDb devuelve el cliente de Prisma tipado, pero cada delegate es un spy en los tests. */
    const asSpy = (delegate: unknown) => delegate as { mockClear: () => void }
    const writes: [string, { mockClear: () => void }][] = [
      ['sWOTItem.create', asSpy(db.sWOTItem.create)],
      ['sWOTItem.update', asSpy(db.sWOTItem.update)],
      ['sWOTItem.delete', asSpy(db.sWOTItem.delete)],
      ['checkyMessage.create', asSpy(db.checkyMessage.create)],
      ['checkyMessage.update', asSpy(db.checkyMessage.update)],
      ['strategicCross.create', asSpy(db.strategicCross.create)],
      ['strategicCross.update', asSpy(db.strategicCross.update)],
      ['strategicCross.delete', asSpy(db.strategicCross.delete)],
      ['strategicCrossWeighting.upsert', asSpy(db.strategicCrossWeighting.upsert)],
      ['aIAnalysis.upsert', asSpy(db.aIAnalysis.upsert)],
    ]
    // La siembra usa checkyMessage.create, así que se limpia el historial para medir solo la lectura.
    for (const [, spy] of writes) spy.mockClear()

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    expect(res.status).toBe(200)
    expect(res.body.strategies.length).toBeGreaterThan(0)
    for (const [name, spy] of writes) expect(spy, `${name} no debe llamarse al priorizar`).not.toHaveBeenCalled()
  })

  it('crea tareas y tickets para una estrategia ponderada y evita duplicarlos', async () => {
    const db = makeDb('COMPANY_ADMIN', member.id, null, company.id, [], [])
    const strategyDescription = 'Estandarizar la apertura de cuentas con responsables y controles definidos.'
    await seedAcceptedCheckyStrategy(db, { suggestedStrategyTitle: 'Estandarizar la apertura de cuentas', suggestedStrategyDescription: strategyDescription })
    const storedPlans: Array<Record<string, unknown>> = []
    const planDelegate = db.actionPlan as unknown as { findMany: { mockImplementation: (implementation: (input?: any) => Promise<unknown[]>) => unknown }; findUnique: { mockImplementation: (implementation: (input: any) => Promise<unknown>) => unknown }; create: { mockImplementation: (implementation: (input: any) => Promise<unknown>) => unknown } }
    planDelegate.findMany.mockImplementation(async ({ where } = {}) => where?.strategySource ? storedPlans : storedPlans)
    planDelegate.findUnique.mockImplementation(async ({ where }) => {
      if (where.id) return storedPlans.find((plan) => plan.id === where.id) ?? null
      return storedPlans.find((plan) => plan.diagnosticId === where.diagnosticId_strategySource_strategySourceRef?.diagnosticId && plan.strategySource === where.diagnosticId_strategySource_strategySourceRef?.strategySource && plan.strategySourceRef === where.diagnosticId_strategySource_strategySourceRef?.strategySourceRef) ?? null
    })
    planDelegate.create.mockImplementation(async ({ data }) => {
      const created = { ...actionPlan, ...data, createdBy: member, items: [] }
      storedPlans.push(created)
      return created
    })
    const itemDelegate = db.actionItem as unknown as { create: { mockImplementation: (implementation: (input: { data: Record<string, unknown> }) => Promise<unknown>) => unknown } }
    itemDelegate.create.mockImplementation(async ({ data }) => {
      const created = { ...actionItem, ...data, id: `cmactionitemstrategy${storedPlans[0]?.items instanceof Array ? storedPlans[0].items.length + 1 : 1}`, responsible: member, ticket: null }
      ;(storedPlans[0]?.items as Array<unknown> | undefined)?.push(created)
      return created
    })
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })
    await agent.put(`/api/diagnostics/${diagnostic.id}/strategies/weighting`).send({ source: 'CHECKY', sourceRef: strategySourceRef(strategyDescription), impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'ALTO', sinergiaInterna: 'MEDIO', impactoReputacional: 'MEDIO' })
    const strategies = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    const strategyId = strategies.body.strategies[0].id
    const tasks = [1, 2, 3].map((number) => ({ title: `Control de cumplimiento ${number}`, responsibleId: member.id, dueDate: `2026-04-0${number}` }))

    const created = await agent.post(`/api/diagnostics/${diagnostic.id}/strategy-tasks`).send({ strategyId, tasks })
    expect(created.status).toBe(201)
    expect(created.body.createdCount).toBe(3)
    expect(created.body.actionPlan.strategyTitle).toBe('Estandarizar la apertura de cuentas')
    expect((db.ticket.create as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(3)
    expect((db.ticket.create as unknown as { mock: { calls: Array<[{ data: { status: string } }]> } }).mock.calls.every(([call]) => call.data.status === 'OPEN')).toBe(true)

    const duplicate = await agent.post(`/api/diagnostics/${diagnostic.id}/strategy-tasks`).send({ strategyId, tasks: [tasks[0]] })
    expect(duplicate.status).toBe(200)
    expect(duplicate.body.createdCount).toBe(0)
    expect(duplicate.body.skippedTasks).toEqual([tasks[0].title])
    expect((db.ticket.create as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(3)

    const missingResponsible = await agent.post(`/api/diagnostics/${diagnostic.id}/strategy-tasks`).send({ strategyId, tasks: [{ title: 'Sin responsable', responsibleId: '', dueDate: '2026-05-01' }] })
    expect(missingResponsible.status).toBe(400)
    const missingDueDate = await agent.post(`/api/diagnostics/${diagnostic.id}/strategy-tasks`).send({ strategyId, tasks: [{ title: 'Sin fecha', responsibleId: member.id, dueDate: '' }] })
    expect(missingDueDate.status).toBe(400)
    const foreignAssignee = await agent.post(`/api/diagnostics/${diagnostic.id}/strategy-tasks`).send({ strategyId, tasks: [{ title: 'Responsable externo', responsibleId: otherCompanyUser.id, dueDate: '2026-05-01' }] })
    expect(foreignAssignee.status).toBe(403)
  })

  it('incluye en Ponderación la estrategia de un cruce que se aceptó en Checky', async () => {
    const acceptedCross: SeededCross = { ...weightedCross, id: 'cmprioridadaceptada00001', strategyStatus: 'ACCEPTED' }
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [acceptedCross])
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)

    expect(res.status).toBe(200)
    expect(res.body.strategies).toHaveLength(1)
    expect(res.body.strategies[0]).toMatchObject({
      id: `cross:${acceptedCross.id}`,
      source: 'STRATEGIC_CROSS',
      crossId: acceptedCross.id,
      description: acceptedCross.strategy,
      origin: 'USER',
      weightedScore: priorityWeighting.weightedScore,
    })
    // Ponderación sigue sin recibir el análisis con IA: allí solo entra lo que se aceptó.
    expect(res.body.strategies.some((strategy: { source: string }) => strategy.source === 'AI_ANALYSIS')).toBe(false)
  })

  it('deja fuera de Ponderación la estrategia de un cruce que nadie aceptó', async () => {
    const pendingCross: SeededCross = { ...weightedCross, id: 'cmprioridadpendiente00001', strategyStatus: 'PENDING' }
    const rejectedCross: SeededCross = { ...weightedCross, id: 'cmprioridadrechazada00001', strategyStatus: 'REJECTED' }
    const undecidedCross: SeededCross = { ...unweightedCross, id: 'cmprioridadsindecision0001' }
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [pendingCross, rejectedCross, undecidedCross])
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)

    expect(res.status).toBe(200)
    expect(res.body.strategies).toEqual([])
  })

  it('no suma dos veces una estrategia que entra como cruce aceptado y como sugerencia aceptada', async () => {
    const duplicated: SeededCross = { ...weightedCross, id: 'cmprioridadduplicada0001', strategy: checkyDescription, strategyStatus: 'ACCEPTED' }
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [duplicated])
    await seedAcceptedCheckyStrategy(db)
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)

    expect(res.status).toBe(200)
    expect(res.body.strategies).toHaveLength(1)
    // Gana la sugerencia, que es la que la persona vio aceptar en Checky.
    expect(res.body.strategies[0]).toMatchObject({ source: 'CHECKY', description: checkyDescription, crossId: null })
  })

  const loginAgent = async (target: ReturnType<typeof makeDb>, email = admin.email) => {
    const agent = request.agent(createApp(target, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
    return agent
  }

  /** Una fila de ActionItem tal como la devuelve la consulta del payload de estrategias. */
  const taskItem = (id: string, title: string, overrides: Record<string, unknown> = {}) => ({
    id,
    title,
    status: 'PENDING',
    responsibleId: member.id,
    responsible: { id: member.id, name: member.name },
    dueDate: '2026-10-10',
    ticket: null,
    ...overrides,
  })

  /** Un ActionPlan ya asociado a una estrategia, con las claves que hace match en el GET. */
  const planFor = (id: string, source: string, sourceRef: string, items: unknown[]) => ({
    ...actionPlan,
    id,
    strategySource: source,
    strategySourceRef: sourceRef,
    strategyTitle: null,
    strategyDescription: null,
    items,
  })

  /** El mismo mock de creación que usa el endpoint real, para pasar por el flujo completo. */
  const harnessTaskCreation = (target: ReturnType<typeof makeDb>) => {
    const storedPlans: Array<Record<string, unknown>> = []
    const planDelegate = target.actionPlan as unknown as {
      findMany: { mockImplementation: (implementation: () => Promise<unknown[]>) => unknown }
      findUnique: { mockImplementation: (implementation: (input: { where: Record<string, unknown> }) => Promise<unknown>) => unknown }
      create: { mockImplementation: (implementation: (input: { data: Record<string, unknown> }) => Promise<unknown>) => unknown }
    }
    planDelegate.findMany.mockImplementation(async () => storedPlans)
    planDelegate.findUnique.mockImplementation(async (input: { where: Record<string, unknown> }) => {
      const where = input.where
      if (where.id) return storedPlans.find((plan) => plan.id === where.id) ?? null
      const key = where.diagnosticId_strategySource_strategySourceRef as { diagnosticId: string; strategySource: string; strategySourceRef: string }
      return storedPlans.find((plan) => plan.diagnosticId === key.diagnosticId && plan.strategySource === key.strategySource && plan.strategySourceRef === key.strategySourceRef) ?? null
    })
    planDelegate.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      const created = { ...actionPlan, ...data, createdBy: member, items: [] as unknown[] }
      storedPlans.push(created)
      return created
    })
    const itemDelegate = target.actionItem as unknown as {
      create: { mockImplementation: (implementation: (input: { data: Record<string, unknown> }) => Promise<unknown>) => unknown }
      update: { mockImplementation: (implementation: (input: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>) => unknown }
    }
    let createdItems = 0
    itemDelegate.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      createdItems += 1
      const created = { ...actionItem, ...data, id: `cmactionitemstrategy${createdItems}`, responsible: member, ticket: null }
      ;(storedPlans[0]?.items as Array<unknown> | undefined)?.push(created)
      return created
    })
    // La actualización de una tarea (por ejemplo al cerrar su ticket desde Tickets) tiene que verse
    // en el GET de estrategias, igual que en la base real.
    itemDelegate.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      let updated: Record<string, unknown> = { ...actionItem, ...data }
      for (const plan of storedPlans) {
        const rows = plan.items
        if (!Array.isArray(rows)) continue
        plan.items = rows.map((item) => {
          const row = item as { id: string }
          if (row.id !== where.id) return item
          updated = { ...row, ...data }
          return updated
        })
      }
      return { ...updated, responsible: member, ticket: null }
    })
    return storedPlans
  }

  it('devuelve actionPlan null para una estrategia sin tareas', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [])
    await seedAcceptedCheckyStrategy(db)
    const agent = await loginAgent(db)

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)

    expect(res.status).toBe(200)
    expect(res.body.strategies).toHaveLength(1)
    // Sin plan no hay tareas que pintar: la tarjeta queda en "Sin tareas asignadas".
    expect(res.body.strategies[0].actionPlan).toBeNull()
  })

  it('devuelve la única tarea de una estrategia con sus datos', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [])
    await seedAcceptedCheckyStrategy(db)
    const only = taskItem('cmactionitemtareas0000001', 'Recolectar las preguntas frecuentes del soporte', { status: 'IN_PROGRESS', dueDate: '2026-10-10' })
    const findMany = db.actionPlan.findMany as unknown as { mockImplementation: (implementation: () => Promise<unknown[]>) => unknown }
    findMany.mockImplementation(async () => [planFor('cmpplantareas0000000001', 'CHECKY', strategySourceRef(checkyDescription), [only])])
    const agent = await loginAgent(db)

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)

    const strategy = res.body.strategies.find((item: { source: string }) => item.source === 'CHECKY')
    expect(strategy.actionPlan.items).toHaveLength(1)
    expect(strategy.actionPlan.items[0]).toMatchObject({
      id: only.id,
      title: only.title,
      status: 'IN_PROGRESS',
      dueDate: '2026-10-10',
      responsible: { id: member.id, name: member.name },
    })
  })

  it('devuelve todas las tareas de una estrategia, sin perder ninguna', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [])
    await seedAcceptedCheckyStrategy(db)
    const items = [1, 2, 3].map((number) => taskItem(`cmactionitemtareas000000${number}`, `Control de cumplimiento ${number}`))
    const findMany = db.actionPlan.findMany as unknown as { mockImplementation: (implementation: () => Promise<unknown[]>) => unknown }
    findMany.mockImplementation(async () => [planFor('cmpplantareas0000000002', 'CHECKY', strategySourceRef(checkyDescription), items)])
    const agent = await loginAgent(db)

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)

    const strategy = res.body.strategies.find((item: { source: string }) => item.source === 'CHECKY')
    expect(strategy.actionPlan.items).toHaveLength(3)
    expect(strategy.actionPlan.items.map((item: { title: string }) => item.title)).toEqual(items.map((item) => item.title))
    expect(new Set(strategy.actionPlan.items.map((item: { id: string }) => item.id)).size).toBe(3)
  })

  it('deja cada tarea en la estrategia a la que pertenece, sin mezclarlas', async () => {
    const acceptedCross: SeededCross = { ...weightedCross, id: 'cmprioridadaceptada00001', strategyStatus: 'ACCEPTED' }
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [acceptedCross])
    await seedAcceptedCheckyStrategy(db)
    const crossTask = taskItem('cmactionitemtareas0000cru', 'Cerrar el plan del cruce FO')
    const checkyTasks = [taskItem('cmactionitemtareas0000k1', 'Primera tarea de Checky'), taskItem('cmactionitemtareas0000k2', 'Segunda tarea de Checky')]
    const findMany = db.actionPlan.findMany as unknown as { mockImplementation: (implementation: () => Promise<unknown[]>) => unknown }
    findMany.mockImplementation(async () => [
      planFor('cmpplantareas000000000c', 'STRATEGIC_CROSS', strategySourceRef(weightedCross.strategy ?? ''), [crossTask]),
      planFor('cmpplantareas000000000k', 'CHECKY', strategySourceRef(checkyDescription), checkyTasks),
    ])
    const agent = await loginAgent(db)

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)

    expect(res.body.strategies).toHaveLength(2)
    const fromCross = res.body.strategies.find((item: { source: string }) => item.source === 'STRATEGIC_CROSS')
    const fromChecky = res.body.strategies.find((item: { source: string }) => item.source === 'CHECKY')
    expect(fromCross.actionPlan.items.map((item: { id: string }) => item.id)).toEqual([crossTask.id])
    expect(fromChecky.actionPlan.items.map((item: { id: string }) => item.id)).toEqual(checkyTasks.map((item) => item.id))
  })

  it('muestra las tareas creadas con el flujo existente después de recargar', async () => {
    const db = makeDb('COMPANY_ADMIN', member.id, null, company.id, [], [])
    const strategyDescription = 'Estandarizar la apertura de cuentas con responsables y controles definidos.'
    await seedAcceptedCheckyStrategy(db, { suggestedStrategyTitle: 'Estandarizar la apertura de cuentas', suggestedStrategyDescription: strategyDescription })
    harnessTaskCreation(db)
    const agent = await loginAgent(db, member.email)
    await agent.put(`/api/diagnostics/${diagnostic.id}/strategies/weighting`).send({ source: 'CHECKY', sourceRef: strategySourceRef(strategyDescription), impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'ALTO', sinergiaInterna: 'MEDIO', impactoReputacional: 'MEDIO' })

    const before = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    expect(before.body.strategies[0].actionPlan).toBeNull()

    const tasks = [
      { title: 'Recolectar las preguntas frecuentes del soporte', responsibleId: member.id, dueDate: '2026-10-10' },
      { title: 'Crear base de conocimiento', responsibleId: member.id, dueDate: '2026-10-15' },
    ]
    const created = await agent.post(`/api/diagnostics/${diagnostic.id}/strategy-tasks`).send({ strategyId: before.body.strategies[0].id, tasks })
    expect(created.status).toBe(201)
    expect(created.body.createdCount).toBe(2)

    // El mismo GET que dispara el reload existente después de crear las tareas.
    const after = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    expect(after.body.strategies[0].actionPlan.items).toHaveLength(2)
    expect(after.body.strategies[0].actionPlan.items.map((item: { title: string }) => item.title)).toEqual(tasks.map((task) => task.title))
    expect(new Set(after.body.strategies[0].actionPlan.items.map((item: { id: string }) => item.id)).size).toBe(2)

    // Repetir la misma tarea no duplica filas ni en la base ni en la tarjeta.
    const repeated = await agent.post(`/api/diagnostics/${diagnostic.id}/strategy-tasks`).send({ strategyId: before.body.strategies[0].id, tasks: [tasks[0]] })
    expect(repeated.status).toBe(200)
    expect(repeated.body.createdCount).toBe(0)
    const reloaded = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    expect(reloaded.body.strategies[0].actionPlan.items).toHaveLength(2)
  })

  it('refleja en Ponderación el estado de una tarea que se cambia desde Tickets', async () => {
    const db = makeDb('COMPANY_ADMIN', member.id, null, company.id, [], [])
    const strategyDescription = 'Estandarizar la apertura de cuentas con responsables y controles definidos.'
    await seedAcceptedCheckyStrategy(db, { suggestedStrategyTitle: 'Estandarizar la apertura de cuentas', suggestedStrategyDescription: strategyDescription })
    harnessTaskCreation(db)
    const agent = await loginAgent(db, member.email)
    await agent.put(`/api/diagnostics/${diagnostic.id}/strategies/weighting`).send({ source: 'CHECKY', sourceRef: strategySourceRef(strategyDescription), impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'ALTO', sinergiaInterna: 'MEDIO', impactoReputacional: 'MEDIO' })

    const listed = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    const tasks = [1, 2, 3].map((number) => ({ title: `Control de cumplimiento ${number}`, responsibleId: member.id, dueDate: `2026-10-0${number}` }))
    const created = await agent.post(`/api/diagnostics/${diagnostic.id}/strategy-tasks`).send({ strategyId: listed.body.strategies[0].id, tasks })
    expect(created.status).toBe(201)

    const before = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    expect(before.body.strategies[0].actionPlan.items.map((item: { status: string }) => item.status)).toEqual(['PENDING', 'PENDING', 'PENDING'])

    // El mismo movimiento que se hace en la pantalla de Tickets: la tarea pasa a resuelta.
    const tickets = await agent.get('/api/tickets')
    const linked = tickets.body.tickets.find((entry: { actionItemId: string | null }) => Boolean(entry.actionItemId))
    expect(linked).toBeDefined()
    const patched = await agent.patch(`/api/tickets/${linked.id}`).send({ status: 'RESOLVED' })
    expect(patched.status).toBe(200)

    // Volver a Ponderación es el mismo GET: el progreso se recalcula con el estado actual.
    const after = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    const items = after.body.strategies[0].actionPlan.items
    expect(items.filter((item: { status: string }) => item.status === 'COMPLETED').map((item: { id: string }) => item.id)).toEqual([linked.actionItemId])
    expect(items.filter((item: { status: string }) => item.status === 'PENDING')).toHaveLength(2)
  })

  it('no cambia la tarea vinculada cuando un ticket se guarda sin tocar su estado', async () => {
    const db = makeDb('COMPANY_ADMIN', member.id, null, company.id, [], [])
    const strategyDescription = 'Estandarizar la apertura de cuentas con responsables y controles definidos.'
    await seedAcceptedCheckyStrategy(db, { suggestedStrategyTitle: 'Estandarizar la apertura de cuentas', suggestedStrategyDescription: strategyDescription })
    harnessTaskCreation(db)
    const agent = await loginAgent(db, member.email)
    await agent.put(`/api/diagnostics/${diagnostic.id}/strategies/weighting`).send({ source: 'CHECKY', sourceRef: strategySourceRef(strategyDescription), impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'ALTO', sinergiaInterna: 'MEDIO', impactoReputacional: 'MEDIO' })
    const listed = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    const created = await agent.post(`/api/diagnostics/${diagnostic.id}/strategy-tasks`).send({ strategyId: listed.body.strategies[0].id, tasks: [{ title: 'Control de cumplimiento 1', responsibleId: member.id, dueDate: '2026-10-01' }] })
    expect(created.status).toBe(201)

    const tickets = await agent.get('/api/tickets')
    const linked = tickets.body.tickets.find((entry: { actionItemId: string | null }) => Boolean(entry.actionItemId))
    expect(await agent.patch(`/api/tickets/${linked.id}`).send({ status: 'OPEN', priority: 'HIGH' })).toHaveProperty('status', 200)

    const after = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    expect(after.body.strategies[0].actionPlan.items.map((item: { status: string }) => item.status)).toEqual(['PENDING'])
    expect((db.actionItem.update as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0)
  })

  it('al cambiar el estado de una tarea y volver a cargar, el progreso se recalcula con lo actual', async () => {
    const db = makeDb('COMPANY_ADMIN', member.id, null, company.id, [], [])
    const strategyDescription = 'Estandarizar la apertura de cuentas con responsables y controles definidos.'
    await seedAcceptedCheckyStrategy(db, { suggestedStrategyTitle: 'Estandarizar la apertura de cuentas', suggestedStrategyDescription: strategyDescription })
    const storedPlans = harnessTaskCreation(db)
    const agent = await loginAgent(db, member.email)
    await agent.put(`/api/diagnostics/${diagnostic.id}/strategies/weighting`).send({ source: 'CHECKY', sourceRef: strategySourceRef(strategyDescription), impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'ALTO', sinergiaInterna: 'MEDIO', impactoReputacional: 'MEDIO' })
    const listed = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    const created = await agent.post(`/api/diagnostics/${diagnostic.id}/strategy-tasks`).send({
      strategyId: listed.body.strategies[0].id,
      tasks: [
        { title: 'Control de cumplimiento 1', responsibleId: member.id, dueDate: '2026-10-01' },
        { title: 'Control de cumplimiento 2', responsibleId: member.id, dueDate: '2026-10-02' },
      ],
    })
    expect(created.status).toBe(201)

    const items = (storedPlans[0]?.items ?? []) as Array<{ id: string; status: string }>
    expect(items.map((item) => item.status)).toEqual(['PENDING', 'PENDING'])
    // El mock de findUnique devuelve la fila fija del fixture: aquí se le da la de esta estrategia.
    const findUnique = db.actionItem.findUnique as unknown as { mockImplementation: (implementation: (input: { where: { id: string } }) => Promise<unknown>) => unknown }
    findUnique.mockImplementation(async ({ where }) => {
      const row = items.find((item) => item.id === where.id)
      if (!row) return null
      return { ...row, responsible: member, recommendation: null, actionPlan: { ...actionPlan, diagnosticId: diagnostic.id, diagnostic: { companyId: company.id, company: { id: company.id, name: company.name } } } }
    })

    const patched = await agent.patch(`/api/action-items/${items[0].id}`).send({ status: 'COMPLETED' })
    expect(patched.status).toBe(200)

    // El mismo GET que dispara Ponderación al volver a la pantalla.
    const after = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    expect(after.body.strategies[0].actionPlan.items.map((item: { status: string }) => item.status)).toEqual(['COMPLETED', 'PENDING'])
  })

  it('acepta como responsable un id de usuario con formato uuid, sin rechazar el envío', async () => {
    const db = makeDb('COMPANY_ADMIN', member.id, null, company.id, [], [])
    const strategyDescription = 'Estandarizar la apertura de cuentas con responsables y controles definidos.'
    await seedAcceptedCheckyStrategy(db, { suggestedStrategyTitle: 'Estandarizar la apertura de cuentas', suggestedStrategyDescription: strategyDescription })
    harnessTaskCreation(db)
    // Id real de un usuario creado por el seed (gen_random_uuid): no cumple el formato cuid.
    const uuidResponsible = 'cafe89c0-079b-4f41-97d0-5d6de3b5f147'
    const findUnique = db.user.findUnique as unknown as {
      getMockImplementation: () => ((input: { where: { email?: string; id?: string } }) => Promise<unknown>) | undefined
      mockImplementation: (implementation: (input: { where: { email?: string; id?: string } }) => Promise<unknown>) => unknown
    }
    const lookup = findUnique.getMockImplementation()
    findUnique.mockImplementation(async (input) => {
      if (input.where.id === uuidResponsible) return { id: uuidResponsible, companyId: company.id, role: 'COMPANY_USER' }
      return lookup ? lookup(input) : null
    })
    const agent = await loginAgent(db, member.email)
    await agent.put(`/api/diagnostics/${diagnostic.id}/strategies/weighting`).send({ source: 'CHECKY', sourceRef: strategySourceRef(strategyDescription), impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'ALTO', sinergiaInterna: 'MEDIO', impactoReputacional: 'MEDIO' })

    const before = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    const created = await agent.post(`/api/diagnostics/${diagnostic.id}/strategy-tasks`).send({
      strategyId: before.body.strategies[0].id,
      tasks: [{ title: 'Acompañar la apertura de cuentas', responsibleId: uuidResponsible, dueDate: '2026-10-08' }],
    })

    // Antes el formato del id hacía fallar la validación con "Invalid strategy task data".
    expect(created.status).toBe(201)
    expect(created.body.createdCount).toBe(1)
  })
})

describe('decidir la estrategia de un cruce', () => {
  const withCross = (target: PrismaClient, overrides: Record<string, unknown> = {}) => {
    const findCross = target.strategicCross.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }
    findCross.mockResolvedValue({
      ...strategicCrossFixture,
      factor1: { id: strategicCrossFixture.factor1Id, swotId: diagnostic.swotAnalysis.id, type: 'STRENGTH', description: 'Equipo comprometido', createdAt: new Date('2026-01-04') },
      factor2: { id: strategicCrossFixture.factor2Id, swotId: diagnostic.swotAnalysis.id, type: 'OPPORTUNITY', description: 'Nuevo mercado', createdAt: new Date('2026-01-04') },
      diagnostic: { companyId: company.id, company: { id: company.id, name: company.name } },
      ...overrides,
    })
    return target
  }
  const loginAgent = async (target: PrismaClient, email = admin.email) => {
    const agent = request.agent(createApp(target, { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService))
    await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
    return agent
  }

  it('guarda la decisión de la estrategia en el propio cruce, sin crear otro', async () => {
    const db = withCross(makeDb())
    const agent = await loginAgent(db)

    const response = await agent.patch(`/api/crosses/${strategicCrossFixture.id}`).send({ strategyStatus: 'ACCEPTED' })

    expect(response.status).toBe(200)
    expect(response.body.cross).toMatchObject({ id: strategicCrossFixture.id, strategy: strategicCrossFixture.strategy, strategyStatus: 'ACCEPTED' })
    expect(db.strategicCross.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: strategicCrossFixture.id },
      data: { strategyStatus: 'ACCEPTED' },
    }))
    // La sección de Checky solo decide: nunca materializa un cruce nuevo.
    expect(db.strategicCross.create).not.toHaveBeenCalled()
  })

  it('rechaza decidir la estrategia de un cruce que no tiene ninguna', async () => {
    const db = withCross(makeDb(), { strategy: null })
    const agent = await loginAgent(db)

    const response = await agent.patch(`/api/crosses/${strategicCrossFixture.id}`).send({ strategyStatus: 'ACCEPTED' })

    expect(response.status).toBe(400)
    expect(db.strategicCross.update).not.toHaveBeenCalled()
  })

  it('no admite un estado que no sea una decisión de estrategia', async () => {
    const db = withCross(makeDb())
    const agent = await loginAgent(db)

    const response = await agent.patch(`/api/crosses/${strategicCrossFixture.id}`).send({ strategyStatus: 'APROBADA' })

    expect(response.status).toBe(400)
    expect(db.strategicCross.update).not.toHaveBeenCalled()
  })

  it('no encuentra un cruce de otra empresa para decidir su estrategia', async () => {
    const db = makeDb()
    const agent = await loginAgent(db)

    const response = await agent.patch(`/api/crosses/${strategicCrossFixture.id}`).send({ strategyStatus: 'ACCEPTED' })

    expect(response.status).toBe(404)
    expect(db.strategicCross.update).not.toHaveBeenCalled()
  })
})

describe('PUT /api/diagnostics/:id/strategies/weighting', () => {
  const aiText = 'Usar el compromiso del equipo para capturar oportunidades.'
  const checkyText = 'Asignar al equipo comprometido la apertura de cuentas nuevas.'
  const criteria = { impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'MUY_ALTO', sinergiaInterna: 'BAJO', impactoReputacional: 'MEDIO' }
  /** 20% de 4 + 25% de 3 + 20% de 5 + 15% de 2 + 20% de 3. */
  const expectedScore = 3.45

  const readOnlyAI = () => new AIService({ responses: { create: async () => { throw new Error('Ponderar no debe llamar a OpenAI') } } } as unknown as { responses: { create: (input: unknown) => Promise<{ output_text?: string }> } })

  const seedAcceptedCheckyStrategy = async (target: ReturnType<typeof makeDb>, overrides: Record<string, unknown> = {}) => {
    await (target.checkyMessage.create as (input: unknown) => Promise<unknown>)({
      data: {
        sessionId: checkySessionFixture.id,
        role: 'CHECKY',
        status: 'ACCEPTED',
        category: 'STRENGTHEN_STRATEGIES',
        content: 'Propongo reforzar la estrategia.',
        suggestedStrategyTitle: 'Reforzar la estrategia FO',
        suggestedStrategyDescription: checkyText,
        evidenceIds: [checkyFactorIds.strength, checkyFactorIds.opportunity],
        ...overrides,
      },
    })
  }

  const login = async (target: ReturnType<typeof makeDb>) => {
    const agent = request.agent(createApp(target, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    return agent
  }

  const put = (agent: Awaited<ReturnType<typeof login>>, body: Record<string, unknown>) =>
    agent.put(`/api/diagnostics/${diagnostic.id}/strategies/weighting`).send(body)

  const crossText = 'Apoyarse en el equipo comprometido para abrir el mercado en expansión.'
  const otherCrossText = 'Documentar los procesos manuales antes de que llegue la auditoría.'

  /** Cruce aceptado en Checky, listo para aparecer en Ponderación. Sin valoración por defecto. */
  const acceptedCrossStrategy = (overrides: Partial<SeededCross> = {}): SeededCross => ({
    id: 'cmponderacioncruce00001',
    crossType: 'FO',
    origin: 'AI',
    factor1Id: checkyFactorIds.strength,
    factor2Id: checkyFactorIds.opportunity,
    strategy: crossText,
    strategyStatus: 'ACCEPTED',
    weighting: null,
    ...overrides,
  })

  it('crea la ponderación de una estrategia de AI_ANALYSIS', async () => {
    const db = makeDb()
    const agent = await login(db)

    const res = await put(agent, { source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), ...criteria })

    expect(res.status).toBe(200)
    expect(res.body.weighting).toMatchObject({ source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), ...criteria, weightedScore: expectedScore, weightingBand: 'CORTO_PLAZO' })
    expect(db.strategyWeighting.upsert).toHaveBeenCalledTimes(1)
  })

  it('crea la ponderación de una estrategia de CHECKY', async () => {
    const db = makeDb()
    await seedAcceptedCheckyStrategy(db)
    const agent = await login(db)

    const res = await put(agent, { source: 'CHECKY', sourceRef: strategySourceRef(checkyText), ...criteria })

    expect(res.status).toBe(200)
    expect(res.body.weighting).toMatchObject({ source: 'CHECKY', sourceRef: strategySourceRef(checkyText), ...criteria, weightedScore: expectedScore })
  })

  it('crea la ponderación CHECKY para MISSING_CROSSES aceptada aunque exista el cruce relacionado', async () => {
    const relatedCross: SeededCross = { id: 'cmweightcheckycross001', crossType: 'FO', origin: 'AI', factor1Id: checkyFactorIds.strength, factor2Id: checkyFactorIds.opportunity, strategy: checkyText, weighting: null }
    const db = makeDb('COMPANY_ADMIN', member.id, null, company.id, [], [relatedCross])
    await seedAcceptedCheckyStrategy(db, { category: 'MISSING_CROSSES' })
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })

    const res = await put(agent, { source: 'CHECKY', sourceRef: strategySourceRef(checkyText), ...criteria })

    expect(res.status).toBe(200)
    expect(res.body.weighting).toMatchObject({ source: 'CHECKY', sourceRef: strategySourceRef(checkyText), weightedScore: expectedScore })
    expect(db.strategyWeighting.upsert).toHaveBeenCalledTimes(1)
  })

  it('acepta valorar una estrategia de cruce aceptada que todavía no tiene valoración', async () => {
    const cross = acceptedCrossStrategy()
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [cross])
    const agent = await login(db)

    // Llega a Ponderación con "Sin valoración": es la tarjeta que tiene que quedar editable.
    const listed = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    expect(listed.status).toBe(200)
    expect(listed.body.strategies).toHaveLength(1)
    expect(listed.body.strategies[0]).toMatchObject({
      id: `cross:${cross.id}`,
      source: 'STRATEGIC_CROSS',
      crossId: cross.id,
      weighting: null,
      weightedScore: null,
    })

    const res = await put(agent, { source: 'STRATEGIC_CROSS', sourceRef: strategySourceRef(crossText), ...criteria })

    expect(res.status).toBe(200)
    expect(res.body.weighting).toMatchObject({ source: 'STRATEGIC_CROSS', sourceRef: strategySourceRef(crossText), ...criteria, weightedScore: expectedScore, weightingBand: 'CORTO_PLAZO' })
    expect(db.strategicCrossWeighting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { crossId: cross.id },
      create: expect.objectContaining({ ...criteria, weightedScore: expectedScore }),
    }))
    // El cruce conserva su propia tabla: la ponderación de estrategias nunca se toca.
    expect(db.strategyWeighting.upsert).not.toHaveBeenCalled()

    // Al recargar, la tarjeta ya no está en "Sin valoración".
    const reread = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    expect(reread.body.strategies[0].weighting).toMatchObject({ ...criteria, weightedScore: expectedScore, weightingBand: 'CORTO_PLAZO' })
    expect(reread.body.strategies[0].weightedScore).toBe(expectedScore)
  })

  it('conserva la valoración que el cruce ya tenía y la actualiza sin crear otra fila', async () => {
    const cross = acceptedCrossStrategy({ weighting: { impactoEstrategico: 'BAJO', viabilidad: 'BAJO', urgencia: 'BAJO', sinergiaInterna: 'BAJO', impactoReputacional: 'BAJO', weightedScore: 2 } })
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [cross])
    const agent = await login(db)

    const before = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    expect(before.body.strategies[0]).toMatchObject({ weightedScore: 2, weighting: expect.objectContaining({ weightedScore: 2 }) })

    const res = await put(agent, { source: 'STRATEGIC_CROSS', sourceRef: strategySourceRef(crossText), ...criteria })

    expect(res.status).toBe(200)
    const upsert = db.strategicCrossWeighting.upsert as unknown as { mock: { calls: Array<[{ where: unknown; update: Record<string, unknown> }]> } }
    expect(upsert.mock.calls).toHaveLength(1)
    expect(upsert.mock.calls[0][0].where).toEqual({ crossId: cross.id })
    expect(upsert.mock.calls[0][0].update).toMatchObject({ ...criteria, weightedScore: expectedScore })

    const after = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    expect(after.body.strategies[0].weightedScore).toBe(expectedScore)
    expect(after.body.strategies[0].weighting.weightingBand).toBe('CORTO_PLAZO')
  })

  it('valora cruces aceptados con origen USER o IA por igual: el origen no decide si es editable', async () => {
    const userCross = acceptedCrossStrategy({ id: 'cmponderacioncruceuser01', origin: 'USER' })
    const aiCross = acceptedCrossStrategy({
      id: 'cmponderacioncruceai0001',
      origin: 'AI',
      crossType: 'DA',
      factor1Id: checkySwotItemFixtures.weakness.id,
      factor2Id: checkySwotItemFixtures.threat.id,
      strategy: otherCrossText,
    })
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [userCross, aiCross])
    const agent = await login(db)

    const userRes = await put(agent, { source: 'STRATEGIC_CROSS', sourceRef: strategySourceRef(crossText), ...criteria })
    const aiRes = await put(agent, { source: 'STRATEGIC_CROSS', sourceRef: strategySourceRef(otherCrossText), ...criteria })

    expect(userRes.status).toBe(200)
    expect(aiRes.status).toBe(200)
    const upsert = db.strategicCrossWeighting.upsert as unknown as { mock: { calls: Array<[{ where: { crossId: string } }]> } }
    expect(upsert.mock.calls.map((call) => call[0].where.crossId).sort()).toEqual([userCross.id, aiCross.id].sort())
    expect(db.strategyWeighting.upsert).not.toHaveBeenCalled()
  })

  it('valora las tres fuentes de Ponderación con el mismo criterio, cada una en su propia tabla', async () => {
    const cross = acceptedCrossStrategy()
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [cross])
    await seedAcceptedCheckyStrategy(db)
    const agent = await login(db)

    const ai = await put(agent, { source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), ...criteria })
    const checky = await put(agent, { source: 'CHECKY', sourceRef: strategySourceRef(checkyText), ...criteria })
    const fromCross = await put(agent, { source: 'STRATEGIC_CROSS', sourceRef: strategySourceRef(crossText), ...criteria })

    expect(ai.status).toBe(200)
    expect(checky.status).toBe(200)
    expect(fromCross.status).toBe(200)
    // Misma metodología, mismo puntaje: solo cambia en qué tabla se guarda.
    expect(ai.body.weighting.weightedScore).toBe(expectedScore)
    expect(checky.body.weighting.weightedScore).toBe(expectedScore)
    expect(fromCross.body.weighting.weightedScore).toBe(expectedScore)
    expect(db.strategyWeighting.upsert).toHaveBeenCalledTimes(2)
    expect(db.strategicCrossWeighting.upsert).toHaveBeenCalledTimes(1)
  })

  it('no permite ponderar una estrategia CHECKY que no fue aceptada', async () => {
    const db = makeDb()
    await seedAcceptedCheckyStrategy(db, { status: 'PENDING' })
    const agent = await login(db)

    const res = await put(agent, { source: 'CHECKY', sourceRef: strategySourceRef(checkyText), ...criteria })

    expect(res.status).toBe(404)
    expect(db.strategyWeighting.upsert).not.toHaveBeenCalled()
  })

  it('calcula el weightedScore en el servidor con los pesos de la metodología', async () => {
    const db = makeDb()
    const agent = await login(db)

    const res = await put(agent, { source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), impactoEstrategico: 'MUY_ALTO', viabilidad: 'MUY_ALTO', urgencia: 'MUY_ALTO', sinergiaInterna: 'MUY_ALTO', impactoReputacional: 'MUY_ALTO' })

    // Todo en MUY_ALTO vale 5: la suma de los pesos es 1, así que el techo es 5.
    expect(res.body.weighting.weightedScore).toBe(5)
  })

  it('no acepta un weightedScore enviado por el cliente', async () => {
    const db = makeDb()
    const agent = await login(db)

    const res = await put(agent, { source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), ...criteria, weightedScore: 5 })

    expect(res.status).toBe(400)
    expect(db.strategyWeighting.upsert).not.toHaveBeenCalled()
  })

  it('tampoco acepta diagnosticId, source, createdById ni id desde el cuerpo', async () => {
    const db = makeDb()
    const agent = await login(db)

    for (const extra of [{ diagnosticId: 'otro' }, { source: 'STRATEGIC_CROSS' }, { createdById: 'otro' }, { id: 'otro' }]) {
      const res = await put(agent, { source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), ...criteria, ...extra })
      expect(res.status, `el campo ${Object.keys(extra)[0]} no debe aceptarse`).toBe(400)
    }
    expect(db.strategyWeighting.upsert).not.toHaveBeenCalled()
  })

  it('no acepta un sourceRef que no corresponde a ninguna estrategia del diagnóstico', async () => {
    const db = makeDb()
    const agent = await login(db)

    const res = await put(agent, { source: 'AI_ANALYSIS', sourceRef: strategySourceRef('Estrategia que nadie propuso.'), ...criteria })

    expect(res.status).toBe(404)
    expect(db.strategyWeighting.upsert).not.toHaveBeenCalled()
  })

  it('no acepta un source incorrecto para un texto que sí existe', async () => {
    const db = makeDb()
    await seedAcceptedCheckyStrategy(db)
    const agent = await login(db)

    // El texto existe, pero es de CHECKY: declararlo como IA sería atribuirle un valor de otra fuente.
    const res = await put(agent, { source: 'AI_ANALYSIS', sourceRef: strategySourceRef(checkyText), ...criteria })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('CHECKY')
    expect(db.strategyWeighting.upsert).not.toHaveBeenCalled()
  })

  it('valora el cruce en su propia tabla de ponderación y jamás en la de estrategias', async () => {
    const cross: SeededCross = { id: 'cmprioridad00000000000001', crossType: 'FO', origin: 'USER', factor1Id: checkyFactorIds.strength, factor2Id: checkyFactorIds.opportunity, strategy: aiText, strategyStatus: 'ACCEPTED', weighting: null }
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [cross])
    const agent = await login(db)

    // El texto es el mismo que el de una estrategia IA, pero gana el cruce, que es la fuente que la
    // lista consolidada dejó: así no se le atribuye el valor a la fuente equivocada.
    const res = await put(agent, { source: 'STRATEGIC_CROSS', sourceRef: strategySourceRef(aiText), ...criteria })

    expect(res.status).toBe(200)
    expect(db.strategicCrossWeighting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { crossId: cross.id },
      create: expect.objectContaining({ weightedScore: expectedScore }),
    }))
    expect(db.strategyWeighting.upsert).not.toHaveBeenCalled()
  })

  it('no duplica la fila al volver a valorar la misma estrategia', async () => {
    const db = makeDb()
    const agent = await login(db)

    await put(agent, { source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), ...criteria })
    const second = await put(agent, { source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), ...criteria, urgencia: 'BAJO' })

    expect(second.status).toBe(200)
    // El upsert va siempre por la clave diagnosticId + source + sourceRef, así que la segunda llamada
    // actualiza la fila en vez de crear otra.
    const calls = (db.strategyWeighting.upsert as unknown as { mock: { calls: { where: { diagnosticId_source_sourceRef: unknown } }[][] } }).mock.calls
    expect(calls).toHaveLength(2)
    for (const args of calls) {
      expect(args[0].where.diagnosticId_source_sourceRef).toEqual({ diagnosticId: diagnostic.id, source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText) })
    }
    const listed = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)
    const valued = listed.body.strategies.filter((strategy: { description: string; weighting: unknown }) => strategy.description === aiText && strategy.weighting !== null)
    expect(valued).toHaveLength(1)
  })

  it('acepta el mismo sourceRef con el texto escrito de otra manera, porque el ancla es el hash del texto normalizado', async () => {
    const db = makeDb()
    const agent = await login(db)

    const original = await put(agent, { source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), ...criteria })
    const reescrito = await put(agent, { source: 'AI_ANALYSIS', sourceRef: strategySourceRef(`  ${aiText.toUpperCase()} `), ...criteria })

    expect(original.status).toBe(200)
    expect(reescrito.status).toBe(200)
    expect(original.body.weighting.sourceRef).toBe(reescrito.body.weighting.sourceRef)
  })

  it('devuelve la ponderación guardada en GET strategies', async () => {
    const db = makeDb()
    const agent = await login(db)
    await put(agent, { source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), ...criteria })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    expect(res.status).toBe(200)
    const strategy = res.body.strategies.find((item: { description: string; weighting: unknown }) => item.description === aiText)
    expect(strategy.weighting).toEqual({ ...criteria, weightedScore: expectedScore, weightingBand: 'CORTO_PLAZO' })
    expect(strategy.weightedScore).toBe(expectedScore)
    expect(strategy.weightingBand).toBe('CORTO_PLAZO')
  })

  it('devuelve weighting null en las estrategias que todavía no se valoraron', async () => {
    const db = makeDb()
    const agent = await login(db)

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    expect(res.status).toBe(200)
    expect(res.body.strategies.length).toBeGreaterThan(0)
    for (const strategy of res.body.strategies) {
      expect(strategy.weighting).toBeNull()
      expect(strategy.weightedScore).toBeNull()
      expect(strategy.weightingBand).toBeNull()
    }
  })

  it('sigue tomando la ponderación de los cruces de StrategicCrossWeighting', async () => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [{ id: 'cmprioridad00000000000001', crossType: 'FO', origin: 'USER', factor1Id: checkyFactorIds.strength, factor2Id: checkyFactorIds.opportunity, strategy: 'Llevar el equipo comprometido al mercado antes de que se consolide.', weighting: { impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'MUY_ALTO', sinergiaInterna: 'BAJO', impactoReputacional: 'MEDIO', weightedScore: 4.4 } }])
    const agent = await login(db)

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    const cross = res.body.strategies.find((item: { source: string }) => item.source === 'STRATEGIC_CROSS')
    expect(cross.weighting).toEqual({ impactoEstrategico: 'ALTO', viabilidad: 'MEDIO', urgencia: 'MUY_ALTO', sinergiaInterna: 'BAJO', impactoReputacional: 'MEDIO', weightedScore: 4.4, weightingBand: 'INMEDIATA' })
    // La tabla nueva no se activa para los cruces: no hay fila para este texto.
    expect(db.strategyWeighting.upsert).not.toHaveBeenCalled()
  })

  it('no escribe en StrategicCrossWeighting ni crea cruces al ponderar una estrategia de IA', async () => {
    const db = makeDb()
    const agent = await login(db)

    await put(agent, { source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), ...criteria })

    expect(db.strategicCross.create).not.toHaveBeenCalled()
    expect(db.strategicCrossWeighting.upsert).not.toHaveBeenCalled()
  })

  it('no deja que un administrador de otra empresa valore las estrategias del diagnóstico', async () => {
    // COMPANY_ADMIN pasa el guard de escritura, así que lo que lo detiene es el aislamiento.
    const db = makeDb('COMPANY_ADMIN', member.id, null, otherCompanyId)
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })

    const res = await agent.put(`/api/diagnostics/${diagnostic.id}/strategies/weighting`).send({ source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), ...criteria })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Diagnostic not found')
    expect(db.strategyWeighting.upsert).not.toHaveBeenCalled()
  })

  it('no deja que un ADMIN de otra empresa lea la ponderación consolidada', async () => {
    const db = makeDb('COMPANY_ADMIN', member.id, null, otherCompanyId)
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })

    const res = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)

    expect(res.status).toBe(404)
  })

  it('mantiene la regla de escritura actual: COMPANY_USER sigue sin poder valorar, igual que en el resto de rutas', async () => {
    const db = makeDb('COMPANY_USER', member.id, null, companyId)
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })

    const res = await agent.put(`/api/diagnostics/${diagnostic.id}/strategies/weighting`).send({ source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), ...criteria })

    // userWriteGuard es requireRole(SUPERUSER, COMPANY_ADMIN), el mismo de toda la API.
    expect(res.status).toBe(403)
    expect(db.strategyWeighting.upsert).not.toHaveBeenCalled()
  })

  it('deja que el COMPANY_ADMIN de la misma empresa valore sus estrategias', async () => {
    const db = makeDb('COMPANY_ADMIN', member.id, null, companyId)
    const agent = request.agent(createApp(db, readOnlyAI()))
    await agent.post('/api/auth/login').send({ email: member.email, password: 'Password123!' })

    const res = await agent.put(`/api/diagnostics/${diagnostic.id}/strategies/weighting`).send({ source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), ...criteria })

    expect(res.status).toBe(200)
  })

  it('responde 401 sin autenticación', async () => {
    const res = await request(createApp(makeDb(), readOnlyAI()))
      .put(`/api/diagnostics/${diagnostic.id}/strategies/weighting`)
      .send({ source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), ...criteria })

    expect(res.status).toBe(401)
  })

  it('valida el sourceRef contra la consolidación real y no contra lo que dice el cliente', async () => {
    const db = makeDb()
    const agent = await login(db)
    // La IA no propuso este texto, pero el hash es válido como cadena.
    const invented = strategySourceRef('Texto que el análisis nunca propuso.')

    const res = await put(agent, { source: 'AI_ANALYSIS', sourceRef: invented, ...criteria })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Strategy not found')
  })

  it('no filtra el diagnosticId del cuerpo: siempre pesa sobre el diagnóstico de la ruta', async () => {
    const db = makeDb()
    const agent = await login(db)

    const res = await put(agent, { source: 'AI_ANALYSIS', sourceRef: strategySourceRef(aiText), ...criteria, diagnosticId: 'cmdiagnosticotro000000001' })

    // El campo no se acepta; la fila que se crea pertenece al diagnostic de la URL.
    expect(res.status).toBe(400)
    expect(db.strategyWeighting.upsert).not.toHaveBeenCalled()
  })
})

/**
 * Regla de negocio de Checky: solo hay estrategia cuando detrás hay un cruce DOFA válido entre DOS
 * factores reales del diagnóstico (FO, FA, DO o DA). Lo que no tiene pareja se descarta antes de
 * persistirse, y si ya estuviera guardado no vuelve a mostrarse en Checky ni a llegar a Ponderación.
 */
describe('Checky solo propone estrategias con pareja DOFA válida', () => {
  const f = {
    strength: checkySwotItemFixtures.strength,
    weakness: checkySwotItemFixtures.weakness,
    opportunity: checkySwotItemFixtures.opportunity,
    threat: checkySwotItemFixtures.threat,
    otherStrength: checkySwotItemFixtures.sameQuadrant,
  }
  const strategy = { title: 'Abrir cuentas en el mercado', description: 'Asignar al equipo comprometido la apertura de cuentas nuevas durante el próximo trimestre.' }
  const unknownFactorId = 'cminexistente0000000001'

  const findingFor = (evidenceIds: string[], overrides: Record<string, unknown> = {}) => ({
    category: 'STRENGTHEN_STRATEGIES',
    title: 'Reforzar el enfoque comercial',
    detail: 'La pareja de factores permite afinar el plan del próximo trimestre.',
    basis: 'INFERENCE',
    evidenceIds,
    suggestedStrategy: { title: strategy.title, description: strategy.description },
    ...overrides,
  })
  const resultFor = (findings: unknown[]) => ({ reply: 'Revisión lista.', insufficientData: false, missingInformation: [], findings })

  type TestAgent = ReturnType<typeof request.agent>
  const login = async (agent: TestAgent) => {
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
  }
  /** La priorización es de solo lectura: si un test llegara a llamar a OpenAI, esto revienta. */
  const readOnlyAI = () => new AIService({ responses: { create: async () => { throw new Error('Esta prueba no debe llamar a OpenAI') } } } as unknown as { responses: { create: (input: unknown) => Promise<{ output_text?: string }> } })

  /** Consulta con la respuesta del modelo mockeada; el resto de la ruta es la de siempre. */
  const consult = async (findings: unknown[], crosses: SeededCross[] = []) => {
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], crosses)
    const aiService = { consultChecky: vi.fn(async () => resultFor(findings)) } as unknown as AIService
    const agent = request.agent(createApp(db, aiService))
    await login(agent)
    const sent = await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: 'Propón estrategias' })
    return { db, agent, sent, aiService }
  }

  const sessionOf = async (agent: TestAgent) => {
    const read = await agent.get(`/api/checky/sessions/${checkySessionFixture.id}`)
    return read.body.messages as Array<{ id: string; category: string | null; content: string; status: string | null }>
  }

  /** Sugerencia heredada, escrita directamente en la BD como si viniera de una versión anterior. */
  const seedLegacySuggestion = async (db: ReturnType<typeof makeDb>, overrides: Record<string, unknown> = {}) => {
    const created = await (db.checkyMessage.create as unknown as (args: { data: Record<string, unknown> }) => Promise<{ id: string }>)({
      data: {
        sessionId: checkySessionFixture.id,
        role: 'CHECKY',
        content: 'Posible cruce no explorado\nHallazgo heredado sin pareja validada.',
        category: 'MISSING_CROSSES',
        basis: 'FACT',
        evidenceIds: [],
        insufficientData: false,
        missingInformation: [],
        status: 'PENDING',
        decisionNote: null,
        suggestedStrategyTitle: 'Estrategia heredada',
        suggestedStrategyDescription: 'Descripción de la estrategia heredada que no tiene pareja DOFA detrás.',
        ...overrides,
      },
    })
    return created.id
  }

  const validPairs = [
    { crossType: 'FO', evidenceIds: [f.strength.id, f.opportunity.id], internal: 'STRENGTH', external: 'OPPORTUNITY' },
    { crossType: 'FA', evidenceIds: [f.strength.id, f.threat.id], internal: 'STRENGTH', external: 'THREAT' },
    { crossType: 'DO', evidenceIds: [f.weakness.id, f.opportunity.id], internal: 'WEAKNESS', external: 'OPPORTUNITY' },
    { crossType: 'DA', evidenceIds: [f.weakness.id, f.threat.id], internal: 'WEAKNESS', external: 'THREAT' },
  ]
  for (const pair of validPairs) {
    it(`acepta la pareja ${pair.crossType}, la enseña en Checky y la deja para Ponderación`, async () => {
      const { agent, sent } = await consult([findingFor(pair.evidenceIds)])
      expect(sent.status).toBe(201)
      expect(sent.body.suggestions).toHaveLength(1)
      expect(sent.body.suggestions[0].status).toBe('PENDING')

      const decision = await agent.patch(`/api/checky/sessions/${checkySessionFixture.id}/messages/${sent.body.suggestions[0].id}`).send({ status: 'ACCEPTED' })
      expect(decision.status).toBe(200)

      const listed = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
      expect(listed.status).toBe(200)
      expect(listed.body.strategies).toHaveLength(1)
      expect(listed.body.strategies[0]).toMatchObject({ source: 'CHECKY', description: strategy.description })
      expect(listed.body.strategies[0].factor1).toMatchObject({ type: pair.internal })
      expect(listed.body.strategies[0].factor2).toMatchObject({ type: pair.external })

      // Ponderación valora exactamente la lista que acaba de leer.
      const valued = await agent.put(`/api/diagnostics/${diagnostic.id}/strategies/weighting`).send({
        source: 'CHECKY',
        sourceRef: strategySourceRef(strategy.description),
        impactoEstrategico: 'ALTO',
        viabilidad: 'MEDIO',
        urgencia: 'MEDIO',
        sinergiaInterna: 'MEDIO',
        impactoReputacional: 'MEDIO',
      })
      expect(valued.status).toBe(200)
    })
  }

  it('descarta la sugerencia cuyo factor1 no existe en el diagnóstico', async () => {
    const { agent, sent } = await consult([findingFor([unknownFactorId, f.opportunity.id])])
    expect(sent.status).toBe(201)
    expect(sent.body.suggestions).toEqual([])
    const messages = await sessionOf(agent)
    expect(messages.filter((message) => message.category !== null)).toEqual([])
  })

  it('descarta la sugerencia cuyo factor2 no existe en el diagnóstico', async () => {
    const { agent, sent } = await consult([findingFor([f.strength.id, unknownFactorId])])
    expect(sent.body.suggestions).toEqual([])
    const messages = await sessionOf(agent)
    expect(messages.filter((message) => message.category !== null)).toEqual([])
  })

  it('descarta la pareja de dos factores del mismo tipo, porque no es ningún cruce DOFA', async () => {
    const { agent, sent } = await consult([
      // Dos internas: fortaleza con fortaleza.
      findingFor([f.strength.id, f.otherStrength.id]),
      // Dos externas: amenaza con oportunidad.
      findingFor([f.threat.id, f.opportunity.id]),
    ])
    expect(sent.body.suggestions).toEqual([])
    const messages = await sessionOf(agent)
    expect(messages.filter((message) => message.category !== null)).toEqual([])
  })

  it('descarta la sugerencia que cita el mismo factor como factor1 y factor2', async () => {
    const { agent, sent } = await consult([findingFor([f.strength.id, f.strength.id])])
    expect(sent.body.suggestions).toEqual([])
    const messages = await sessionOf(agent)
    expect(messages.filter((message) => message.category !== null)).toEqual([])
  })

  it('no persiste un MISSING_CROSSES sin pareja válida', async () => {
    const { agent, sent } = await consult([
      findingFor([f.strength.id], { category: 'MISSING_CROSSES' }),
      findingFor([], { category: 'MISSING_CROSSES', suggestedStrategy: null }),
    ])
    expect(sent.body.suggestions).toEqual([])
    // Ni en la respuesta de la consulta ni en la lectura posterior de la sesión.
    expect(sent.body.messages.some((message: { category: string | null }) => message.category === 'MISSING_CROSSES')).toBe(false)
    const messages = await sessionOf(agent)
    expect(messages.some((message) => message.category === 'MISSING_CROSSES')).toBe(false)
  })

  it('no enseña en Checky ni entrega a Ponderación una sugerencia heredada sin pareja', async () => {
    const db = makeDb()
    const agent = request.agent(createApp(db, readOnlyAI()))
    await login(agent)
    const legacyId = await seedLegacySuggestion(db, { status: 'ACCEPTED' })

    const messages = await sessionOf(agent)
    expect(messages.some((message) => message.id === legacyId)).toBe(false)

    const listed = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    expect(listed.status).toBe(200)
    expect(listed.body.strategies.filter((strategyEntry: { source: string }) => strategyEntry.source === 'CHECKY')).toEqual([])
  })

  it('no muestra el aviso "Posible cruce no explorado" como si fuera una estrategia', async () => {
    const fresh = await consult([findingFor([], {
      category: 'MISSING_CROSSES',
      title: 'Posible cruce no explorado',
      detail: 'Checky detectó una pareja que quizá convenga revisar.',
      suggestedStrategy: null,
    })])
    expect(fresh.sent.body.suggestions).toEqual([])
    expect((await sessionOf(fresh.agent)).some((message) => message.content.includes('Posible cruce no explorado'))).toBe(false)

    const db = makeDb()
    const agent = request.agent(createApp(db, readOnlyAI()))
    await login(agent)
    await seedLegacySuggestion(db, { status: 'ACCEPTED' })
    expect((await sessionOf(agent)).some((message) => message.content.includes('Posible cruce no explorado'))).toBe(false)
  })

  it('no propone dos veces la misma pareja DOFA en una misma respuesta', async () => {
    const { agent, sent } = await consult([
      findingFor([f.strength.id, f.opportunity.id], { category: 'MISSING_CROSSES', detail: 'Falta el cruce FO entre la fortaleza y la oportunidad.' }),
      findingFor([f.opportunity.id, f.strength.id], { category: 'MISSING_CROSSES', title: 'Otra vez el mismo cruce', detail: 'Segunda propuesta del mismo cruce FO.' }),
    ])
    expect(sent.body.suggestions).toHaveLength(1)
    expect(sent.body.suggestions[0].content).toContain('Falta el cruce FO')
    const messages = await sessionOf(agent)
    expect(messages.filter((message) => message.category === 'MISSING_CROSSES')).toHaveLength(1)
  })

  it('relaciona la pareja con el StrategicCross existente y lo reutiliza al aceptar, sin duplicarlo', async () => {
    const existingCross: SeededCross = {
      id: 'cmcrossyaregistrado00001',
      crossType: 'FO',
      origin: 'USER',
      factor1Id: f.strength.id,
      factor2Id: f.opportunity.id,
      strategy: 'Cruce ya registrado entre la fortaleza y la oportunidad.',
      weighting: null,
    }
    const { db, agent, sent } = await consult([findingFor([f.strength.id, f.opportunity.id], { category: 'MISSING_CROSSES' })], [existingCross])
    expect(sent.status).toBe(201)
    // La pareja ya es un cruce de la matriz: la sugerencia se conserva y se relaciona con él.
    expect(sent.body.suggestions).toHaveLength(1)
    // La tarjeta necesita los dos ids de factor reales para pintar la pareja DOFA.
    expect(sent.body.suggestions[0].evidenceIds).toEqual(expect.arrayContaining([f.strength.id, f.opportunity.id]))

    const accepted = await agent.post(`/api/checky/suggestions/${sent.body.suggestions[0].id}/accept`)
    expect(accepted.status).toBe(201)
    expect(accepted.body.cross.id).toBe(existingCross.id)
    expect(accepted.body.suggestion.status).toBe('ACCEPTED')
    expect(db.strategicCross.create).not.toHaveBeenCalled()

    // El cruce del usuario queda en la matriz y la interpretación de Checky entra en Ponderación.
    const listed = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies`)
    expect(listed.body.strategies.filter((entry: { source: string }) => entry.source === 'STRATEGIC_CROSS')).toHaveLength(1)
    const pondered = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    expect(pondered.body.strategies.filter((entry: { source: string }) => entry.source === 'CHECKY')).toHaveLength(1)
  })

  it('acepta una sugerencia que cita solo el id de un cruce y deja escritos los dos factores', async () => {
    const cross: SeededCross = {
      id: 'cmcrosssoloidevidencia01',
      crossType: 'FO',
      origin: 'USER',
      factor1Id: f.strength.id,
      factor2Id: f.opportunity.id,
      strategy: 'Cruce existente que Checky cita solo por su id.',
      weighting: null,
    }
    const { db, agent, sent } = await consult([findingFor([cross.id], { category: 'MISSING_CROSSES' })], [cross])
    expect(sent.body.suggestions).toHaveLength(1)
    expect(sent.body.suggestions[0].evidenceIds).toEqual(expect.arrayContaining([cross.id, f.strength.id, f.opportunity.id]))

    const accepted = await agent.post(`/api/checky/suggestions/${sent.body.suggestions[0].id}/accept`)
    expect(accepted.status).toBe(201)
    expect(accepted.body.cross.id).toBe(cross.id)
    expect(db.strategicCross.create).not.toHaveBeenCalled()

    const read = await agent.get(`/api/checky/sessions/${checkySessionFixture.id}`)
    const stored = read.body.messages.find((message: { id: string }) => message.id === sent.body.suggestions[0].id)
    expect(stored.evidenceIds).toEqual(expect.arrayContaining([f.strength.id, f.opportunity.id]))
  })

  it('crea el cruce nuevo cuando la pareja todavía no existe en la matriz DOFA', async () => {
    const { db, agent, sent } = await consult([findingFor([f.weakness.id, f.threat.id], { category: 'MISSING_CROSSES' })])
    expect(sent.body.suggestions).toHaveLength(1)

    const accepted = await agent.post(`/api/checky/suggestions/${sent.body.suggestions[0].id}/accept`)
    expect(accepted.status).toBe(201)
    expect(accepted.body.cross).toMatchObject({ crossType: 'DA', diagnosticId: diagnostic.id })
    expect(accepted.body.cross.factor1.id).toBe(f.weakness.id)
    expect(accepted.body.cross.factor2.id).toBe(f.threat.id)
    expect(db.strategicCross.create).toHaveBeenCalledTimes(1)
    expect(db.strategicCross.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      origin: 'AI', crossType: 'DA', factor1Id: f.weakness.id, factor2Id: f.threat.id,
    }) }))

    // La estrategia de Checky queda aceptada para Ponderación; el cruce creado entra en la matriz.
    const pondered = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    expect(pondered.body.strategies.filter((entry: { source: string }) => entry.source === 'CHECKY')).toHaveLength(1)
    expect(pondered.body.strategies[0].factor1).toMatchObject({ id: f.weakness.id })
    expect(pondered.body.strategies[0].factor2).toMatchObject({ id: f.threat.id })
  })

  it('rechaza con 400 aceptar una sugerencia heredada sin pareja por la vía de aceptación', async () => {
    const db = makeDb()
    const agent = request.agent(createApp(db, readOnlyAI()))
    await login(agent)
    const singleFactor = await seedLegacySuggestion(db, { evidenceIds: [f.strength.id] })
    const first = await agent.post(`/api/checky/suggestions/${singleFactor}/accept`)
    expect(first.status).toBe(400)
    expect(first.body.error).toBe('A missing cross suggestion must cite exactly two factors of this diagnostic')

    const sameQuadrant = await seedLegacySuggestion(db, { evidenceIds: [f.strength.id, f.otherStrength.id] })
    const second = await agent.post(`/api/checky/suggestions/${sameQuadrant}/accept`)
    expect(second.status).toBe(400)
    expect(second.body.error).toBe('These factors do not form a valid strategic cross (FO, DO, FA or DA)')
    expect(db.strategicCross.create).not.toHaveBeenCalled()
  })

  it('el cruce DOFA que registró la usuaria llega al contexto con el que Checky decide', async () => {
    const userCross: SeededCross = {
      id: 'cmcrossusuariachecky01',
      crossType: 'FO',
      origin: 'USER',
      factor1Id: f.strength.id,
      factor2Id: f.opportunity.id,
      strategy: 'Cruce creado por la usuaria desde la matriz DOFA.',
      weighting: null,
    }
    const { aiService, sent } = await consult([findingFor([f.strength.id, f.opportunity.id], { category: 'MISSING_CROSSES' })], [userCross])
    expect(sent.status).toBe(201)
    const context = (aiService.consultChecky as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { crosses: Array<{ id: string }> }
    expect(context.crosses.map((cross) => cross.id)).toContain(userCross.id)
  })

  it('la sugerencia heredada que solo cita un cruce se lee con sus dos factores', async () => {
    const cross: SeededCross = {
      id: 'cmcrosslegacyevidence01',
      crossType: 'FO',
      origin: 'USER',
      factor1Id: f.strength.id,
      factor2Id: f.opportunity.id,
      strategy: 'Cruce heredado citado solo por id en una sugerencia antigua.',
      weighting: null,
    }
    const db = makeDb('SUPERUSER', member.id, null, company.id, [], [cross])
    const agent = request.agent(createApp(db, readOnlyAI()))
    await login(agent)
    const legacyId = await seedLegacySuggestion(db, { evidenceIds: [cross.id] })

    const read = await agent.get(`/api/checky/sessions/${checkySessionFixture.id}`)
    const stored = read.body.messages.find((message: { id: string }) => message.id === legacyId)
    expect(stored).toBeDefined()
    expect(stored.evidenceIds).toEqual(expect.arrayContaining([cross.id, f.strength.id, f.opportunity.id]))
  })

  it('resuelve la pareja de una estrategia que cita un cruce por su id', async () => {
    const cross: SeededCross = {
      id: 'cmcrossporresolver00001',
      crossType: 'FO',
      origin: 'AI',
      factor1Id: f.strength.id,
      factor2Id: f.opportunity.id,
      strategy: 'Cruce existente que Checky cita como evidencia.',
      weighting: null,
    }
    const { agent, sent } = await consult([findingFor([cross.id])], [cross])
    expect(sent.status).toBe(201)
    expect(sent.body.suggestions).toHaveLength(1)

    const decision = await agent.patch(`/api/checky/sessions/${checkySessionFixture.id}/messages/${sent.body.suggestions[0].id}`).send({ status: 'ACCEPTED' })
    expect(decision.status).toBe(200)

    const listed = await agent.get(`/api/diagnostics/${diagnostic.id}/strategies?acceptedOnly=true`)
    expect(listed.body.strategies).toHaveLength(1)
    expect(listed.body.strategies[0]).toMatchObject({ source: 'CHECKY', description: strategy.description })
    expect(listed.body.strategies[0].factor1).toMatchObject({ id: f.strength.id, type: 'STRENGTH' })
    expect(listed.body.strategies[0].factor2).toMatchObject({ id: f.opportunity.id, type: 'OPPORTUNITY' })
  })

  it('conserva el hallazgo informativo sin pareja, porque no es una estrategia', async () => {
    const { sent } = await consult([{
      category: 'REVIEW_ASPECTS',
      title: 'Sin amenazas registradas',
      detail: 'La matriz no registra amenazas, así que el riesgo todavía no se puede evaluar.',
      basis: 'FACT',
      evidenceIds: [],
      suggestedStrategy: null,
    }])
    expect(sent.body.suggestions).toHaveLength(1)
  })

  it('rechaza aceptar una sugerencia heredada que no tiene pareja DOFA válida', async () => {
    const db = makeDb()
    const agent = request.agent(createApp(db, readOnlyAI()))
    await login(agent)
    const legacyId = await seedLegacySuggestion(db, { category: 'STRENGTHEN_STRATEGIES', status: 'PENDING' })

    const accepted = await agent.patch(`/api/checky/sessions/${checkySessionFixture.id}/messages/${legacyId}`).send({ status: 'ACCEPTED' })
    expect(accepted.status).toBe(400)
    expect(accepted.body.error).toBe('This suggestion does not reference a valid DOFA cross (FO, FA, DO or DA)')

    // Rechazar sigue permitido: no crea estrategia.
    const rejected = await agent.patch(`/api/checky/sessions/${checkySessionFixture.id}/messages/${legacyId}`).send({ status: 'REJECTED' })
    expect(rejected.status).toBe(200)
    expect(rejected.body.message.status).toBe('REJECTED')
  })
})
