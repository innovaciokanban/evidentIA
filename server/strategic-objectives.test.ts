/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'
import { strategySourceRef } from './strategy-weighting-service.js'
import request from './test-request.js'

const companyId = 'cmobjectivecompany000000001'
const otherCompanyId = 'cmobjectivecompany000000002'
const diagnosticId = 'cmdiagnosticobjective000001'
const otherDiagnosticId = 'cmdiagnosticobjective000002'
const adminId = 'cmobjectiveadmin0000000001'
const userId = 'cmobjectiveuser0000000001'
const objectiveId = 'cmobjective000000000000001'
const crossId = 'cmobjectivecross0000000001'
const token = 'strategic-objectives-test-token'

const admin = { id: adminId, email: 'admin@objectives.test', name: 'Objectives Admin', role: 'COMPANY_ADMIN' as Role, companyId, isActive: true }
const companyUser = { id: userId, email: 'user@objectives.test', name: 'Objectives User', role: 'COMPANY_USER' as Role, companyId, isActive: true }
const diagnostic = { id: diagnosticId, companyId, company: { id: companyId } }
const otherDiagnostic = { id: otherDiagnosticId, companyId: otherCompanyId, company: { id: otherCompanyId } }
const strategyDescription = 'Acelerar la digitalización de la operación'
const strategyRef = strategySourceRef(strategyDescription)

const completeObjective = {
  title: 'Aumentar la eficiencia operativa',
  statement: 'Aumentar la eficiencia operativa en la empresa',
  specificCriteria: 'En el proceso comercial',
  measurableCriteria: 'Reducir el tiempo de respuesta en 20%',
  achievableCriteria: 'Con automatización y capacitación del equipo',
  relevantCriteria: 'Para mejorar la experiencia del cliente',
  timeBoundCriteria: 'Durante el segundo semestre de 2026',
  indicator: {
    name: 'Tiempo promedio de respuesta',
    unit: 'horas',
    baselineValue: '48',
    targetValue: '38',
    measurementMethod: 'Reporte mensual del CRM',
    deadline: '2026-12-31',
  },
}

const makeDatabase = (role: Role = admin.role) => {
  const users = new Map([[admin.id, { ...admin, role }], [userId, companyUser]])
  const objectives = new Map<string, any>()
  const histories: any[] = []
  const links: any[] = []
  let nextHistoryId = 1

  const hydrate = (id: string) => {
    const objective = objectives.get(id)
    if (!objective) return null
    return {
      ...objective,
      createdBy: { id: admin.id, name: admin.name, email: admin.email },
      indicator: objective.indicator ?? null,
      strategyLinks: links.filter((link) => link.objectiveId === id).map((link) => ({
        ...link,
        linkedBy: { id: admin.id, name: admin.name, email: admin.email },
      })),
      diagnostic: objective.diagnostic ?? diagnostic,
    }
  }

  const database: any = {
    $transaction: async (operation: (client: typeof database) => Promise<unknown>) => operation(database),
    session: {
      findUnique: async () => ({ id: 'cmsessionobjective00000001', expiresAt: new Date(Date.now() + 60_000), user: users.get(admin.id) }),
    },
    user: {
      findUnique: async ({ where: { id } }: any) => users.get(id) ?? null,
    },
    qualityDiagnostic: {
      findUnique: async ({ where: { id } }: any) => id === diagnosticId ? diagnostic : id === otherDiagnosticId ? otherDiagnostic : null,
    },
    strategicObjective: {
      findMany: async ({ where: { diagnosticId: requestedDiagnosticId } }: any) => [...objectives.values()].filter((objective) => objective.diagnosticId === requestedDiagnosticId).map((objective) => hydrate(objective.id)),
      findUnique: async ({ where: { id } }: any) => hydrate(id),
      create: async ({ data }: any) => {
        const now = new Date()
        const created = { id: objectiveId, diagnosticId: data.diagnosticId, title: data.title, statement: data.statement, specificCriteria: data.specificCriteria, measurableCriteria: data.measurableCriteria, achievableCriteria: data.achievableCriteria, relevantCriteria: data.relevantCriteria, timeBoundCriteria: data.timeBoundCriteria, status: 'DRAFT', origin: data.origin, createdById: data.createdById, createdAt: now, updatedAt: now, indicator: data.indicator?.create ? { id: 'cmobjectiveindicator000001', objectiveId, ...data.indicator.create, deadline: new Date(data.indicator.create.deadline) } : null, diagnostic }
        objectives.set(created.id, created)
        return hydrate(created.id)
      },
      update: async ({ where: { id }, data }: any) => {
        const objective = objectives.get(id)
        Object.assign(objective, data, { updatedAt: new Date() })
        return hydrate(id)
      },
      delete: async ({ where: { id } }: any) => {
        objectives.delete(id)
        return null
      },
    },
    strategicObjectiveIndicator: {
      create: async ({ data }: any) => {
        const objective = objectives.get(data.objectiveId)
        objective.indicator = { id: 'cmobjectiveindicator000001', ...data, deadline: new Date(data.deadline) }
        return objective.indicator
      },
      update: async ({ where: { objectiveId: id }, data }: any) => {
        const objective = objectives.get(id)
        objective.indicator = { ...objective.indicator, ...data, deadline: new Date(data.deadline) }
        return objective.indicator
      },
      delete: async ({ where: { objectiveId: id } }: any) => {
        objectives.get(id).indicator = null
        return null
      },
    },
    strategicObjectiveStrategy: {
      create: async ({ data }: any) => {
        const link = { id: `cmlink${links.length + 1}`, ...data }
        links.push(link)
        return link
      },
      delete: async ({ where: { id } }: any) => {
        const index = links.findIndex((link) => link.id === id)
        if (index >= 0) links.splice(index, 1)
        return null
      },
    },
    strategicObjectiveHistory: {
      create: async ({ data }: any) => {
        const event = { id: `cmobjectivehistory${String(nextHistoryId++).padStart(4, '0')}`, ...data, occurredAt: new Date(), actor: data.actorId ? { id: data.actorId, name: admin.name } : null }
        histories.push(event)
        return event
      },
      count: async ({ where }: any) => histories.filter((event) => event.objectiveId === where.objectiveId && (!where.eventType || event.eventType === where.eventType)).length,
      findMany: async ({ where }: any) => histories.filter((event) => event.objectiveId === where.objectiveId && (!where.eventType || event.eventType === where.eventType)).reverse(),
    },
    aIAnalysis: { findUnique: async () => null },
    checkyMessage: { findMany: async () => [] },
    strategyWeighting: { findMany: async () => [] },
    actionPlan: { findMany: async () => [] },
    strategicCross: {
      findMany: async () => [{
        id: crossId,
        crossType: 'FO',
        origin: 'USER',
        factor1Id: 'factor-strength',
        factor2Id: 'factor-opportunity',
        factor1: { id: 'factor-strength', type: 'STRENGTH', description: 'Equipo preparado' },
        factor2: { id: 'factor-opportunity', type: 'OPPORTUNITY', description: 'Mercado digital' },
        strategy: strategyDescription,
        strategyStatus: 'ACCEPTED',
        weighting: { id: 'weighting-objective', crossId, impactoEstrategico: 'ALTO', viabilidad: 'ALTO', urgencia: 'MEDIO', sinergiaInterna: 'ALTO', impactoReputacional: 'MEDIO', weightedScore: 4.2 },
      }],
    },
    sWOTItem: { findMany: async () => [] },
  }

  return database as unknown as PrismaClient
}

const appFor = (role: Role = admin.role) => createApp(makeDatabase(role), undefined as never, {
  kind: 'LOCAL',
  ensureAuditFolder: async () => null,
  upload: async () => ({ storedName: null, driveFileId: null, driveUrl: null }),
  read: async () => Buffer.from(''),
  remove: async () => undefined,
} as any)

const auth = { Authorization: `Bearer ${token}` }

describe('strategic objective API', () => {
  it('creates drafts, enforces SMART completion, approves and exposes append-only history', async () => {
    const app = appFor()
    const created = await request(app).post(`/api/diagnostics/${diagnosticId}/strategic-objectives`).set(auth).send({ title: 'Objetivo incompleto', statement: 'Declaración inicial' })
    expect(created.status).toBe(201)
    expect(created.body.objective.status).toBe('DRAFT')

    const incompleteApproval = await request(app).post(`/api/strategic-objectives/${objectiveId}/approve`).set(auth).send({})
    expect(incompleteApproval.status).toBe(400)
    expect(incompleteApproval.body.missingFields).toContain('specificCriteria')

    const updated = await request(app).patch(`/api/strategic-objectives/${objectiveId}`).set(auth).send(completeObjective)
    expect(updated.status).toBe(200)
    expect(updated.body.objective.indicator.targetValue).toBe('38')

    const approved = await request(app).post(`/api/strategic-objectives/${objectiveId}/approve`).set(auth).send({})
    expect(approved.status).toBe(200)
    expect(approved.body.objective.status).toBe('APPROVED')

    const invalidApprovedUpdate = await request(app).patch(`/api/strategic-objectives/${objectiveId}`).set(auth).send({ indicator: null })
    expect(invalidApprovedUpdate.status).toBe(400)

    const history = await request(app).get(`/api/diagnostics/${diagnosticId}/strategic-objectives/${objectiveId}/history`).set(auth)
    expect(history.status).toBe(200)
    expect(history.body.total).toBe(3)
    expect(history.body.events.map((event: { eventType: string }) => event.eventType)).toEqual(['STATUS_CHANGED', 'UPDATED', 'CREATED'])
    expect(history.body.events[1].changes).toContainEqual({ field: 'title', label: 'Título', previousValue: 'Objetivo incompleto', newValue: 'Aumentar la eficiencia operativa' })
  })

  it('links only accepted weighted strategies, records link history and isolates diagnostics', async () => {
    const app = appFor()
    const created = await request(app).post(`/api/diagnostics/${diagnosticId}/strategic-objectives`).set(auth).send({ title: 'Objetivo', statement: 'Declaración' })
    expect(created.status).toBe(201)

    const link = await request(app).post(`/api/strategic-objectives/${objectiveId}/strategies`).set(auth).send({ source: 'STRATEGIC_CROSS', sourceRef: strategyRef })
    expect(link.status).toBe(201)
    expect(link.body.objective.strategies[0]).toMatchObject({ source: 'STRATEGIC_CROSS', sourceRef: strategyRef, weightedScore: 4.2 })

    const otherDiagnosticList = await request(app).get(`/api/diagnostics/${otherDiagnosticId}/strategic-objectives`).set(auth)
    expect(otherDiagnosticList.status).toBe(404)

    const unlink = await request(app).delete(`/api/strategic-objectives/${objectiveId}/strategies/STRATEGIC_CROSS/${strategyRef}`).set(auth)
    expect(unlink.status).toBe(200)
    expect(unlink.body.objective.strategies).toHaveLength(0)

    const history = await request(app).get(`/api/diagnostics/${diagnosticId}/strategic-objectives/${objectiveId}/history`).set(auth)
    expect(history.body.events.map((event: { eventType: string }) => event.eventType)).toEqual(['STRATEGY_UNLINKED', 'STRATEGY_LINKED', 'CREATED'])
  })

  it('rejects writes from users without administrative role', async () => {
    const app = appFor('COMPANY_USER' as Role)
    const response = await request(app).post(`/api/diagnostics/${diagnosticId}/strategic-objectives`).set(auth).send({ title: 'No permitido', statement: 'No permitido' })
    expect(response.status).toBe(403)
  })
})
