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
const processId = 'cmobjectiveprocess00000001'
const foreignProcessId = 'cmobjectiveprocess00000002'
const kpiId = 'cmobjectivekpi000000000001'
const foreignKpiId = 'cmobjectivekpi000000000002'
const token = 'strategic-objectives-test-token'

const admin = { id: adminId, email: 'admin@objectives.test', name: 'Objectives Admin', role: 'COMPANY_ADMIN' as Role, companyId, isActive: true }
const companyUser = { id: userId, email: 'user@objectives.test', name: 'Objectives User', role: 'COMPANY_USER' as Role, companyId, isActive: true }
const diagnostic = { id: diagnosticId, companyId, company: { id: companyId } }
const otherDiagnostic = { id: otherDiagnosticId, companyId: otherCompanyId, company: { id: otherCompanyId } }
const process = { id: processId, companyId, name: 'Gestión Comercial', code: 'PROC-01', type: 'MISSIONAL', version: '1.0', frequency: null, organizationalArea: null, supervision: null, executionType: null, objective: 'Gestionar ventas', description: null, status: 'ACTIVE', thirdPartyProvided: false, critical: false, affectsAccounting: false, personalData: false, responsible: null, createdAt: new Date(), updatedAt: new Date(), company: { id: companyId } }
const foreignProcess = { ...process, id: foreignProcessId, companyId: otherCompanyId, name: 'Proceso extranjero', code: 'PROC-99', company: { id: otherCompanyId } }
const kpi = { id: kpiId, processId, name: 'Cumplimiento comercial', description: 'KPI propio de la empresa', frequency: 'Mensual', target: '95%', formula: 'Entregas a tiempo / total', dataSource: 'CRM', unit: 'Porcentaje', reportResponsible: null, monitorResponsible: null, greenThreshold: null, yellowThreshold: null, redThreshold: null, createdAt: new Date(), updatedAt: new Date(), process }
const foreignKpi = { ...kpi, id: foreignKpiId, processId: foreignProcessId, name: 'KPI extranjero', process: foreignProcess }
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
    description: 'Tiempo promedio desde la solicitud hasta la respuesta.',
    frequency: 'Mensual',
    formula: 'Suma de horas de respuesta / solicitudes atendidas',
    dataSource: 'CRM comercial',
    unit: 'horas',
    baselineValue: '48',
    targetValue: '38',
    measurementMethod: 'Reporte mensual del CRM',
    deadline: '2026-12-31',
  },
}

const makeDatabase = (role: Role = admin.role, options: { failHistory?: boolean } = {}) => {
  const users = new Map([[admin.id, { ...admin, role }], [userId, companyUser]])
  const objectives = new Map<string, any>()
  const histories: any[] = []
  const links: any[] = []
  const kpis = new Map([[kpi.id, kpi], [foreignKpi.id, foreignKpi]])
  const processKpiLinks: any[] = [{ processId, kpiId, kpi }]
  let nextHistoryId = 1

  const hydrate = (id: string) => {
    const objective = objectives.get(id)
    if (!objective) return null
    return {
      ...objective,
      createdBy: { id: admin.id, name: admin.name, email: admin.email },
      indicators: objective.indicators ?? (objective.indicator ? [objective.indicator] : []),
      indicator: objective.indicators?.[0] ?? objective.indicator ?? null,
      strategyLinks: links.filter((link) => link.objectiveId === id).map((link) => ({
        ...link,
        linkedBy: { id: admin.id, name: admin.name, email: admin.email },
      })),
      diagnostic: objective.diagnostic ?? diagnostic,
    }
  }

  const database: any = {
    $transaction: async (operation: (client: typeof database) => Promise<unknown>) => {
      const objectiveSnapshot = new Map([...objectives.entries()].map(([id, value]) => [id, { ...value, indicators: (value.indicators ?? []).map((indicator: any) => ({ ...indicator })), indicator: value.indicator ? { ...value.indicator } : null }]))
      const historySnapshot = [...histories]
      const linkSnapshot = [...links]
      try {
        return await operation(database)
      } catch (error) {
        objectives.clear()
        for (const [id, value] of objectiveSnapshot) objectives.set(id, value)
        histories.splice(0, histories.length, ...historySnapshot)
        links.splice(0, links.length, ...linkSnapshot)
        throw error
      }
    },
    session: {
      findUnique: async () => ({ id: 'cmsessionobjective00000001', expiresAt: new Date(Date.now() + 60_000), user: users.get(admin.id) }),
    },
    user: {
      findUnique: async ({ where: { id } }: any) => users.get(id) ?? null,
    },
    qualityDiagnostic: {
      findUnique: async ({ where: { id } }: any) => id === diagnosticId ? diagnostic : id === otherDiagnosticId ? otherDiagnostic : null,
    },
    process: {
      findUnique: async ({ where: { id } }: any) => id === processId ? process : id === foreignProcessId ? foreignProcess : null,
      findMany: async ({ where }: any) => [process, foreignProcess].filter((item) => !where?.companyId || item.companyId === where.companyId),
    },
    kpi: {
      findMany: async ({ where }: any) => [...kpis.values()].filter((item) => !where?.process?.companyId || item.process.companyId === where.process.companyId),
      findUnique: async ({ where: { id } }: any) => kpis.get(id) ?? null,
      create: async ({ data }: any) => {
        const created = { ...kpi, ...data, id: 'cmobjectivekpi000000000003', processId: data.processId, process: data.processId === processId ? process : foreignProcess, createdAt: new Date(), updatedAt: new Date() }
        kpis.set(created.id, created)
        return created
      },
      delete: async ({ where: { id } }: any) => {
        kpis.delete(id)
        for (const objective of objectives.values()) {
          if (objective.indicator?.kpiId === id) objective.indicator.kpiId = null
        }
        return { id }
      },
    },
    processKpi: {
      findMany: async ({ where }: any) => processKpiLinks.filter((link) => (!where?.processId || link.processId === where.processId) && (!where?.kpiId || link.kpiId === where.kpiId)),
      findUnique: async ({ where: { processId_kpiId: { processId: requestedProcessId, kpiId: requestedKpiId } } }: any) => processKpiLinks.find((link) => link.processId === requestedProcessId && link.kpiId === requestedKpiId) ?? null,
      create: async ({ data }: any) => {
        const link = { ...data, kpi: kpis.get(data.kpiId) }
        processKpiLinks.push(link)
        return link
      },
      delete: async ({ where: { processId: requestedProcessId, kpiId: requestedKpiId } }: any) => {
        const index = processKpiLinks.findIndex((link) => link.processId === requestedProcessId && link.kpiId === requestedKpiId)
        if (index >= 0) processKpiLinks.splice(index, 1)
        return { processId: requestedProcessId, kpiId: requestedKpiId }
      },
    },
    strategicObjective: {
      findMany: async ({ where: { diagnosticId: requestedDiagnosticId } }: any) => [...objectives.values()].filter((objective) => objective.diagnosticId === requestedDiagnosticId).map((objective) => hydrate(objective.id)),
      findUnique: async ({ where: { id } }: any) => hydrate(id),
      create: async ({ data }: any) => {
        const now = new Date()
        const indicatorData = data.indicators?.create ?? (data.indicator?.create ? [data.indicator.create] : [])
        const indicators = indicatorData.map((item: any, index: number) => ({ id: `cmobjectiveindicator00000${index + 1}`, objectiveId, ...item, deadline: item.deadline ? new Date(item.deadline) : null }))
        const created = { id: objectiveId, diagnosticId: data.diagnosticId, title: data.title, statement: data.statement, specificCriteria: data.specificCriteria, measurableCriteria: data.measurableCriteria, achievableCriteria: data.achievableCriteria, relevantCriteria: data.relevantCriteria, timeBoundCriteria: data.timeBoundCriteria, status: 'DRAFT', origin: data.origin, createdById: data.createdById, createdAt: now, updatedAt: now, indicators, indicator: indicators[0] ?? null, diagnostic }
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
        const indicator = { id: `cmobjectiveindicator${Date.now()}`, ...data, deadline: data.deadline ? new Date(data.deadline) : null }
        objective.indicators = [...(objective.indicators ?? []), indicator]
        objective.indicator = objective.indicators[0] ?? null
        return indicator
      },
      update: async ({ where, data }: any) => {
        const objective = where.id ? [...objectives.values()].find((item) => item.indicators?.some((indicator: any) => indicator.id === where.id)) : objectives.get(where.objectiveId)
        const indicator = where.id ? objective?.indicators.find((item: any) => item.id === where.id) : objective?.indicators?.[0]
        Object.assign(indicator, data, { deadline: data.deadline ? new Date(data.deadline) : null })
        objective.indicator = objective.indicators[0] ?? null
        return indicator
      },
      delete: async ({ where }: any) => {
        const objective = where.id ? [...objectives.values()].find((item) => item.indicators?.some((indicator: any) => indicator.id === where.id)) : objectives.get(where.objectiveId)
        const id = where.id ?? objective?.indicators?.[0]?.id
        objective.indicators = (objective.indicators ?? []).filter((indicator: any) => indicator.id !== id)
        objective.indicator = objective.indicators[0] ?? null
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
        if (options.failHistory) throw new Error('Simulated history failure')
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

const appFor = (role: Role = admin.role, options: { failHistory?: boolean } = {}) => createApp(makeDatabase(role, options), undefined as never, {
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

  it('keeps the process KPI catalog separate from SMART indicators', async () => {
    const app = appFor()
    const ownList = await request(app).get(`/api/diagnostics/${diagnosticId}/process-kpis`).set(auth)
    expect(ownList.status).toBe(200)
    expect(ownList.body.kpis.map((item: { id: string }) => item.id)).toEqual([kpiId])
    expect(ownList.body.processes.map((item: { id: string }) => item.id)).toEqual([processId])

    const foreignList = await request(app).get(`/api/diagnostics/${otherDiagnosticId}/process-kpis`).set(auth)
    expect(foreignList.status).toBe(404)

    const legacyAssociation = await request(app).post(`/api/diagnostics/${diagnosticId}/strategic-objectives`).set(auth).send({ ...completeObjective, indicator: { ...completeObjective.indicator, kpiId: foreignKpiId } })
    expect(legacyAssociation.status).toBe(400)
    expect((await request(app).get(`/api/diagnostics/${diagnosticId}/strategic-objectives`).set(auth)).body.objectives).toHaveLength(0)
  })

  it('creates, edits and reloads an objective with an independent indicator', async () => {
    const app = appFor()
    const created = await request(app).post(`/api/diagnostics/${diagnosticId}/strategic-objectives`).set(auth).send(completeObjective)
    expect(created.status).toBe(201)
    expect(created.body.objective.indicator).toMatchObject({ name: completeObjective.indicator.name })
    expect(created.body.objective.indicator).not.toHaveProperty('kpiId')

    const reloaded = await request(app).get(`/api/strategic-objectives/${objectiveId}`).set(auth)
    expect(reloaded.status).toBe(200)
    expect(reloaded.body.objective.indicator).not.toHaveProperty('kpiId')

    const edited = await request(app).patch(`/api/strategic-objectives/${objectiveId}`).set(auth).send({ title: 'Objetivo editado' })
    expect(edited.status).toBe(200)
    expect(edited.body.objective.indicator).not.toHaveProperty('kpiId')
  })

  it('creates and edits the full SMART indicator through its independent endpoint', async () => {
    const app = appFor()
    const created = await request(app).post(`/api/diagnostics/${diagnosticId}/strategic-objectives`).set(auth).send({ title: 'Objetivo con indicador', statement: 'Declaración del objetivo' })
    expect(created.status).toBe(201)

    const indicator = {
      name: 'Cumplimiento operativo',
      description: 'Mide el cumplimiento mensual del equipo.',
      frequency: 'Mensual',
      targetValue: '95%',
      formula: 'Casos cumplidos / casos totales',
      dataSource: 'Sistema operativo',
      unit: 'Porcentaje',
      reportResponsibleId: userId,
      monitorResponsibleId: adminId,
      greenThreshold: '>= 95%',
      yellowThreshold: '80% - 94%',
      redThreshold: '< 80%',
      baselineValue: '82%',
      measurementMethod: 'Corte mensual',
      deadline: '2026-12-31',
    }
    const saved = await request(app).put(`/api/strategic-objectives/${objectiveId}/indicator`).set(auth).send(indicator)
    expect(saved.status).toBe(200)
    expect(saved.body.objective.indicator).toMatchObject({ ...indicator, deadline: expect.any(String) })
    expect(saved.body.objective.indicator).not.toHaveProperty('kpiId')

    const invalidResponsible = await request(app).put(`/api/strategic-objectives/${objectiveId}/indicator`).set(auth).send({ ...indicator, reportResponsibleId: 'cmforeignresponsible000001' })
    expect(invalidResponsible.status).toBe(400)
    const reloaded = await request(app).get(`/api/strategic-objectives/${objectiveId}`).set(auth)
    expect(reloaded.body.objective.indicator).toMatchObject({ name: indicator.name, frequency: indicator.frequency, formula: indicator.formula, redThreshold: indicator.redThreshold })
  })

  it('creates, edits and deletes multiple independent indicators without touching siblings', async () => {
    const app = appFor()
    const indicators = [
      completeObjective.indicator,
      { ...completeObjective.indicator, name: 'Calidad de registros', targetValue: '98%' },
      { ...completeObjective.indicator, name: 'Cobertura de seguimiento', targetValue: '100%' },
    ]
    const created = await request(app).post(`/api/diagnostics/${diagnosticId}/strategic-objectives`).set(auth).send({ title: 'Objetivo con tres indicadores', statement: 'Declaración del objetivo', indicators })
    expect(created.status).toBe(201)
    expect(created.body.objective.indicators).toHaveLength(3)
    expect(new Set(created.body.objective.indicators.map((indicator: { id: string }) => indicator.id)).size).toBe(3)

    const [first, second, third] = created.body.objective.indicators
    const edited = await request(app).put(`/api/strategic-objectives/${objectiveId}/indicators/${second.id}`).set(auth).send({ ...indicators[1], targetValue: '99%' })
    expect(edited.status).toBe(200)
    expect(edited.body.objective.indicators).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, targetValue: indicators[0].targetValue }),
      expect.objectContaining({ id: second.id, targetValue: '99%' }),
      expect.objectContaining({ id: third.id, targetValue: indicators[2].targetValue }),
    ]))

    const deleted = await request(app).delete(`/api/strategic-objectives/${objectiveId}/indicators/${second.id}`).set(auth)
    expect(deleted.status).toBe(200)
    expect(deleted.body.objective.indicators.map((indicator: { id: string }) => indicator.id)).toEqual([first.id, third.id])
    const reloaded = await request(app).get(`/api/strategic-objectives/${objectiveId}`).set(auth)
    expect(reloaded.body.objective.indicators.map((indicator: { id: string }) => indicator.id)).toEqual([first.id, third.id])
  })

  it('keeps an independent SMART indicator when a process KPI changes', async () => {
    const app = appFor()
    await request(app).post(`/api/diagnostics/${diagnosticId}/strategic-objectives`).set(auth).send(completeObjective)

    const deleted = await request(app).delete(`/api/processes/${processId}/kpis/${kpiId}`).set(auth)
    expect(deleted.status).toBe(204)
    const objective = await request(app).get(`/api/strategic-objectives/${objectiveId}`).set(auth)
    expect(objective.body.objective.indicator).toMatchObject({ name: completeObjective.indicator.name, targetValue: completeObjective.indicator.targetValue })
  })

  it('does not create a process KPI when a SMART indicator is created', async () => {
    const app = appFor()
    const before = await request(app).get(`/api/diagnostics/${diagnosticId}/process-kpis`).set(auth)
    await request(app).post(`/api/diagnostics/${diagnosticId}/strategic-objectives`).set(auth).send(completeObjective)
    const after = await request(app).get(`/api/diagnostics/${diagnosticId}/process-kpis`).set(auth)
    expect(after.body.kpis).toHaveLength(before.body.kpis.length)
  })

  it('rolls back objective creation and update when the transaction fails', async () => {
    const createFailure = appFor(admin.role, { failHistory: true })
    const failedCreate = await request(createFailure).post(`/api/diagnostics/${diagnosticId}/strategic-objectives`).set(auth).send(completeObjective)
    expect(failedCreate.status).toBe(500)
    expect((await request(createFailure).get(`/api/diagnostics/${diagnosticId}/strategic-objectives`).set(auth)).body.objectives).toHaveLength(0)

    const options = { failHistory: false }
    const updateFailure = appFor(admin.role, options)
    await request(updateFailure).post(`/api/diagnostics/${diagnosticId}/strategic-objectives`).set(auth).send(completeObjective)
    options.failHistory = true
    const failedUpdate = await request(updateFailure).patch(`/api/strategic-objectives/${objectiveId}`).set(auth).send({ indicator: { ...completeObjective.indicator, targetValue: '99%' } })
    expect(failedUpdate.status).toBe(500)
    const unchanged = await request(updateFailure).get(`/api/strategic-objectives/${objectiveId}`).set(auth)
    expect(unchanged.body.objective.indicator).toMatchObject({ targetValue: completeObjective.indicator.targetValue })

    const indicatorOptions = { failHistory: false }
    const indicatorFailure = appFor(admin.role, indicatorOptions)
    await request(indicatorFailure).post(`/api/diagnostics/${diagnosticId}/strategic-objectives`).set(auth).send({ title: 'Objetivo base', statement: 'Declaración base' })
    indicatorOptions.failHistory = true
    const failedIndicatorCreate = await request(indicatorFailure).post(`/api/strategic-objectives/${objectiveId}/indicators`).set(auth).send({ ...completeObjective.indicator, name: 'No debe persistir' })
    expect(failedIndicatorCreate.status).toBe(500)
    expect((await request(indicatorFailure).get(`/api/strategic-objectives/${objectiveId}`).set(auth)).body.objective.indicators).toHaveLength(0)
  })
})
