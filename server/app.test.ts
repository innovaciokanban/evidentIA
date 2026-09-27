import bcrypt from 'bcryptjs'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'
import { envSchema } from './env.js'
import { AIService, AIServiceError } from './ai-service.js'
import { dashboardScopesFor } from './dashboard-service.js'
import { aiAnalysisSchema, buildCheckyConsultSchema, companyCreateSchema, companyUpdateSchema, crossWeightingSchema, diagnosticCreateSchema, diagnosticUpdateSchema, loginSchema, swotItemCreateSchema, swotItemUpdateSchema, ticketCreateSchema, ticketUpdateSchema } from './validation.js'

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
const diagnostic = {
  id: 'cmdiagnostic000000000000001', companyId: company.id, title: 'Diagnóstico inicial', description: 'Revisión general de la operación', status: 'DRAFT' as const, createdById: member.id,
  createdAt: new Date('2026-01-03'), updatedAt: new Date('2026-01-03'), company: { id: company.id, name: company.name }, createdBy: member,
  swotAnalysis: { id: 'cmswot000000000000000001', diagnosticId: 'cmdiagnostic000000000000001', createdAt: new Date('2026-01-03'), updatedAt: new Date('2026-01-03'), items: [] },
}
const swotItem = { id: 'cmswotitem0000000000000001', swotId: diagnostic.swotAnalysis.id, type: 'STRENGTH' as const, description: 'Equipo comprometido', priority: 'HIGH' as const, impact: 'HIGH' as const, createdAt: new Date('2026-01-04') }
const aiResult = {
  executiveSummary: 'La empresa cuenta con capacidades internas sólidas y oportunidades de mejora.',
  diagnosis: 'La información indica una operación con fortalezas aprovechables.',
  keyFindings: [{ finding: 'Equipo comprometido', basis: 'FACT' as const }],
  foStrategies: ['Usar el compromiso del equipo para capturar oportunidades.'],
  doStrategies: ['Mejorar procesos para aprovechar oportunidades.'],
  faStrategies: ['Apoyarse en el equipo para mitigar amenazas.'],
  daStrategies: ['Reducir debilidades frente a amenazas identificadas.'],
  priorityRisks: ['Dependencia de procesos manuales.'],
  priorityOpportunities: ['Mejora de la operación.'],
  recommendations: [{ title: 'Priorizar procesos', description: 'Documentar el proceso principal.', priority: 'HIGH' as const, expectedImpact: 'Mayor consistencia operativa.', suggestedAction: 'Definir responsables y fechas.' }],
}
const persistedAIAnalysis = { id: 'cmaianalysis000000000000001', diagnosticId: diagnostic.id, ...aiResult, createdAt: new Date('2026-01-05'), updatedAt: new Date('2026-01-05') }
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

function makeDb(role: Role = 'SUPERUSER', ticketOwnerId = member.id, ticketAssigneeId: string | null = null, userCompanyId: string | null = company.id, existingRecommendations: typeof recommendation[] = []) {
  const currentUser = role === 'SUPERUSER' ? admin : { ...member, role, companyId: userCompanyId }
  const passwordHash = bcrypt.hashSync('Password123!', 4)
  const users = [admin, member, companyUser, otherCompanyUser]
  let sessionActive = false
  let storedRecommendations: typeof recommendation[] = existingRecommendations
  type StoredTicket = { id: string; title: string; description: string; status: string; priority: string; createdById: string; assignedToId: string | null; actionItemId: string | null; dueDate: Date | null }
  let storedTickets: StoredTicket[] = []
  let storedCheckyMessages: typeof checkyMessageFixture[] = []
  let storedCrossWeightings: typeof crossWeightingFixture[] = []
  const ownSwotItem = (item: { id: string; type: string; description: string }) => ({ ...item, swotId: diagnostic.swotAnalysis.id, createdAt: new Date('2026-01-04'), swot: { diagnosticId: diagnostic.id } })
  const storedSwotItems = [
    ownSwotItem(checkySwotItemFixtures.strength),
    ownSwotItem(checkySwotItemFixtures.opportunity),
    ownSwotItem(checkySwotItemFixtures.sameQuadrant),
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
        return storedSwotItems.filter((item) => wanted.includes(item.id) && (diagnosticId ? item.swot.diagnosticId === diagnosticId : true))
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
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: { crossType: string; factor1Id: string; factor2Id: string; strategy: string | null } }) => ({
        ...strategicCrossFixture,
        crossType: data.crossType as 'FO',
        factor1Id: data.factor1Id,
        factor2Id: data.factor2Id,
        strategy: data.strategy,
        factor1: { id: data.factor1Id, swotId: diagnostic.swotAnalysis.id, type: 'STRENGTH' as const, description: 'Equipo comprometido', createdAt: new Date('2026-01-04') },
        factor2: { id: data.factor2Id, swotId: diagnostic.swotAnalysis.id, type: 'OPPORTUNITY' as const, description: 'Nuevo mercado', createdAt: new Date('2026-01-04') },
      })),
      update: vi.fn(async () => ({
        ...strategicCrossFixture,
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
    checkySession: {
      create: vi.fn(async ({ data }: { data: { diagnosticId: string; title: string | null; createdById: string } }) => ({ ...checkySessionFixture, diagnosticId: data.diagnosticId, title: data.title, createdById: data.createdById })),
      findMany: vi.fn(async () => [checkySessionFixture]),
      findUnique: vi.fn(async () => ({ ...checkySessionFixture, diagnostic: { companyId: company.id, company: { id: company.id, name: company.name } } })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...checkySessionFixture, ...data })),
    },
    checkyMessage: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { ...checkyMessageFixture, ...data, id: `cmcheckymsg${String(storedCheckyMessages.length + 1).padStart(12, '0')}`, createdAt: new Date(Date.now() + storedCheckyMessages.length) }
        storedCheckyMessages = [...storedCheckyMessages, created]
        return created
      }),
      findMany: vi.fn(async () => storedCheckyMessages),
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
    expect(aiAnalysisSchema.safeParse(aiResult).success).toBe(true)
    expect(aiAnalysisSchema.safeParse({ ...aiResult, recommendations: [{ title: 'invalid' }] }).success).toBe(false)
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
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401])
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

  it('builds the Checky context from the diagnostic, factors, crosses, analysis and recommendations', async () => {
    const db = makeDb()
    const findDiag = db.qualityDiagnostic.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }
    findDiag.mockResolvedValue({ ...diagnostic, company: { ...diagnostic.company }, swotAnalysis: { ...diagnostic.swotAnalysis, items: [
      { id: checkyFactorIds.strength, swotId: diagnostic.swotAnalysis.id, type: 'STRENGTH', description: 'Equipo comprometido', createdAt: new Date('2026-01-04') },
      { id: checkyFactorIds.opportunity, swotId: diagnostic.swotAnalysis.id, type: 'OPPORTUNITY', description: 'Mercado en expansión', createdAt: new Date('2026-01-04') },
    ] } })
    const findCrosses = db.strategicCross.findMany as unknown as { mockResolvedValue: (value: unknown) => unknown }
    findCrosses.mockResolvedValue([{ ...strategicCrossFixture, factor1Id: checkyFactorIds.strength, factor2Id: checkyFactorIds.opportunity, origin: 'AI' }])
    const aiService = { consultChecky: vi.fn(async () => checkyConsultResult) } as unknown as AIService
    const agent = request.agent(createApp(db, aiService))
    await agent.post('/api/auth/login').send({ email: admin.email, password: 'Password123!' })
    await agent.post(`/api/checky/sessions/${checkySessionFixture.id}/messages`).send({ content: 'Revisa el diagnóstico' })
    const context = (aiService.consultChecky as unknown as { mock: { calls: [{ question: string; swotItems: unknown[]; crosses: unknown[]; aiAnalysis: unknown; recommendations: unknown }][] } }).mock.calls[0][0]
    expect(context.question).toBe('Revisa el diagnóstico')
    expect(context.swotItems).toEqual([
      { id: checkyFactorIds.strength, type: 'STRENGTH', description: 'Equipo comprometido' },
      { id: checkyFactorIds.opportunity, type: 'OPPORTUNITY', description: 'Mercado en expansión' },
    ])
    expect(context.crosses).toEqual([{ id: strategicCrossFixture.id, crossType: 'FO', origin: 'AI', factor1Id: checkyFactorIds.strength, factor2Id: checkyFactorIds.opportunity, strategy: strategicCrossFixture.strategy }])
    expect(context.aiAnalysis).toEqual({ executiveSummary: persistedAIAnalysis.executiveSummary, keyFindings: persistedAIAnalysis.keyFindings, priorityRisks: persistedAIAnalysis.priorityRisks, priorityOpportunities: persistedAIAnalysis.priorityOpportunities })
    expect(context.recommendations).toEqual([])
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

    it('refuses to duplicate a pair that already has a strategic cross', async () => {
      const db = makeDb()
      const agent = await loginAgent(db)
      const findCross = db.strategicCross.findUnique as unknown as { mockResolvedValue: (value: unknown) => unknown }
      findCross.mockResolvedValue({ ...strategicCrossFixture, factor1Id: checkyFactorIds.strength, factor2Id: checkyFactorIds.opportunity })
      const suggestionId = await seedSuggestion(db)

      const response = await agent.post(`/api/checky/suggestions/${suggestionId}/accept`)
      expect(response.status).toBe(409)
      expect(response.body.error).toBe('A strategic cross between these factors already exists')
      expect(db.strategicCross.create).not.toHaveBeenCalled()
      const read = await agent.get(`/api/checky/sessions/${checkySessionFixture.id}`)
      expect(read.body.messages.find((message: { id: string }) => message.id === suggestionId).status).toBe('PENDING')
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
